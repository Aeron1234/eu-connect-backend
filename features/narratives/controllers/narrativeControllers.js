import { reportError } from "../../../config/errorTracking.js";
import { db } from "../../../config/db.js";

export const getAllNarratives = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Verify user identity
  const userId = req.verifiedUser?.id;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  const { internshipId } = req.query;

  // 🌟 PAGE-BASED PAGINATION (Matches getAllNotifications implementation)
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  if (!internshipId) {
    return res.status(400).json({ error: "Internship ID is required." });
  }

  let connection;
  try {
    // Acquire explicit pool connection
    connection = await db.getConnection();

    // Query 1: Fetch paginated narrative records
    const narrativesQuery = `
      SELECT id, user_id, internship_id, day_number, title, narrative, created_at, updated_at
      FROM daily_narratives 
      WHERE user_id = ? AND internship_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Query 2: Single-pass statistical aggregation (Total Entries, Latest Day, Total Words, This Week)
    const statsQuery = `
      SELECT 
        COUNT(*) AS total_entries,
        IFNULL(MAX(day_number), 0) AS latest_day,
        IFNULL(SUM(
          CASE 
            WHEN CHAR_LENGTH(TRIM(narrative)) = 0 THEN 0
            ELSE CHAR_LENGTH(TRIM(narrative)) - CHAR_LENGTH(REPLACE(TRIM(narrative), ' ', '')) + 1
          END
        ), 0) AS total_words,
        COUNT(CASE WHEN YEARWEEK(created_at, 1) = YEARWEEK(NOW(), 1) THEN 1 END) AS entries_this_week
      FROM daily_narratives
      WHERE user_id = ? AND internship_id = ?
    `;

    // Execute queries in parallel using the allocated connection thread
    const [[narratives], [statsResult]] = await Promise.all([
      connection.execute(narrativesQuery, [
        userId,
        internshipId,
        limit,
        offset,
      ]),
      connection.execute(statsQuery, [userId, internshipId]),
    ]);

    const stats = statsResult[0] || {
      total_entries: 0,
      latest_day: 0,
      total_words: 0,
      entries_this_week: 0,
    };

    const totalRecords = Number(stats.total_entries);
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      narratives,
      stats: {
        totalEntries: totalRecords,
        latestDay: Number(stats.latest_day),
        totalWords: Number(stats.total_words),
        thisWeek: Number(stats.entries_this_week),
      },
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    reportError("Get all narratives query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get narratives.",
    });
  } finally {
    // Ensure pool connection thread is always released back to pool safely
    if (connection) connection.release();
  }
};

export const createNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { day_number, title, narrative } = req.body;
    const internshipId = req.query.internshipId;

    if (!Number(day_number) || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (!internshipId) {
      return res.status(400).json({
        error: "No ongoing internship.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO daily_narratives (user_id, internship_id, day_number, title, narrative)
        VALUES (?, ?, ?, ?, ?)`,
      [userId, internshipId, Number(day_number), title, narrative.trim()],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Posting Narrative failed.",
      });
    }

    res.status(201).json({
      message: "Narrative added!",
      success: true,
    });
  } catch (error) {
    console.log("Create narrative error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const editNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { narrativeId } = req.params;
    const { internshipId } = req.query;

    const { day_number, title, narrative } = req.body;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    if (!narrativeId) {
      return res.status(400).json({ error: "Narrative ID is required." });
    }

    if (!day_number || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({
        error: "All fields (Day, Title, and Narrative) are required.",
      });
    }

    const [result] = await db.execute(
      `
      UPDATE daily_narratives
      SET
        day_number = COALESCE(?, day_number),
        title = COALESCE(?, title),
        narrative = COALESCE(?, narrative),
        updated_at = NOW()
      WHERE id = ? AND user_id = ? AND internship_id = ?
      `,
      [
        day_number || null,
        title.trim() || null,
        narrative.trim() || null,
        narrativeId,
        userId,
        internshipId,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Failed to update narrative or can't find the narrative.",
      });
    }

    res.status(200).json({
      message: "Narrative updated successfully!",
      success: true,
    });
  } catch (error) {
    console.log("Edit narrative error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const deleteDailyNarrative = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id } = req.verifiedUser;
    const narrativeId = req.params.narrativeId;

    if (!narrativeId) {
      return res.status(400).json({ error: "Narrative ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `DELETE FROM daily_narratives WHERE id = ? AND user_id = ?`,
      [narrativeId, id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "Narrative record not found or you do not have permission to delete it.",
      });
    }

    await connection.commit();
    res.status(200).json({
      message: "Record deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Delete narrative error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getSearchedStudentNarratives = async (req, res) => {
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  // 🌟 PAGE-BASED PAGINATION (Matches getAllNarratives implementation)
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  let connection;
  try {
    connection = await db.getConnection();

    // Query 1: Fetch paginated narratives for the student's ongoing internship
    const narrativesQuery = `
      SELECT 
        dn.id,
        dn.user_id,
        dn.internship_id,
        dn.day_number,
        dn.title,
        dn.narrative,
        dn.created_at,
        dn.updated_at
      FROM daily_narratives dn
      INNER JOIN internship_records ir 
         ON dn.internship_id = ir.id
      WHERE dn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
      ORDER BY dn.day_number DESC, dn.created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Query 2: Total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM daily_narratives dn
      INNER JOIN internship_records ir 
         ON dn.internship_id = ir.id
      WHERE dn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
    `;

    // Execute queries in parallel using the allocated connection thread
    const [[narratives], [countResult]] = await Promise.all([
      connection.execute(narrativesQuery, [searchedUserId, limit, offset]),
      connection.execute(countQuery, [searchedUserId]),
    ]);

    const totalRecords = Number(countResult[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      narratives,
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    reportError("Get searched user narratives query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get daily narrative logs.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordNarratives = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT id, day_number, title, narrative, created_at, updated_at
       FROM daily_narratives
       WHERE internship_id = ?
       ORDER BY day_number ASC
       LIMIT 100`,
      [internshipId],
    );

    res.status(200).json(rows);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    reportError("Get internship record narratives error:", error);
    res.status(500).json({ error: "Failed to load narratives." });
  } finally {
    if (connection) connection.release();
  }
};
