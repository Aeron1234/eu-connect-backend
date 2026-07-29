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

// export const getAllAnnouncements = async (req, res) => {
//   try {
//     const [rows] = await db.execute(
//       `SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, r.role, up.first_name, up.last_name,
//        ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
//        FROM announcements AS a
//        INNER JOIN users AS u ON a.author_id = u.id
//        INNER JOIN roles AS r ON u.role_id = r.id
//        INNER JOIN user_profiles AS up ON a.author_id = up.user_id
//        INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
//        ORDER BY created_at DESC
//        `,
//     );

//     const records = rows.length > 0 ? rows : null;

//     res.status(200).json(records);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Database query failed", success: false });
//   }
// };

export const getAllAnnouncements = async (req, res) => {
  try {
    const { category, search } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // 1. Build Dynamic Filter Clauses
    let filterClauses = [];
    let params = [];

    // Category Filter (Checks against the category name)
    if (category && category !== "all") {
      filterClauses.push("ac.name = ?");
      params.push(category);
    }

    // Search Filter (Checks title and content)
    if (search) {
      filterClauses.push("(a.title LIKE ? OR a.content LIKE ?)");
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    const whereString =
      filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : "";

    // 2. Query A: Fetch ALL Pinned (No Pagination)
    // We use your exact JOIN structure here
    const pinnedQuery = `
      SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, 
             r.role, up.first_name, up.last_name,
             ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
      FROM announcements AS a
      INNER JOIN users AS u ON a.author_id = u.id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN user_profiles AS up ON a.author_id = up.user_id
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      WHERE a.is_pinned = 1 ${whereString}
      ORDER BY a.created_at DESC
    `;

    // 3. Query B: Fetch Paginated Regular Announcements
    const regularQuery = `
      SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, 
             r.role, up.first_name, up.last_name,
             ac.id AS category_id, ac.name AS category, ac.color, ac.text_color
      FROM announcements AS a
      INNER JOIN users AS u ON a.author_id = u.id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN user_profiles AS up ON a.author_id = up.user_id
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      WHERE a.is_pinned = 0 ${whereString}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Execute queries
    const [pinnedRows] = await db.execute(pinnedQuery, params);
    const [regularRows] = await db.execute(regularQuery, [
      ...params,
      limit,
      offset,
    ]);

    // 4. Calculate total records for pagination
    // We need the same JOINS here so that whereString (which uses 'ac' and 'a') works
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM announcements AS a
      INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
      WHERE a.is_pinned = 0 ${whereString}
    `;

    // Pass the same filter params used in the other queries
    const [countResult] = await db.execute(countQuery, params);

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      pinned: pinnedRows.length > 0 ? pinnedRows : [],
      regular: regularRows.length > 0 ? regularRows : [],
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

    const { id: userId } = req.verifiedUser;
    const data = req.body;

    const { title, content } = data;
    const category_id = parseInt(data.category_id);

    if (!category_id || !title || !content) {
      return res.status(400).json({
        error: "All fields are required.",
      });
    }

    // 2. Atomic Check & Insert
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

    const [recipients] = await connection.execute(
      `SELECT id FROM users WHERE id != ?`,
      [userId],
    );

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

    await connection.commit();

    const io = req.app.get("socketio");

    recipients.forEach((recipient) => {
      io.to(`user-${recipient.id}`).emit("new_notification", {
        title: "New Announcement",
        message: "A new announcement has been posted.",
        type: "announcement",
        link: result.insertId,
      });
    });

    res.status(201).json({
      message: "Announcement posted successfully!",
      success: true,
      // data: newAnnouncement[0],
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

    // Destructure the possible updates from the body
    const { category_id, title, content } = req.body;

    const finalCategoryId = category_id ? Number(category_id) : null;

    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    await connection.beginTransaction();

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

    // Fetch fresh data so the UI and Sockets get the labels/colors
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

    await connection.commit();

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
    const [result] = await db.execute(
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
