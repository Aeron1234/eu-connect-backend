import { reportError } from "../../../config/errorTracking.js";
import { invalidateAnnouncementsCache } from "../../../config/cache/announcementsCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { randomUUID } from "node:crypto";

function isValidEventDate(value) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseEventDate(value) {
  return typeof value === "string" ? value.trim() || null : value == null ? null : false;
}

function eventRangeError(start, end) {
  if (start === false || (start && !isValidEventDate(start))) {
    return "Enter a valid event date (YYYY-MM-DD).";
  }
  if (end === false || (end && !isValidEventDate(end))) {
    return "Enter a valid until date (YYYY-MM-DD).";
  }
  if (end && !start) return "Choose an event date before adding an until date.";
  if (end && end < start) return "Until date cannot be earlier than the event date.";
  return null;
}

export const getAnnouncementCategories = async (req, res) => {
  if (req.verifiedUser?.role === "employer") return res.status(403).json({ error: "Announcements are not available to employer accounts." });
  try {
    const [rows] = await db.execute(`SELECT * FROM announcement_categories`);

    const records = rows.length > 0 ? rows : null;
    return res.status(200).json(records);
  } catch (error) {
    console.log("Get announcement categories error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllAnnouncements = async (req, res) => {
  if (req.verifiedUser?.role === "employer") return res.status(403).json({ error: "Announcements are not available to employer accounts." });
  try {
    const {
      id: userId,
      role,
      department_id: viewerDepartmentId,
    } = req.verifiedUser;
    const { category, search } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let filterClauses = [];
    let params = [];

    if (role === "department_head" && req.verifiedUser.department_code === "REG") {
      filterClauses.push("ac.name = 'General'");
    }

    if (category && category !== "all") {
      filterClauses.push("ac.name = ?");
      params.push(category);
    }

    if (search) {
      filterClauses.push("(a.title LIKE ? OR a.content LIKE ?)");
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    // Department-scoped visibility, applied unconditionally regardless of
    // the `category` filter:
    // - Non-department posts are always visible to everyone.
    // - Department posts are NEVER visible to employers, full stop — this
    //   is explicit rather than relying on employers having a null
    //   department_id (which happened to produce the same result via the
    //   join, but silently and fragile to future schema changes).
    // - For everyone else (student, department_head, admin), a department
    //   post is visible only to admin or to viewers sharing the post
    //   author's department.
    filterClauses.push(
      `(
        ac.name != 'Department'
        OR (
          ? != 'employer'
          AND (? = 'admin' OR authorDept.department_id = ?)
        )
      )`,
    );
    params.push(role, role, viewerDepartmentId);

    const whereString = `AND ${filterClauses.join(" AND ")}`;

    // Joins back to the POST'S AUTHOR's department, not the viewer's —
    // there's no department column on announcements itself.
    const departmentJoin = `LEFT JOIN dept_heads_background_info authorDept ON authorDept.user_id = a.author_id`;

    const pinnedQuery = `
      SELECT a.public_id AS id, a.author_id, a.title, a.content,
             DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date,
             DATE_FORMAT(a.event_end_date, '%Y-%m-%d') AS event_end_date,
             a.is_pinned, a.created_at, a.updated_at,
             r.role, up.first_name, up.last_name,
             ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
      FROM announcements AS a
      INNER JOIN users AS u ON a.author_id = u.id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN user_profiles AS up ON a.author_id = up.user_id
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      ${departmentJoin}
      WHERE a.is_pinned = 1 ${whereString}
      ORDER BY a.created_at DESC
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM announcements AS a
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      ${departmentJoin}
      WHERE a.is_pinned = 0 ${whereString}
    `;

    const regularQuery = `
      SELECT a.public_id AS id, a.author_id, a.title, a.content,
             DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date,
             DATE_FORMAT(a.event_end_date, '%Y-%m-%d') AS event_end_date,
             a.is_pinned, a.created_at, a.updated_at,
             r.role, up.first_name, up.last_name,
             ac.id AS category_id, ac.name AS category, ac.color, ac.text_color,
             (${countQuery}) AS total_regular
      FROM announcements AS a
      INNER JOIN users AS u ON a.author_id = u.id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN user_profiles AS up ON a.author_id = up.user_id
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      ${departmentJoin}
      WHERE a.is_pinned = 0 ${whereString}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [pinnedRows] = await db.execute(pinnedQuery, params);
    const [pageRows] = await db.execute(regularQuery, [
      ...params,
      ...params,
      limit,
      offset,
    ]);

    let totalRecords;
    if (pageRows.length > 0) {
      totalRecords = pageRows[0].total_regular;
    } else {
      // The count intentionally uses fewer joins than the display query, so
      // even an empty first page needs its original count semantics.
      const [[{ total }]] = await db.execute(countQuery, params);
      totalRecords = total;
    }
    const regularRows = pageRows.map(({ total_regular, ...row }) => row);
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      pinned: pinnedRows,
      regular: regularRows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
      currentRegularCount: regularRows.length,
    });
  } catch (error) {
    reportError("Get all announcements error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

// Load one announcement directly so a notification can target a post on any
// feed page without fetching every preceding page. Keep the feed's department
// visibility rule here as well; a UUID is not an access token.
export const getAnnouncementById = async (req, res) => {
  if (req.verifiedUser?.role === "employer") return res.status(403).json({ error: "Announcements are not available to employer accounts." });
  const { announcementId } = req.params;
  const isLegacyId = /^[1-9]\d*$/.test(announcementId);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(announcementId);
  if (!isLegacyId && !isUuid) {
    return res.status(400).json({ error: "Invalid announcement ID." });
  }

  try {
    const { role } = req.verifiedUser;
    const departmentId = req.verifiedUser.department_id ?? null;
    const isRegistrar = role === "department_head" && req.verifiedUser.department_code === "REG";
    const [rows] = await db.execute(
      `SELECT a.public_id AS id, a.author_id, a.title, a.content,
              DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date,
              DATE_FORMAT(a.event_end_date, '%Y-%m-%d') AS event_end_date,
              a.is_pinned, a.created_at, a.updated_at,
              r.role, up.first_name, up.last_name,
              ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
       FROM announcements a
       JOIN users u ON u.id = a.author_id
       JOIN roles r ON r.id = u.role_id
       JOIN user_profiles up ON up.user_id = a.author_id
       JOIN announcement_categories ac ON ac.id = a.category_id
       LEFT JOIN dept_heads_background_info authorDept ON authorDept.user_id = a.author_id
       WHERE ${isLegacyId ? "a.id" : "a.public_id"} = ?
         ${isRegistrar ? "AND ac.name = 'General'" : ""}
         AND (ac.name != 'Department'
              OR (? != 'employer' AND (? = 'admin' OR authorDept.department_id = ?)))
       LIMIT 1`,
      [announcementId, role, role, departmentId],
    );
    if (!rows.length) return res.status(404).json({ error: "Announcement not found." });
    return res.json(rows[0]);
  } catch (error) {
    reportError("Get announcement by ID error:", error);
    return res.status(500).json({ error: "Failed to load announcement." });
  }
};

export const createAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id: userId, role } = req.verifiedUser;
    const data = req.body;

    const { title, content } = data;
    const category_id = parseInt(data.category_id);
    const eventDate = parseEventDate(data.event_date);
    const eventEndDate = parseEventDate(data.event_end_date);

    if (!category_id || !title || !content) {
      return res.status(400).json({
        error: "All fields are required.",
      });
    }

    const rangeError = eventRangeError(eventDate, eventEndDate);
    if (rangeError) return res.status(400).json({ error: rangeError });

    await connection.beginTransaction();

    const [senderRows] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [userId],
    );

    if (senderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Author profile not found." });
    }

    const senderName = `${senderRows[0].first_name} ${senderRows[0].last_name}`;

    const [categoryRows] = await connection.execute(
      `SELECT name FROM announcement_categories WHERE id = ?`,
      [category_id],
    );

    if (categoryRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: "Invalid category." });
    }

    const isDepartmentCategory = categoryRows[0].name === "Department";

    if (role === "department_head") {
      const allowedCategory = req.verifiedUser.department_code === "REG" ? "General" : "Department";
      if (categoryRows[0].name !== allowedCategory) {
        await connection.rollback();
        return res.status(403).json({ error: allowedCategory === "General"
          ? "Registrar department heads can only post General announcements."
          : "Department heads can only post Department announcements. General is reserved for admins and registrar department heads." });
      }
    }

    if (role === "admin" && categoryRows[0].name !== "General") {
      await connection.rollback();
      return res.status(400).json({
        error:
          "Admin accounts can only post General announcements.",
      });
    }

    const publicId = randomUUID();
    const [result] = await connection.execute(
      `
        INSERT INTO announcements (public_id, author_id, category_id, title, content, event_date, event_end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      [publicId, userId, category_id, title, content, eventDate, eventEndDate],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ error: "Posting announcement failed." });
    }

    // Employers never receive announcements. Department posts also scope
    // students and department heads to the author's department.
    let recipients;

    if (!isDepartmentCategory) {
      [recipients] = await connection.execute(
        `SELECT u.id FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id != ? AND r.role != 'employer'`,
        [userId],
      );
    } else {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );

      const departmentId = deptHeadRows[0]?.department_id ?? null;

      [recipients] = await connection.execute(
        `SELECT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN (
           SELECT sai1.*
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) sai ON sai.user_id = u.id
         LEFT JOIN dept_heads_background_info dhbi ON dhbi.user_id = u.id
         WHERE u.id != ?
           AND r.role != 'employer'
           AND (
             r.role NOT IN ('student', 'department_head')
             OR (r.role = 'student' AND sai.department_id = ?)
             OR (r.role = 'department_head' AND dhbi.department_id = ?)
           )`,
        [userId, departmentId, departmentId],
      );
    }

    if (recipients.length > 0) {
      const values = recipients.map((r) => [
        r.id,
        userId,
        "announcement",
        "New Announcement",
        `Posted by ${senderName}`,
        publicId,
      ]);

      await connection.query(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES ?`,
        [values],
      );
    }

    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "announcement_created",
          "announcements",
          publicId,
          `${senderName} posted an announcement: "${title}".`,
          JSON.stringify({
            category_id,
            title,
            event_date: eventDate,
            event_end_date: eventEndDate,
            recipient_count: recipients.length,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (announcement created):",
        logError,
      );
    }

    await connection.commit();
    invalidateAnnouncementsCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    const io = req.app.get("socketio");

    recipients.forEach((recipient) => {
      io.to(`user-${recipient.id}`).emit("new_notification", {
        title: "New Announcement",
        message: `Posted by ${senderName}`,
        type: "announcement",
        link_uuid: publicId,
      });
    });

    res.status(201).json({
      message: "Announcement posted successfully!",
      success: true,
      id: publicId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Create announcement error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const updateAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { announcementId } = req.params;
    const { id: userId, role } = req.verifiedUser;

    const { category_id, title, content, event_date, event_end_date } = req.body;
    const finalCategoryId = category_id ? Number(category_id) : null;
    const hasEventDate = Object.hasOwn(req.body, "event_date");
    const hasEventEndDate = Object.hasOwn(req.body, "event_end_date");
    const eventDate = parseEventDate(event_date);
    const eventEndDate = parseEventDate(event_end_date);

    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    if (eventDate === false || (eventDate && !isValidEventDate(eventDate))) {
      return res.status(400).json({ error: "Enter a valid event date (YYYY-MM-DD)." });
    }
    if (eventEndDate === false || (eventEndDate && !isValidEventDate(eventEndDate))) {
      return res.status(400).json({ error: "Enter a valid until date (YYYY-MM-DD)." });
    }

    await connection.beginTransaction();

    // Need the CURRENT category before updating, to detect a General -> Department
    // transition. Locked with FOR UPDATE since we're about to write to this row.
    const [existingRows] = await connection.execute(
      `SELECT a.category_id, ac.name AS category_name, a.title,
              DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date,
              DATE_FORMAT(a.event_end_date, '%Y-%m-%d') AS event_end_date
       FROM announcements a
       JOIN announcement_categories ac ON a.category_id = ac.id
       WHERE a.public_id = ? AND a.author_id = ?
       FOR UPDATE`,
      [announcementId, userId],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        error: "Announcement not found or unauthorized to edit.",
      });
    }

    const writeEventEndDate = hasEventEndDate || (hasEventDate && eventDate === null);
    const nextEventDate = hasEventDate ? eventDate : existingRows[0].event_date ?? null;
    const nextEventEndDate = hasEventEndDate
      ? eventEndDate
      : hasEventDate && eventDate === null ? null : existingRows[0].event_end_date ?? null;
    const rangeError = eventRangeError(nextEventDate, nextEventEndDate);
    if (rangeError) {
      await connection.rollback();
      return res.status(400).json({ error: rangeError });
    }

    const wasDepartmentCategory =
      existingRows[0].category_name === "Department";

    // Resolve what the NEW category will actually be (COALESCE semantics —
    // if category_id wasn't sent, it stays whatever it currently is).
    let newCategoryName = existingRows[0].category_name;
    if (finalCategoryId !== null) {
      const [newCategoryRows] = await connection.execute(
        `SELECT name FROM announcement_categories WHERE id = ?`,
        [finalCategoryId],
      );
      if (newCategoryRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Invalid category." });
      }
      newCategoryName = newCategoryRows[0].name;
    }

    const willBeDepartmentCategory = newCategoryName === "Department";

    if (role === "department_head") {
      const allowedCategory = req.verifiedUser.department_code === "REG" ? "General" : "Department";
      if (newCategoryName !== allowedCategory) {
        await connection.rollback();
        return res.status(403).json({ error: allowedCategory === "General"
          ? "Registrar department heads can only post General announcements."
          : "Department heads can only post Department announcements. General is reserved for admins and registrar department heads." });
      }
    }

    // Admin has no department_id — same reasoning as createAnnouncement.
    // Only the author can reach this endpoint at all (WHERE author_id = ?
    // above), so in practice an admin can only ever be editing their own
    // post, which is already guaranteed General by createAnnouncement's
    // own guard. This check exists so that guarantee isn't the ONLY thing
    // preventing an admin non-General post — if either endpoint changes
    // independently later, this still holds on its own.
    if (role === "admin" && newCategoryName !== "General") {
      await connection.rollback();
      return res.status(400).json({
        error:
          "Admin accounts can only set their announcements to General category.",
      });
    }

    const [result] = await connection.execute(
      `UPDATE announcements 
       SET 
         category_id = COALESCE(?, category_id), 
         title = COALESCE(?, title), 
         content = COALESCE(?, content), 
         event_date = IF(? = 1, ?, event_date),
         event_end_date = IF(? = 1, ?, event_end_date),
         updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ? AND author_id = ?`,
      [
        finalCategoryId, title || null, content || null,
        hasEventDate ? 1 : 0, eventDate,
        writeEventEndDate ? 1 : 0, nextEventEndDate,
        announcementId, userId,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(403).json({
        error: "Announcement not found or unauthorized to edit.",
      });
    }

    const [updatedData] = await connection.execute(
      `SELECT a.*,
              DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date,
              DATE_FORMAT(a.event_end_date, '%Y-%m-%d') AS event_end_date,
              ac.name AS category, ac.color AS category_bg, ac.text_color AS category_fg,
              up.first_name, up.last_name, r.role
       FROM announcements a
       JOIN announcement_categories ac ON a.category_id = ac.id
       JOIN user_profiles up ON a.author_id = up.user_id
       JOIN users u ON a.author_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE a.public_id = ?`,
      [announcementId],
    );

    // Updates don't normally notify anyone — EXCEPT this one case: a post
    // that was previously General (visible to everyone) just became
    // Department-scoped, meaning people who could see it a moment ago now
    // can't. Notifying same-department students/dept-heads mirrors what
    // createAnnouncement would have sent had this post been created as
    // Department from the start.
    let recipients = [];

    if (!wasDepartmentCategory && willBeDepartmentCategory) {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      const departmentId = deptHeadRows[0]?.department_id ?? null;

      [recipients] = await connection.execute(
        `SELECT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN (
           SELECT sai1.*
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) sai ON sai.user_id = u.id
         LEFT JOIN dept_heads_background_info dhbi ON dhbi.user_id = u.id
         WHERE u.id != ?
           AND r.role != 'employer'
           AND (
             r.role NOT IN ('student', 'department_head')
             OR (r.role = 'student' AND sai.department_id = ?)
             OR (r.role = 'department_head' AND dhbi.department_id = ?)
           )`,
        [userId, departmentId, departmentId],
      );

      if (recipients.length > 0) {
        const senderName = `${updatedData[0].first_name} ${updatedData[0].last_name}`;
        const values = recipients.map((r) => [
          r.id,
          userId,
          "announcement",
          "New Announcement",
          `Posted by ${senderName}`,
          announcementId,
        ]);

        await connection.query(
          `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES ?`,
          [values],
        );
      }
    }

    try {
      const changedFields = [];
      if (category_id !== undefined) changedFields.push("category_id");
      if (title !== undefined) changedFields.push("title");
      if (content !== undefined) changedFields.push("content");
      if (hasEventDate) changedFields.push("event_date");
      if (writeEventEndDate) changedFields.push("event_end_date");

      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "announcement_updated",
          "announcements",
          String(announcementId),
          `Author updated announcement "${updatedData[0].title}" (${changedFields.join(", ") || "no fields"}).`,
          JSON.stringify({
            changed_fields: changedFields,
            became_department_category:
              !wasDepartmentCategory && willBeDepartmentCategory,
            recipient_count: recipients.length,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (announcement updated):",
        logError,
      );
    }

    await connection.commit();
    invalidateAnnouncementsCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    if (recipients.length > 0) {
      const io = req.app.get("socketio");
      const senderName = `${updatedData[0].first_name} ${updatedData[0].last_name}`;

      recipients.forEach((recipient) => {
        io.to(`user-${recipient.id}`).emit("new_notification", {
          title: "New Announcement",
          message: `Posted by ${senderName}`,
          type: "announcement",
          link_uuid: announcementId,
        });
      });
    }

    res.status(200).json({
      message: "Announcement updated successfully!",
      success: true,
      data: { ...updatedData[0], id: announcementId },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Update Announcement Error:", error);
    res.status(500).json({ error: "Update failed" });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { announcementId } = req.params;
    const { id: userId, role } = req.verifiedUser;

    // Security: Only the author or an Admin can delete
    // You might want to check ownership first if not a Super Admin
    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    await connection.beginTransaction();
    // This extra read is only for the audit description. A logging lookup
    // failure must not prevent an otherwise valid deletion.
    let announcementLabel = "an announcement";
    let legacyId = null;
    try {
      const [existingRows] = await connection.execute(
        `SELECT id, title FROM announcements WHERE public_id = ? AND (author_id = ? OR ? = 'admin') FOR UPDATE`,
        [announcementId, userId, role],
      );
      legacyId = existingRows[0]?.id ?? null;
      if (existingRows[0]?.title) {
        announcementLabel = `announcement "${existingRows[0].title}"`;
      }
    } catch (lookupError) {
      reportError("Announcement title lookup failed for activity log:", lookupError);
    }
    const [result] = await connection.execute(
      `DELETE FROM announcements WHERE public_id = ? AND (author_id = ? OR ? = 'admin')`,
      [announcementId, userId, role],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "Announcement not found or unauthorized." });
    }

    await connection.execute(
      `DELETE FROM notifications WHERE type = 'announcement' AND (link_uuid = ? OR link = ?)`,
      [announcementId, legacyId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual deletion.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "announcement_deleted",
          "announcements",
          String(announcementId),
          `${role === "admin" ? "Admin" : "Author"} deleted ${announcementLabel}.`,
          null,
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (announcement deleted):",
        logError,
      );
    }

    await connection.commit();
    invalidateAnnouncementsCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    // io.emit("announcement-deleted", id);

    res.status(200).json({
      message: "Announcement Deleted successfully",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Delete announcement error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const togglePinAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { announcementId } = req.params;
    const { is_pinned } = req.body; // Expecting true or false
    const { role } = req.verifiedUser;

    // Typically, only Admins or Dept Heads should be able to pin/unpin
    if (role !== "admin" && role !== "department_head") {
      return res
        .status(403)
        .json({ error: "Only authorized staff can pin announcements." });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE announcements 
       SET is_pinned = ? 
       WHERE public_id = ?`,
      [is_pinned, announcementId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Announcement not found." });
    }

    await connection.commit();
    invalidateAnnouncementsCache();

    // io.emit("announcement-pinned-toggled", { id: announcementId, is_pinned });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Toggle Pin announcement error:", error);
    res.status(500).json({ error: "Failed to update pinned status." });
  } finally {
    if (connection) connection.release();
  }
};
