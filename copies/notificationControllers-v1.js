import { db } from "../config/db.js";

export const getAllNotifications = async (req, res) => {
  try {
    const { id: userId, role, course_id: userCourseId } = req.verifiedUser;

    let approvalTasks = [];

    if (role === "department_head" || role === "admin") {
      const [approvals] = await db.execute(
        `
        SELECT 
          ir.*, up.first_name, up.last_name, c.course_name, r.short_name AS region_name, 
          n.is_read, n.id AS notification_id, n.title AS notification_title, n.message AS notification_message, sai.course_id
        FROM internship_records AS ir
        INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
        INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id 
        INNER JOIN courses AS c ON sai.course_id = c.id
        INNER JOIN regions AS r ON ir.region_id = r.id
        LEFT JOIN notifications AS n ON n.user_id = ? AND n.link = ir.id AND n.type = 'submission'
        WHERE ir.status = 'pending' 
          AND (
            sai.course_id = ? -- Match student course to Dept Head course
            OR 
            ? = 'admin'      -- OR if the LOGGED-IN user is an admin, let them through
          )
        `,
        [userId, userCourseId, role],
      );

      approvalTasks = approvals.map((item) => ({
        ...item,
        category: "approval",
        ui_key: `approval-${item.id}`,
      }));
    }

    const [announcements] = await db.execute(
      `
        SELECT 
          a.*, up.first_name AS sender_fname, up.last_name AS sender_lname, 
          ac.name AS category_name, ac.color AS category_color, ac.text_color AS category_text_color, 
          n.is_read, n.id AS notification_id, n.title AS notification_title, n.message AS notification_message
        FROM announcements AS a
        LEFT JOIN user_profiles AS up ON a.author_id = up.user_id
        INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
        -- Match the notification where YOU are the recipient and the link is this Announcement ID
        LEFT JOIN notifications AS n ON n.user_id = ? AND n.link = a.id AND n.type = 'announcement'
        ORDER BY a.created_at DESC
      `,
      [userId],
    );

    const announcementTasks = announcements.map((item) => ({
      ...item,
      category: "announcement",
      ui_key: `announcement-${item.id}`,
    }));

    const notifications = [...announcementTasks, ...approvalTasks].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    const allItems = notifications.length > 0 ? notifications : [];

    res.status(200).json(allItems);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
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
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
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
    console.log(error);
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
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};
