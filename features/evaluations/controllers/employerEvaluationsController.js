import { evaluationDeleteHandler } from "../evaluationLifecycle.js";
import { reportError } from "../../../config/errorTracking.js";
import { invalidateEvaluationHistoryCache } from "../../../config/cache/evaluationHistoryCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";
import { studentCriteriaDepartment, validateCriteriaScores } from "../../evaluation-criteria/criteriaDepartment.js";

// In this API, employer evaluation means the student evaluating their supervisor.
export const getEvaluationCriterias = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const departmentId = await studentCriteriaDepartment(connection, req.verifiedUser.id);
    if (!departmentId) return res.status(404).json({ error: "Student department not found." });

    // Offer active questions only; inactive rows remain available to historical score joins.
    const query = `
      SELECT id, category, criterion_name 
      FROM employer_evaluation_criteria
      WHERE department_id = ? AND is_active = 1
      ORDER BY id ASC
    `;

    const [rows] = await connection.execute(query, [departmentId]);

    // Group by category; the form submits numeric IDs to preserve department scope.
    const structuredData = [];

    rows.forEach((row) => {
      let categoryGroup = structuredData.find(
        (group) => group.category === row.category,
      );

      if (!categoryGroup) {
        categoryGroup = {
          category: row.category,
          items: [],
        };
        structuredData.push(categoryGroup);
      }

      categoryGroup.items.push({
        id: row.id, // Stable criterion ID submitted with the score.
        db_id: row.id, // Existing display contract for callers that inspect stored IDs.
        name: row.criterion_name, // Display string
      });
    });

    res.status(200).json(structuredData);
  } catch (error) {
    console.log("Get evaluation criterias error:", error);
    res.status(500).json({ error: "Failed to load evaluation questions." });
  } finally {
    if (connection) connection.release();
  }
};

// Retired confirmation read: students cannot access confidential employer scores.
export const getPendingStudentEvaluations = async (req, res) => {
  return res.status(403).json({ error: "Employer evaluations are confidential." });
};

