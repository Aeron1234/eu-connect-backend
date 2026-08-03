import { db } from "../config/db.js";

export const getAllNotifications = async (req, res) => {
  let connection;
  try {
    const {
      id: userId,
      role,
      department_id: userDepartmentId,
    } = req.verifiedUser || {};

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized access." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const offset = (page - 1) * limit;

    // Safety check: Convert undefined parameters to null for mysql2 binding safety
    const safeUserId = userId ?? null;
    const safeRole = role ?? null;
    const safeDeptId = userDepartmentId ?? null;

    connection = await db.getConnection();

    // 🌟 FIX: Extracted the combined Part 1-4 UNION ALL into its own string
    // (without ORDER BY/LIMIT/OFFSET) so it can be reused for both the
    // paginated results AND an accurate total count. Previously totalRecords
    // came from a blanket `SELECT COUNT(*) FROM notifications WHERE user_id = ?`,
    // which ignored Part 1's pending-only filter, Part 4's link_uuid filter, etc.
    // That caused the "2 notification(s)" header to be misleading when the
    // actual visible inbox was empty.
    const combinedQuery = `
      SELECT * FROM (
        -- PART 1: APPROVALS (For Admins/Dept Heads to see pending requests)
        SELECT 
          ir.id, ir.user_id, 
          ir.company_name, 
          ir.company_address, 
          ir.internship_position, 
          ir.description, 
          ir.lon, 
          ir.lat, 
          ir.date_started, 
          ir.total_hours, 
          ir.status, 
          ir.created_at, 
          ir.updated_at, 
          ir.region_id, 
          ir.company_website,
          up.first_name, 
          up.last_name, 
          c.course_name, 
          d.code AS department_code, -- 🌟 Added department code here
          r.short_name AS region_name, 
          n.is_read, 
          n.id AS notification_id, 
          n.title AS notification_title, 
          n.message AS notification_message, 
          sai.course_id,
          'approval' AS category,
          NULL AS sender_fname, 
          NULL AS sender_lname,
          NULL AS category_name, 
          NULL AS category_color, 
          NULL AS category_text_color,
          NULL AS content, 
          NULL AS author_id,
          NULL AS announcement_title
        FROM internship_records AS ir
        INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
        -- 🌟 FIX: Deduplicated student_academic_info to one row per user_id (latest by id)
        -- to prevent internship_records rows from fanning out into duplicates.
        INNER JOIN (
          SELECT sai1.*
          FROM student_academic_info AS sai1
          INNER JOIN (
            SELECT user_id, MAX(id) AS max_id
            FROM student_academic_info
            GROUP BY user_id
          ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
        ) AS sai ON ir.user_id = sai.user_id
        INNER JOIN courses AS c ON sai.course_id = c.id
        LEFT JOIN departments AS d ON sai.department_id = d.id -- 🌟 Joined departments table
        INNER JOIN regions AS r ON ir.region_id = r.id
        LEFT JOIN notifications AS n ON n.user_id = ? AND n.link = ir.id AND n.type = 'submission'
        WHERE ir.status = 'pending' 
          AND (? COLLATE utf8mb4_general_ci = 'admin' OR sai.department_id = ?)
          AND (? COLLATE utf8mb4_general_ci IN ('admin', 'department_head'))

        UNION ALL

        -- PART 2: ANNOUNCEMENTS (For Everyone)
        SELECT 
          a.id, 
          NULL AS user_id, 
          a.title AS company_name, 
          NULL AS company_address, 
          NULL AS internship_position, 
          NULL AS description, 
          NULL AS lon, 
          NULL AS lat, 
          NULL AS date_started, 
          NULL AS total_hours, 
          NULL AS status, 
          a.created_at, 
          a.updated_at, 
          NULL AS region_id, 
          NULL AS company_website,
          NULL AS first_name, 
          NULL AS last_name, 
          NULL AS course_name, 
          NULL AS department_code, -- Align schema column count
          NULL AS region_name, 
          n.is_read, 
          n.id AS notification_id, 
          n.title AS notification_title, 
          n.message AS notification_message, 
          NULL AS course_id,
          'announcement' AS category,
          up.first_name AS sender_fname, 
          up.last_name AS sender_lname,
          ac.name AS category_name, 
          ac.color AS category_color, 
          ac.text_color AS category_text_color,
          a.content, 
          a.author_id,
          a.title AS announcement_title
        FROM announcements AS a
        LEFT JOIN user_profiles AS up ON a.author_id = up.user_id
        INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
        LEFT JOIN notifications AS n ON n.user_id = ? AND n.link = a.id AND n.type = 'announcement'
        WHERE n.id IS NOT NULL

        UNION ALL

        -- PART 3: RECORD STATUS UPDATES (For Students to see Approved/Rejected)
        SELECT 
          ir.id, 
          ir.user_id, 
          ir.company_name, 
          ir.company_address, 
          ir.internship_position, 
          ir.description, 
          ir.lon, 
          ir.lat, 
          ir.date_started, 
          ir.total_hours, 
          ir.status, 
          ir.created_at, 
          ir.updated_at, 
          ir.region_id, 
          ir.company_website,
          NULL AS first_name, 
          NULL AS last_name, 
          NULL AS course_name, 
          NULL AS department_code, -- Align schema column count
          NULL AS region_name, 
          n.is_read, 
          n.id AS notification_id, 
          n.title AS notification_title, 
          n.message AS notification_message, 
          NULL AS course_id,
          'record_status' AS category,
          up.first_name AS sender_fname, 
          up.last_name AS sender_lname, 
          NULL AS category_name, 
          NULL AS category_color, 
          NULL AS category_text_color,
          NULL AS content, 
          NULL AS author_id,
          NULL AS announcement_title
        FROM internship_records AS ir
        INNER JOIN notifications AS n ON n.user_id = ? AND n.link = ir.id AND n.type IN ('approved', 'rejected')
        LEFT JOIN user_profiles AS up ON n.sender_id = up.user_id
        WHERE ir.user_id = ?

        UNION ALL

        -- PART 4: EVALUATION VALIDATION REQUESTS & DELETIONS
        SELECT 
          IFNULL(m.id, n.link_uuid) AS id,
          ir.user_id, 
          ir.company_name, 
          NULL AS company_address, 
          ir.internship_position, 
          m.other_remarks AS description, 
          NULL AS lon, 
          NULL AS lat, 
          NULL AS date_started, 
          NULL AS total_hours, 
          IFNULL(m.status, 'deleted') AS status, 
          n.created_at, 
          n.created_at AS updated_at, 
          NULL AS region_id, 
          NULL AS company_website,
          NULL AS first_name, 
          NULL AS last_name, 
          NULL AS course_name, 
          NULL AS department_code, -- Align schema column count
          NULL AS region_name, 
          n.is_read, 
          n.id AS notification_id, 
          n.title AS notification_title, 
          n.message AS notification_message, 
          NULL AS course_id,
          'evaluation_submission' AS category,
          up.first_name AS sender_fname, 
          up.last_name AS sender_lname, 
          NULL AS category_name, 
          NULL AS category_color, 
          NULL AS category_text_color,
          NULL AS content, 
          n.sender_id AS author_id,
          NULL AS announcement_title
        FROM notifications AS n 
        INNER JOIN internship_records AS ir ON n.link = ir.id 
        LEFT JOIN student_evaluation_masters AS m ON n.link_uuid = m.id 
        LEFT JOIN user_profiles AS up ON n.sender_id = up.user_id
        WHERE n.user_id = ? 
          AND n.type IN ('submission', 'evaluation_deleted') 
          AND n.link_uuid IS NOT NULL
      ) AS combined
    `;

    // Params shared by both the paginated query and the count query
    // (everything except LIMIT/OFFSET, which only the paginated query needs)
    const combinedParams = [
      safeUserId, // Part 1: notification user_id
      safeRole, // Part 1: admin check
      safeDeptId, // Part 1: department_id filter
      safeRole, // Part 1: role check
      safeUserId, // Part 2
      safeUserId, // Part 3
      safeUserId, // Part 3
      safeUserId, // Part 4
    ];

    const [results] = await connection.execute(
      `${combinedQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...combinedParams, limit, offset],
    );

    const [countResult] = await connection.execute(
      `SELECT COUNT(*) AS total FROM (${combinedQuery}) AS count_wrap`,
      combinedParams,
    );

    const [unreadCount] = await connection.execute(
      `SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [safeUserId],
    );

    const totalRecords = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const notifications = results.map((item) => ({
      ...item,
      is_read: item.is_read || 0,
      ui_key: `${item.category}-${item.id}-${item.notification_id}`,
    }));

    res.status(200).json({
      data: notifications,
      unreadCount: unreadCount[0]?.unread_count || 0,
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    console.error("Combined notification extraction runtime failure:", error);
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
