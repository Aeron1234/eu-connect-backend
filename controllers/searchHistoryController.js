import { db } from "../config/db.js"; // Adjust the path to your DB connection instance

// 🔍 A. SEARCH USERS
export const searchUsers = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Validate search query presence
  const { q } = req.query;
  if (!q || typeof q !== "string" || q.trim() === "") {
    return res
      .status(400)
      .json({ error: "Search query string ('q') is required." });
  }

  let connection;
  try {
    connection = await db.getConnection();
    const searchTerm = `%${q.trim()}%`;

    // Searches user profiles, handles students (role_id = 1) and employers (role_id = 2)
    const query = `
        SELECT 
          up.user_id, 
          up.first_name, 
          up.last_name, 
          r.role, -- 🌟 Now returns the actual string (e.g., 'student', 'employer')
          c.course_name AS course, 
          CASE 
            WHEN r.role = 'student' THEN ir.company_name
            WHEN r.role = 'employer' THEN ebi.company_name
            ELSE NULL
          END AS company_name,
          IFNULL(ir.accumulated_hours, 0) AS hours_rendered,
          IFNULL(ir.total_hours, 0) AS total_hours
        FROM user_profiles up
        INNER JOIN users u ON up.user_id = u.id 
        -- 🌟 Join the roles table to get the readable string
        INNER JOIN roles r ON u.role_id = r.id
        LEFT JOIN student_academic_info sai ON up.user_id = sai.user_id
        LEFT JOIN courses c ON sai.course_id = c.id
        LEFT JOIN internship_records ir ON up.user_id = ir.user_id AND ir.status = 'ongoing'
        LEFT JOIN employer_background_info ebi ON up.user_id = ebi.user_id
        WHERE up.first_name LIKE ? 
          OR up.last_name LIKE ? 
          OR ir.company_name LIKE ?
          OR ebi.company_name LIKE ?
        LIMIT 10;
    `;

    const [users] = await connection.execute(query, [
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
    ]);

    res.status(200).json({ success: true, users });
  } catch (error) {
    console.error("Search users database query failure:", error);
    res.status(500).json({ error: "Failed to execute user search." });
  } finally {
    if (connection) connection.release();
  }
};

