import { db } from "../config/db.js";

export const getAnnouncementCategories = async (req, res) => {
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
      SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, 
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

    const regularQuery = `
      SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, 
             r.role, up.first_name, up.last_name,
             ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
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
    const [regularRows] = await db.execute(regularQuery, [
      ...params,
      limit,
      offset,
    ]);

    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM announcements AS a
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      ${departmentJoin}
      WHERE a.is_pinned = 0 ${whereString}
    `;
    const [countResult] = await db.execute(countQuery, params);

    const totalRecords = countResult[0].total;
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
    console.error("Get all announcements error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
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

    if (!category_id || !title || !content) {
      return res.status(400).json({
        error: "All fields are required.",
      });
    }

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

    if (isDepartmentCategory && role === "admin") {
      await connection.rollback();
      return res.status(400).json({
        error:
          "Admin accounts don't belong to a department and can't post Department-category announcements.",
      });
    }

    const [result] = await connection.execute(
      `
        INSERT INTO announcements (author_id, category_id, title, content)
        VALUES (?, ?, ?, ?)
        `,
      [userId, category_id, title, content],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({
        error: "Posting annoucement failed.",
      });
    }

    // Recipients depend on who posted AND the category:
    // - admin posts -> everyone gets notified. (Department-category is
    //   already blocked above, so admin's post is always effectively
    //   General here, and reaches everyone including employers.)
    // - department head posts, General category -> everyone except the
    //   poster gets notified, regardless of department, INCLUDING
    //   employers.
    // - department head posts, Department category -> students and other
    //   department heads are scoped to the poster's own department;
    //   admin still sees it regardless; employers are excluded entirely.
    let recipients;

    if (role === "admin") {
      [recipients] = await connection.execute(
        `SELECT id FROM users WHERE id != ?`,
        [userId],
      );
    } else if (!isDepartmentCategory) {
      // General category from a department head — no scoping at all,
      // reaches every user except the poster, employers included.
      [recipients] = await connection.execute(
        `SELECT id FROM users WHERE id != ?`,
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
        result.insertId,
      ]);

      await connection.query(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link) VALUES ?`,
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
          String(result.insertId),
          `${senderName} posted an announcement: "${title}".`,
          JSON.stringify({
            category_id,
            title,
            recipient_count: recipients.length,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (announcement created):",
        logError,
      );
    }

    await connection.commit();

    const io = req.app.get("socketio");

    recipients.forEach((recipient) => {
      io.to(`user-${recipient.id}`).emit("new_notification", {
        title: "New Announcement",
        message: `Posted by ${senderName}`,
        type: "announcement",
        link: result.insertId,
      });
    });

    res.status(201).json({
      message: "Announcement posted successfully!",
      success: true,
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

    const { category_id, title, content } = req.body;
    const finalCategoryId = category_id ? Number(category_id) : null;

    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    await connection.beginTransaction();

    // Need the CURRENT category before updating, to detect a General -> Department
    // transition. Locked with FOR UPDATE since we're about to write to this row.
    const [existingRows] = await connection.execute(
      `SELECT a.category_id, ac.name AS category_name, a.title
       FROM announcements a
       JOIN announcement_categories ac ON a.category_id = ac.id
       WHERE a.id = ? AND a.author_id = ?
       FOR UPDATE`,
      [announcementId, userId],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        error: "Announcement not found or unauthorized to edit.",
      });
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

    // Admin has no department_id — same reasoning as createAnnouncement.
    // Only the author can reach this endpoint at all (WHERE author_id = ?
    // above), so in practice an admin can only ever be editing their own
    // post, which is already guaranteed General by createAnnouncement's
    // own guard. This check exists so that guarantee isn't the ONLY thing
    // preventing an admin Department post — if either endpoint changes
    // independently later, this still holds on its own.
    if (willBeDepartmentCategory && role === "admin") {
      await connection.rollback();
      return res.status(400).json({
        error:
          "Admin accounts don't belong to a department and can't set announcements to Department category.",
      });
    }

    const [result] = await connection.execute(
      `UPDATE announcements 
       SET 
         category_id = COALESCE(?, category_id), 
         title = COALESCE(?, title), 
         content = COALESCE(?, content), 
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND author_id = ?`,
      [finalCategoryId, title || null, content || null, announcementId, userId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(403).json({
        error: "Announcement not found or unauthorized to edit.",
      });
    }

    const [updatedData] = await connection.execute(
      `SELECT a.*, ac.name AS category, ac.color AS category_bg, ac.text_color AS category_fg, 
              up.first_name, up.last_name, r.role
       FROM announcements a
       JOIN announcement_categories ac ON a.category_id = ac.id
       JOIN user_profiles up ON a.author_id = up.user_id
       JOIN users u ON a.author_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE a.id = ?`,
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
          `INSERT INTO notifications (user_id, sender_id, type, title, message, link) VALUES ?`,
          [values],
        );
      }
    }

    try {
      const changedFields = [];
      if (category_id !== undefined) changedFields.push("category_id");
      if (title !== undefined) changedFields.push("title");
      if (content !== undefined) changedFields.push("content");

      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "announcement_updated",
          "announcements",
          String(announcementId),
          `Author updated announcement ${announcementId} (${changedFields.join(", ") || "no fields"}).`,
          JSON.stringify({
            changed_fields: changedFields,
            became_department_category:
              !wasDepartmentCategory && willBeDepartmentCategory,
            recipient_count: recipients.length,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (announcement updated):",
        logError,
      );
    }

    await connection.commit();

    if (recipients.length > 0) {
      const io = req.app.get("socketio");
      const senderName = `${updatedData[0].first_name} ${updatedData[0].last_name}`;

      recipients.forEach((recipient) => {
        io.to(`user-${recipient.id}`).emit("new_notification", {
          title: "New Announcement",
          message: `Posted by ${senderName}`,
          type: "announcement",
          link: announcementId,
        });
      });
    }

    res.status(200).json({
      message: "Announcement updated successfully!",
      success: true,
      data: updatedData[0],
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update Announcement Error:", error);
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
    const [result] = await connection.execute(
      `DELETE FROM announcements WHERE id = ? AND (author_id = ? OR ? = 'admin')`,
      [announcementId, userId, role],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "Announcement not found or unauthorized." });
    }

    await connection.execute(`DELETE FROM notifications WHERE link = ?`, [
      announcementId,
    ]);

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
          `${role === "admin" ? "Admin" : "Author"} deleted announcement ${announcementId}.`,
          null,
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (announcement deleted):",
        logError,
      );
    }

    await connection.commit();

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
       WHERE id = ?`,
      [is_pinned, announcementId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Announcement not found." });
    }

    await connection.commit();

    // io.emit("announcement-pinned-toggled", { id: announcementId, is_pinned });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Toggle Pin announcement error:", error);
    res.status(500).json({ error: "Failed to update pinned status." });
  } finally {
    if (connection) connection.release();
  }
};
