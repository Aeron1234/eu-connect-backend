import { reportError } from "../../../config/errorTracking.js";
import { invalidateWeeklyNarrativesCache } from "../../../config/cache/weeklyNarrativesCache.js";
import { weeklyNarrativesCacheHit } from "../../../middleware/weekly-narratives-cache.js";
import { db } from "../../../config/db.js";
import { verifyRecordAccess } from "../../../config/helpers.js";
import { assertInternshipStarted } from "../../../config/internshipStart.js";
import { parseNarrativeDateRange } from "../narrativeDates.js";

async function withNarrativeWrite(userId, internshipId, write) {
  const connection = await db.getConnection();
  let started = false;
  try {
    await connection.beginTransaction();
    started = true;
    const [records] = await connection.execute(
      `SELECT id, DATE_FORMAT(date_started, '%Y-%m-%d') AS date_started
       FROM internship_records
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'ongoing'
       LIMIT 1 FOR UPDATE`,
      [internshipId, userId],
    );
    if (!records.length) throw Object.assign(new Error("Ongoing internship record not found."), { status: 404 });
    assertInternshipStarted(records[0].date_started, "Weekly narratives");
    await write(connection);
    await connection.commit();
    started = false;
  } catch (error) {
    if (started) {
      try { await connection.rollback(); }
      catch (rollbackError) { reportError("Weekly narrative rollback failed:", rollbackError); }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export const getWeeklyNarrativesForPrint = async (req, res) => {
  const userId = req.verifiedUser?.id;
  const internshipId = req.params.internshipId;
  if (!userId || !internshipId) return res.status(400).json({ error: "Internship ID is required." });

  try {
    const [records] = await db.execute(
      `SELECT ir.id, ir.company_name,
              CONCAT_WS(' ', up.first_name,
                CASE WHEN NULLIF(TRIM(up.middle_initial), '') IS NOT NULL
                  THEN CONCAT(UPPER(LEFT(TRIM(up.middle_initial), 1)), '.') END,
                up.last_name) AS student_name
       FROM internship_records ir
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       WHERE ir.id = ? AND ir.user_id = ? AND ir.deleted_at IS NULL
         AND ir.status IN ('ongoing', 'finished') LIMIT 1`,
      [internshipId, userId],
    );
    if (!records.length) return res.status(404).json({ error: "Internship record not found." });

    const [narratives] = await db.execute(
      `SELECT week_number, title, narrative, created_at,
              DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from,
              DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
       FROM weekly_narratives
       WHERE internship_id = ? AND user_id = ?
       ORDER BY week_number ASC, created_at ASC, id ASC`,
      [internshipId, userId],
    );
    if (!narratives.length) return res.status(404).json({ error: "No weekly narratives found for this internship." });
    return res.status(200).json({ ...records[0], narratives });
  } catch (error) {
    reportError("Get weekly narratives for print failed:", error);
    return res.status(500).json({ error: "Could not prepare weekly narratives for printing." });
  }
};

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

    const narrativesQuery = `
      SELECT wn.id, wn.user_id, wn.internship_id, wn.week_number, wn.title,
             wn.narrative, wn.created_at, wn.updated_at,
             DATE_FORMAT(wn.date_from, '%Y-%m-%d') AS date_from,
             DATE_FORMAT(wn.date_to, '%Y-%m-%d') AS date_to,
             stats.total_entries, stats.latest_week, stats.total_words,
             stats.entries_this_week
      FROM weekly_narratives wn
      CROSS JOIN (${statsQuery}) stats
      WHERE wn.user_id = ? AND wn.internship_id = ?
      ORDER BY wn.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [pageRows] = await connection.execute(narrativesQuery, [
      userId,
      internshipId,
      userId,
      internshipId,
      limit,
      offset,
    ]);

    let stats = pageRows[0];
    if (!stats) {
      const [statsResult] = await connection.execute(statsQuery, [
        userId,
        internshipId,
      ]);
      stats = statsResult[0] || {
        total_entries: 0,
        latest_week: 0,
        total_words: 0,
        entries_this_week: 0,
      };
    }
    const narratives = pageRows.map(({
      total_entries, latest_week, total_words, entries_this_week, ...row
    }) => row);

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
    reportError("Get all weekly narratives query failure:", error);
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

    const dates = parseNarrativeDateRange(req.body);
    await withNarrativeWrite(userId, internshipId, async connection => {
      const [result] = await connection.execute(
        `INSERT INTO weekly_narratives (user_id, internship_id, week_number, title, narrative, date_from, date_to)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, internshipId, Number(week_number), title, narrative.trim(), dates.from, dates.to],
      );
      if (result.affectedRows === 0) throw Object.assign(new Error("Posting narrative failed."), { status: 400 });
    });

    invalidateWeeklyNarrativesCache();
    res.status(201).json({
      message: "Narrative added!",
      success: true,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
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

    const dates = parseNarrativeDateRange(req.body);
    await withNarrativeWrite(userId, internshipId, async connection => {
      const [result] = await connection.execute(
        `
        UPDATE weekly_narratives
        SET
          week_number = COALESCE(?, week_number),
          title = COALESCE(?, title),
          narrative = COALESCE(?, narrative),
          date_from = ?,
          date_to = ?,
          updated_at = NOW()
        WHERE id = ? AND user_id = ? AND internship_id = ?
        `,
        [
          week_number || null,
          title.trim() || null,
          narrative.trim() || null,
          dates.from,
          dates.to,
          narrativeId,
          userId,
          internshipId,
        ],
      );

      if (result.affectedRows === 0) {
        throw Object.assign(new Error("Failed to update narrative or can't find the narrative."), { status: 404 });
      }
    });

    invalidateWeeklyNarrativesCache();
    res.status(200).json({
      message: "Narrative updated successfully!",
      success: true,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
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
    invalidateWeeklyNarrativesCache();
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
        DATE_FORMAT(wn.date_from, '%Y-%m-%d') AS date_from,
        DATE_FORMAT(wn.date_to, '%Y-%m-%d') AS date_to,
        wn.created_at,
        wn.updated_at,
        (
          SELECT COUNT(*)
          FROM weekly_narratives countedWn
          INNER JOIN internship_records countedIr
            ON countedWn.internship_id = countedIr.id
          WHERE countedWn.user_id = ?
            AND countedIr.status = 'ongoing'
            AND countedIr.deleted_at IS NULL
        ) AS total_narratives
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

    const [pageRows] = await connection.execute(narrativesQuery,
      [searchedUserId, searchedUserId, limit, offset]);
    let totalRecords = pageRows[0]?.total_narratives;
    if (pageRows.length === 0) {
      const [[{ total }]] = await connection.execute(countQuery, [searchedUserId]);
      totalRecords = total;
    }
    totalRecords = Number(totalRecords);
    const narratives = pageRows.map(({ total_narratives, ...row }) => row);
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      narratives,
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    reportError("Get searched user weekly narratives query failure:", error);
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
    if (weeklyNarrativesCacheHit(req, res)) return;

    const [rows] = await connection.execute(
      `SELECT id, week_number, title, narrative, created_at, updated_at,
              DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from,
              DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
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
    reportError("Get internship record weekly narratives error:", error);
    res.status(500).json({ error: "Failed to load narratives." });
  } finally {
    if (connection) connection.release();
  }
};
