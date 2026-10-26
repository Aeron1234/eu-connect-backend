import { pendingSupervisorRequestSql } from "../../../config/supervisorRequestEligibility.js";
import { reportError } from "../../../config/errorTracking.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { db } from "../../../config/db.js";

function notificationVisibility(role, prefix = "") {
  if (role === "employer") return `${prefix}type NOT IN ('announcement', 'calendar_schedule')`;
  if (role === "student") return `${prefix}type NOT IN ('evaluation_submitted', 'evaluation_deleted') AND ${prefix}type NOT IN ('feedback_mentioned', 'feedback_reply', 'feedback_status')`;
  return "1 = 1";
}

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const userId = req.verifiedUser?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized access." });
    }

    let row;
    for (let attempt = 0; attempt < 2; attempt++) {
      let connection;
      try {
        connection = await db.getConnection();
        [[row]] = await connection.execute(
          `SELECT COUNT(*) AS unread_count
           FROM notifications WHERE user_id = ? AND is_read = 0
             AND ${notificationVisibility(req.verifiedUser.role)}`,
          [userId],
        );
        break;
      } catch (error) {
        // An idle MySQL socket may have been closed by the host. This read is
        // safe to repeat once after releasing the broken pooled connection.
        if (attempt > 0 || !["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "EPIPE"].includes(error?.code)) {
          throw error;
        }
      } finally {
        connection?.release();
      }
    }
    return res.status(200).json({ unreadCount: row.unread_count });
  } catch (error) {
    reportError("Get unread notification count error:", error);
    return res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllNotifications = async (req, res) => {
  let connection;
  try {
    const { id: userId } = req.verifiedUser || {};

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized access." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const offset = (page - 1) * limit;
    // Requests includes all supervisor-request notifications, including answered ones.
    // Filter and paginate that type in SQL; derive actionable separately from the
    // current request and internship, rather than from unread state.
    const scope = req.query.scope === "requests" ? "requests" : "all";

    connection = await db.getConnection();

    const conditions = ["n.user_id = ?"];
    const params = [userId];
    conditions.push(notificationVisibility(req.verifiedUser.role, "n."));

    if (scope === "requests") {
      conditions.push("n.type = 'supervisor_request_submitted'");
    }

    const whereClause = conditions.join(" AND ");

    // Match the request UUID (or legacy link) only for its intended recipient.
    // Recheck the linked internship so stale pending rows do not expose response controls.
    const [results] = await connection.execute(
      `SELECT 
         n.id AS notification_id,
         n.sender_id,
         n.type,
         n.title,
         n.message,
         n.link,
         n.link_uuid,
         n.is_read,
         n.created_at,
         up.first_name AS sender_first_name,
         up.last_name AS sender_last_name,
         sr.status AS supervisor_request_status,
         CASE WHEN ${pendingSupervisorRequestSql()} THEN 1 ELSE 0 END AS supervisor_request_actionable
       FROM notifications n
       LEFT JOIN user_profiles up ON n.sender_id = up.user_id
       LEFT JOIN supervisor_requests sr 
         ON n.type = 'supervisor_request_submitted'
           AND COALESCE(NULLIF(n.link_uuid, ''), n.link) = sr.id
           AND sr.employer_id = n.user_id
       LEFT JOIN internship_records request_internship ON request_internship.id = sr.internship_id
       WHERE ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    // Unread count spans this recipient's role-visible inbox, regardless of tab.
    // Only totalRecords and pagination follow the selected scope.
    const [[counts]] = await connection.execute(
      `SELECT COUNT(*) AS all_total,
              COUNT(CASE WHEN type = 'supervisor_request_submitted' THEN 1 END) AS request_total,
              COUNT(CASE WHEN is_read = 0 THEN 1 END) AS unread_count
       FROM notifications WHERE user_id = ?
         AND ${notificationVisibility(req.verifiedUser.role)}`,
      [userId],
    );

    const totalRecords = scope === "requests" ? counts.request_total : counts.all_total;
    const unreadCount = counts.unread_count;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const notifications = results.map((n) => ({
      id: n.notification_id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      link_uuid: n.link_uuid,
      is_read: !!n.is_read,
      created_at: n.created_at,
      sender: n.sender_id
        ? {
            id: n.sender_id,
            first_name: n.sender_first_name,
            last_name: n.sender_last_name,
          }
        : null,
      actionable:
        n.type === "supervisor_request_submitted" &&
        Boolean(n.supervisor_request_actionable),
      request_status: n.supervisor_request_status || null,
      can_delete: !(n.type === "supervisor_request_submitted" && Boolean(n.supervisor_request_actionable)),
      ui_key: `${n.type}-${n.notification_id}`,
    }));

    res.status(200).json({
      data: notifications,
      unreadCount,
      totalPages,
      totalRecords,
      currentPage: page,
      scope,
    });
  } catch (error) {
    reportError("Get all notifications error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

// Resolve target existence and category access at click time. Cached inbox rows
// may outlive the announcement; legacy numeric links and UUID links are supported.
export const openAnnouncementNotification = async (req, res) => {
  if (req.verifiedUser?.role === "employer") {
    return res.status(403).json({ success: false, state: "unavailable", error: "Announcements are not available to employer accounts." });
  }
  const notificationId = req.params.notificationId;
  if (!/^[1-9]\d*$/.test(notificationId)) {
    return res.status(400).json({ error: "Invalid notification ID." });
  }

  const { id: userId, role, department_id: viewerDepartmentId } = req.verifiedUser;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [[notification]] = await connection.execute(
      `SELECT link, link_uuid, is_read
         FROM notifications
        WHERE id = ? AND user_id = ? AND type = 'announcement'
        FOR UPDATE`,
      [notificationId, userId],
    );
    if (!notification) {
      await connection.rollback();
      return res.status(410).json({
        success: false,
        state: "gone",
        error: "This notification is no longer available.",
      });
    }

    const uuid = notification.link_uuid;
    const legacyId = notification.link;
    const hasUuid = typeof uuid === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid);
    const hasLegacyId = /^[1-9]\d*$/.test(String(legacyId ?? ""));
    let announcement = null;
    if (hasUuid || hasLegacyId) {
      const [rows] = await connection.execute(
        `SELECT a.public_id, ac.name AS category,
                authorDept.department_id AS author_department_id
           FROM announcements a
           LEFT JOIN announcement_categories ac ON ac.id = a.category_id
           LEFT JOIN dept_heads_background_info authorDept ON authorDept.user_id = a.author_id
          WHERE ${hasUuid ? "a.public_id" : "a.id"} = ?
          LIMIT 1`,
        [hasUuid ? uuid : legacyId],
      );
      announcement = rows[0] ?? null;
    }

    if (!announcement) {
      await connection.execute(
        "DELETE FROM notifications WHERE id = ? AND user_id = ?",
        [notificationId, userId],
      );
      await connection.commit();
      invalidateNotificationsCache(userId);
      return res.status(410).json({
        success: false,
        state: "deleted",
        error: "This announcement has been deleted. Its notification was removed.",
      });
    }

    const canSeeDepartmentPost = role === "admin" || (
      role !== "employer" &&
      viewerDepartmentId != null &&
      String(announcement.author_department_id) === String(viewerDepartmentId)
    );
    if (!announcement.category ||
        (announcement.category === "Department" && !canSeeDepartmentPost)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        state: "unavailable",
        error: "This announcement is no longer available to your account.",
      });
    }

    if (!notification.is_read) {
      await connection.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
        [notificationId, userId],
      );
    }
    await connection.commit();
    if (!notification.is_read) invalidateNotificationsCache(userId);
    return res.json({ success: true, announcementId: announcement.public_id });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Open announcement notification error:", error);
    return res.status(500).json({ error: "Could not open this notification." });
  } finally {
    connection?.release();
  }
};

export const markAsReadNotification = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({ error: "Notification ID is required" });
    }

    const [result] = await db.execute(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND is_read = 0`,
      [notificationId, userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Notification not found or unauthorized",
      });
    }

    invalidateNotificationsCache(userId);

    res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.log("Mark notification as read error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const markAsAllReadNotification = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;

    const [result] = await db.execute(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Notification not found or unauthorized",
      });
    }

    invalidateNotificationsCache(userId);

    res.status(200).json({
      success: true,
      message: "All notifications was marked as read.",
    });
  } catch (error) {
    console.log("Mark all notifications as read error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const deleteNotification = async (req, res) => {
  let connection;
  try {
    const { id: userId } = req.verifiedUser;
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({ error: "notificationId is required." });
    }

    connection = await db.getConnection();

    // Check ownership and live request eligibility in the DELETE itself so a stale
    // client cannot dismiss an unanswered active request. Marking read is not a response.
    // Answered, superseded or otherwise ineligible requests can be dismissed.
    const [result] = await connection.execute(
      `DELETE FROM notifications WHERE id = ? AND user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM supervisor_requests sr
         JOIN internship_records request_internship ON request_internship.id = sr.internship_id
         WHERE notifications.type = 'supervisor_request_submitted'
           AND sr.id = COALESCE(NULLIF(notifications.link_uuid, ''), notifications.link)
           AND sr.employer_id = notifications.user_id
           AND ${pendingSupervisorRequestSql()}
       )`,
      [notificationId, userId],
    );

    if (result.affectedRows === 0) {
      // Distinguish an owned, protected request (409) from an absent or unowned row (404).
      const [owned] = await connection.execute(
        "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
        [notificationId, userId],
      );
      if (owned.length) {
        return res.status(409).json({
          success: false,
          error: "Accept or decline this supervisor request before deleting its notification.",
        });
      }
      return res.status(404).json({
        error: "Notification not found or you don't have access to it.",
      });
    }

    invalidateNotificationsCache(userId);

    res.status(200).json({
      success: true,
      message: "Notification deleted.",
    });
  } catch (error) {
    reportError("Delete notification error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
