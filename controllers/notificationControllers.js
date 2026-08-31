import { db } from "../config/db.js";

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

    const [[{ total: totalRecords }]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM notifications n WHERE ${whereClause}`,
      params,
    );

    // Unread count is always global (not scoped to the current tab) — it
    // drives the header badge, which should reflect the whole inbox.
    const [[{ unread_count: unreadCount }]] = await connection.execute(
      `SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId],
    );

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
    console.error("Get all notifications error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
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

    res.status(200).json({
      success: true,
      message: "Notification deleted.",
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
