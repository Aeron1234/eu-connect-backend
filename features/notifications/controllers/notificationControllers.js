import { reportError } from "../../../config/errorTracking.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { db } from "../../../config/db.js";

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
           FROM notifications WHERE user_id = ? AND is_read = 0`,
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
    // "all" (default) or "requests" — Requests only shows pending supervisor
    // requests, so both the list and its own pagination are scoped to that
    // type at the query level, not filtered client-side from the All feed.
    const scope = req.query.scope === "requests" ? "requests" : "all";

    connection = await db.getConnection();

    const conditions = ["n.user_id = ?"];
    const params = [userId];

    if (scope === "requests") {
      conditions.push("n.type = 'supervisor_request_submitted'");
    }

    const whereClause = conditions.join(" AND ");

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
         sr.status AS supervisor_request_status
       FROM notifications n
       LEFT JOIN user_profiles up ON n.sender_id = up.user_id
       LEFT JOIN supervisor_requests sr 
         ON n.type = 'supervisor_request_submitted' AND n.link_uuid = sr.id
       WHERE ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    // Unread count is always global (not scoped to the current tab) — it
    // drives the header badge, which should reflect the whole inbox.
    const [[counts]] = await connection.execute(
      `SELECT COUNT(*) AS all_total,
              COUNT(CASE WHEN type = 'supervisor_request_submitted' THEN 1 END) AS request_total,
              COUNT(CASE WHEN is_read = 0 THEN 1 END) AS unread_count
       FROM notifications WHERE user_id = ?`,
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
        n.supervisor_request_status === "pending",
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

// Resolve an announcement notification at click time. A cached inbox can still
// show a notification after its announcement and DB row have been removed.
export const openAnnouncementNotification = async (req, res) => {
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

    // Ownership check happens right in the WHERE clause — a user can only
    // ever delete their own notifications, no separate SELECT needed first.
    const [result] = await connection.execute(
      `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
      [notificationId, userId],
    );

    if (result.affectedRows === 0) {
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
