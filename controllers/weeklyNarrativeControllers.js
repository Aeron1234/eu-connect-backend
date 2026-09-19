import { db } from "../config/db.js";
import { verifyRecordAccess } from "../config/helpers.js";

export const getAllWeeklyNarratives = async (req, res) => {
  const userId = req.verifiedUser?.id;
  if (!userId) {
    return res
      .status(401)
      .json({ error: "Unauthorized access. Missing user identity." });
  }

  const { internshipId } = req.query;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  if (!internshipId) {
    return res.status(400).json({ error: "Internship ID is required." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const narrativesQuery = `
      SELECT id, user_id, internship_id, week_number, title, narrative, created_at, updated_at
      FROM weekly_narratives 
      WHERE user_id = ? AND internship_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const statsQuery = `
      SELECT 
        COUNT(*) AS total_entries,
        IFNULL(MAX(week_number), 0) AS latest_week,
        IFNULL(SUM(
          CASE 
            WHEN CHAR_LENGTH(TRIM(narrative)) = 0 THEN 0
            ELSE CHAR_LENGTH(TRIM(narrative)) - CHAR_LENGTH(REPLACE(TRIM(narrative), ' ', '')) + 1
          END
        ), 0) AS total_words,
        COUNT(CASE WHEN YEARWEEK(created_at, 1) = YEARWEEK(NOW(), 1) THEN 1 END) AS entries_this_week
      FROM weekly_narratives
      WHERE user_id = ? AND internship_id = ?
    `;

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
      latest_week: 0,
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
        latestWeek: Number(stats.latest_week),
        totalWords: Number(stats.total_words),
        thisWeek: Number(stats.entries_this_week),
      },
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    console.error("Get all weekly narratives query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get narratives.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const createWeeklyNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { week_number, title, narrative } = req.body;
    const internshipId = req.query.internshipId;

    if (!Number(week_number) || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (!internshipId) {
      return res.status(400).json({
        error: "No ongoing internship.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO weekly_narratives (user_id, internship_id, week_number, title, narrative)
        VALUES (?, ?, ?, ?, ?)`,
      [userId, internshipId, Number(week_number), title, narrative.trim()],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Posting narrative failed.",
      });
    }

    res.status(201).json({
      message: "Narrative added!",
      success: true,
    });
  } catch (error) {
    console.log("Create weekly narrative error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const editWeeklyNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { narrativeId } = req.params;
    const { internshipId } = req.query;

    const { week_number, title, narrative } = req.body;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    if (!narrativeId) {
      return res.status(400).json({ error: "Narrative ID is required." });
    }

    if (!week_number || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({
        error: "All fields (Week, Title, and Narrative) are required.",
      });
    }

    const [result] = await db.execute(
      `
      UPDATE weekly_narratives
      SET
        week_number = COALESCE(?, week_number),
        title = COALESCE(?, title),
        narrative = COALESCE(?, narrative),
        updated_at = NOW()
      WHERE id = ? AND user_id = ? AND internship_id = ?
      `,
      [
        week_number || null,
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
    console.log("Edit weekly narrative error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const deleteWeeklyNarrative = async (req, res) => {
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
      `DELETE FROM weekly_narratives WHERE id = ? AND user_id = ?`,
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
    console.log("Delete weekly narrative error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getSearchedStudentWeeklyNarratives = async (req, res) => {
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  let connection;
  try {
    connection = await db.getConnection();

    const narrativesQuery = `
      SELECT 
        wn.id,
        wn.user_id,
        wn.internship_id,
        wn.week_number,
        wn.title,
        wn.narrative,
        wn.created_at,
        wn.updated_at
      FROM weekly_narratives wn
      INNER JOIN internship_records ir 
         ON wn.internship_id = ir.id
      WHERE wn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
      ORDER BY wn.week_number DESC, wn.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM weekly_narratives wn
      INNER JOIN internship_records ir 
         ON wn.internship_id = ir.id
      WHERE wn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
    `;

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
    console.error("Get searched user weekly narratives query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get weekly narrative logs.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordWeeklyNarratives = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT id, week_number, title, narrative, created_at, updated_at
       FROM weekly_narratives
       WHERE internship_id = ?
       ORDER BY week_number ASC
       LIMIT 100`,
      [internshipId],
    );

    res.status(200).json(rows);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record weekly narratives error:", error);
    res.status(500).json({ error: "Failed to load narratives." });
  } finally {
    if (connection) connection.release();
  }
};