export const createEmployerEvaluation = async (req, res) => {
  const { id: studentId, role } = req.verifiedUser;
  const { other_remarks, scores } = req.body;

  // Supervisor Evaluation is the student-to-employer direction.

  if (!Array.isArray(scores)) {
    return res.status(400).json({ error: "Missing required evaluation data." });
  }

  // Validate submitted values without a fixed minimum criterion-count check.

  const hasInvalidScore = scores.some((item) => {
    if (
      item.score === null ||
      item.score === undefined ||
      String(item.score).trim() === ""
    ) {
      return true;
    }
    const numericValue = Number(item.score);
    return isNaN(numericValue) || numericValue < 0 || numericValue > 5;
  });

  if (hasInvalidScore) {
    return res.status(400).json({
      error:
        "Validation failed. One or more criteria fields contain blank or out-of-range scores.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the student's live ongoing record while resolving the accepted supervisor.
    const [records] = await connection.execute(
      `SELECT id, employer_id, company_name FROM internship_records WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [studentId],
    );

    if (records.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "You don't have an active, ongoing internship record.",
      });
    }

    const internship = records[0];
    const departmentId = await studentCriteriaDepartment(connection, studentId);
    if (!departmentId || !(await validateCriteriaScores(connection, "employer_evaluation_criteria", departmentId, scores))) {
      await connection.rollback();
      return res.status(400).json({ error: "Answer every current evaluation criterion for your department." });
    }

    if (!internship.employer_id) {
      await connection.rollback();
      return res.status(400).json({
        error:
          "You don't have an accepted supervisor yet, so there's no one to evaluate.",
      });
    }

    const evaluationPeriod = new Date().toISOString().slice(0, 7); // UTC YYYY-MM display label, not a posting limit.

    const masterId = newUUID();

    await connection.execute(
      `INSERT INTO employer_evaluation_masters (id, internship_record_id, student_id, employer_id, other_remarks, evaluation_period)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        masterId,
        internship.id,
        studentId,
        internship.employer_id,
        other_remarks || null,
        evaluationPeriod,
      ],
    );

    const scoreQuery = `
      INSERT INTO employer_evaluation_scores (evaluation_master_id, criterion_id, score)
      VALUES (?, ?, ?)
    `;

    for (const item of scores) {
      const cleanScore = parseInt(item.score, 10);
      await connection.execute(scoreQuery, [
        masterId,
        item.criterion_id,
        cleanScore,
      ]);
    }

    // A caught log-insert error does not by itself abort the submission.
    // The evaluation master and scores remain in the surrounding transaction.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          role,
          "employer_evaluation_submitted",
          "employer_evaluation_masters",
          masterId,
          `Student submitted a supervisor evaluation for their internship at ${internship.company_name}.`,
          JSON.stringify({
            internship_record_id: internship.id,
            employer_id: internship.employer_id,
            evaluation_period: evaluationPeriod,
            criteria_count: scores.length,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (employer evaluation):",
        logError,
      );
    }

    // Post immediately, with no confirmation status. Invalidate history and activity
    // data only after the master and scores commit.
    await connection.commit();
    invalidateEvaluationHistoryCache();

    invalidateActivityLogsCache();

    res.status(201).json({
      success: true,
      message: "Supervisor evaluation submitted successfully.",
      evaluationId: masterId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code === "ER_DUP_ENTRY" && /uq_employer_evaluation_active_slot/.test(error.sqlMessage || error.message || "")) {
      return res.status(503).json({
        error: "Multiple supervisor evaluations require a database update. Please ask your administrator to apply the evaluation migration.",
        code: "EVALUATION_SCHEMA_UPGRADE_REQUIRED",
      });
    }
    if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "The evaluation could not be saved because of a conflicting record. Refresh and try again." });
    reportError("Create employer evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit supervisor evaluation.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getStudentSubmittedEvaluations = async (req, res) => {
  let connection;
  try {
    const { id: studentId } = req.verifiedUser;
    connection = await db.getConnection();

    const [masters] = await connection.execute(
      `SELECT 
         m.id, m.other_remarks, m.created_at, m.evaluation_period,
         ir.company_name,
         up.first_name AS employer_first_name, up.last_name AS employer_last_name
       FROM employer_evaluation_masters m
       INNER JOIN internship_records ir ON m.internship_record_id = ir.id
       LEFT JOIN user_profiles up ON m.employer_id = up.user_id
       WHERE m.student_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [studentId],
    );

    if (masters.length === 0) return res.status(200).json([]);

    const masterIds = masters.map((m) => m.id);
    const placeholders = masterIds.map(() => "?").join(",");

    const [scores] = await connection.execute(
      `SELECT s.evaluation_master_id, c.category, s.score
       FROM employer_evaluation_scores s
       JOIN employer_evaluation_criteria c ON s.criterion_id = c.id
       WHERE s.evaluation_master_id IN (${placeholders})`,
      masterIds,
    );

    const scoresByMaster = new Map();
    for (const score of scores) {
      if (!scoresByMaster.has(score.evaluation_master_id)) {
        scoresByMaster.set(score.evaluation_master_id, []);
      }
      scoresByMaster.get(score.evaluation_master_id).push(score);
    }

    const records = masters.map((m) => {
      const masterScores = scoresByMaster.get(m.id) || [];

      const categoryMap = {};
      masterScores.forEach((s) => {
        if (!categoryMap[s.category])
          categoryMap[s.category] = { score: 0, max: 0 };
        categoryMap[s.category].score += s.score;
        categoryMap[s.category].max += 5;
      });

      const categories = Object.entries(categoryMap).map(([category, v]) => ({
        category,
        score: v.score,
        max: v.max,
      }));

      return {
        id: m.id,
        company_name: m.company_name,
        employer_name:
          `${m.employer_first_name || ""} ${m.employer_last_name || ""}`.trim() ||
          "Your Supervisor",
        other_remarks: m.other_remarks,
        evaluation_period: m.evaluation_period,
        created_at: m.created_at,
        total_score: categories.reduce((sum, c) => sum + c.score, 0),
        total_max: categories.reduce((sum, c) => sum + c.max, 0),
        categories,
      };
    });

    res.status(200).json(records);
  } catch (error) {
    reportError("Get student submitted evaluations error:", error);
    res
      .status(500)
      .json({ error: "Failed to load your submitted evaluations." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteEmployerEvaluation = evaluationDeleteHandler({ table: 'employer_evaluation_masters', scoresTable: 'employer_evaluation_scores', ownerColumn: 'student_id', authorRole: 'student' });