// 💾 B. SAVE / UPSERT SEARCH HISTORY
export const saveSearchHistory = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Ensure user is authenticated
  const { id: userId } = req.verifiedUser;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  const { type, searched_id, searched_uuid } = req.body;

  // 🛡️ GUARD CLAUSE: Ensure type is provided and valid
  if (!type || typeof type !== "string") {
    return res
      .status(400)
      .json({ error: "Search type (e.g., 'user', 'document') is required." });
  }

  // 🛡️ GUARD CLAUSE: Polymorphic target validation
  if (type === "user" && !searched_uuid) {
    return res.status(400).json({
      error:
        "searched_uuid is required when saving a user search history entry.",
    });
  }
  if (type !== "user" && !searched_id) {
    return res
      .status(400)
      .json({ error: "searched_id is required for this history type." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // Check if this record already exists in the history to avoid duplicate items
    const [existing] = await connection.execute(
      `SELECT id FROM search_history 
       WHERE user_id = ? AND type = ? 
         AND (searched_id = ? OR (searched_id IS NULL AND ? IS NULL))
         AND (searched_uuid = ? OR (searched_uuid IS NULL AND ? IS NULL))`,
      [
        userId,
        type,
        searched_id || null,
        searched_id || null,
        searched_uuid || null,
        searched_uuid || null,
      ],
    );

    if (existing.length > 0) {
      // 🛡️ GUARD CLAUSE/UPSERT FLOW: Bring existing entry to the top
      await connection.execute(
        `UPDATE search_history SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing[0].id],
      );
    } else {
      // Insert new search record
      await connection.execute(
        `INSERT INTO search_history (user_id, type, searched_id, searched_uuid) 
         VALUES (?, ?, ?, ?)`,
        [userId, type, searched_id || null, searched_uuid || null],
      );
    }

    res.status(200).json({ success: true, message: "Search history updated." });
  } catch (error) {
    console.error("Save search history failure:", error);
    res.status(500).json({ error: "Failed to update search history." });
  } finally {
    if (connection) connection.release();
  }
};

// 📅 C. GET RECENTLY VIEWED HISTORY
export const getSearchHistory = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Ensure user is authenticated
  const userId = req.verifiedUser?.id;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  // 🛡️ GUARD CLAUSE: Ensure requested search type parameter is valid
  const { type } = req.query;
  if (!type || typeof type !== "string") {
    return res
      .status(400)
      .json({ error: "Type query parameter (e.g., ?type=user) is required." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const query = `
      SELECT 
        sh.id AS history_id,
        sh.type,
        sh.searched_uuid,
        sh.searched_id,
        sh.updated_at,
        up.first_name,
        up.last_name,
        r.role, -- 🌟 Now returns 'student', 'employer', etc.
        c.course_name AS course, 
        CASE 
          WHEN r.role = 'student' THEN ir.company_name
          WHEN r.role = 'employer' THEN ebi.company_name
          ELSE NULL
        END AS company_name,
        IFNULL(ir.accumulated_hours, 0) AS hours_rendered,
        IFNULL(ir.total_hours, 0) AS total_hours
      FROM search_history sh
      LEFT JOIN user_profiles up ON sh.searched_uuid = up.user_id AND sh.type = 'user'
      LEFT JOIN users u ON up.user_id = u.id
      -- 🌟 Join the roles table
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN student_academic_info sai ON up.user_id = sai.user_id
      LEFT JOIN courses c ON sai.course_id = c.id
      LEFT JOIN internship_records ir ON up.user_id = ir.user_id AND ir.status = 'ongoing'
      LEFT JOIN employer_background_info ebi ON up.user_id = ebi.user_id
      WHERE sh.user_id = ? AND sh.type = ?
      ORDER BY sh.updated_at DESC
      LIMIT 10;
    `;

    const [history] = await connection.execute(query, [userId, type]);
    res.status(200).json({ success: true, history });
  } catch (error) {
    console.error("Get search history query failure:", error);
    res.status(500).json({ error: "Failed to retrieve search history." });
  } finally {
    if (connection) connection.release();
  }
};

// 🧹 D. CLEAR ALL SEARCH HISTORY
export const clearSearchHistory = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Ensure user is authenticated
  const { id: userId } = req.verifiedUser;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  // 🛡️ GUARD CLAUSE: Ensure a specific search history type to clear is passed
  const { type } = req.query;
  if (!type || typeof type !== "string") {
    return res.status(400).json({
      error:
        "Type query parameter (e.g., ?type=user) is required to clear history.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const [result] = await connection.execute(
      `DELETE FROM search_history WHERE user_id = ? AND type = ?`,
      [userId, type],
    );

    // 🛡️ GUARD CLAUSE: Verify if records were actually deleted
    if (result.affectedRows === 0) {
      return res.status(200).json({
        success: true,
        message: "No history records found to clear for this category.",
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Search history cleared cleanly." });
  } catch (error) {
    console.error("Clear search history error:", error);
    res.status(500).json({ error: "Failed to clear search history." });
  } finally {
    if (connection) connection.release();
  }
};

// E. DELETE SPECIFIC HISTORY
export const deleteSearchHistory = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Ensure user is authenticated
  const { id: userId } = req.verifiedUser;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  // Accept history ID from params or query/body identifiers
  const { historyId } = req.params;
  const { type } = req.query;

  if (!type) {
    return res
      .status(400)
      .json({ error: "Type is required to locate history entry." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const [result] = await connection.execute(
      `DELETE FROM search_history WHERE id = ? AND user_id = ? AND type = ?`,
      [historyId, userId, type],
    );

    // 🛡️ GUARD CLAUSE: Check if anything was deleted
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: "Search history item not found or already deleted." });
    }

    res
      .status(200)
      .json({ success: true, message: "Search history item deleted." });
  } catch (error) {
    console.error("Delete single search history error:", error);
    res.status(500).json({ error: "Failed to delete search history item." });
  } finally {
    if (connection) connection.release();
  }
};
