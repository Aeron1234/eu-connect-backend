import { evaluationDeleteHandler } from "../evaluationLifecycle.js";
import { reportError } from "../../../config/errorTracking.js";
import { invalidateEvaluationHistoryCache } from "../../../config/cache/evaluationHistoryCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";
import { studentCriteriaDepartment, validateCriteriaScores } from "../../evaluation-criteria/criteriaDepartment.js";

// Students evaluate the company of their current ongoing internship.
export const getEvaluationCriterias = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const departmentId = await studentCriteriaDepartment(connection, req.verifiedUser.id);
    if (!departmentId) return res.status(404).json({ error: "Student department not found." });

    // Offer active questions only; inactive rows remain available to historical score joins.
    const query = `
      SELECT id, category, criterion_name 
      FROM company_evaluation_criteria
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

export const createCompanyEvaluation = async (req, res) => {
  const { id: studentId, role } = req.verifiedUser;
  const { other_remarks, scores } = req.body;

  // Scores apply to department-owned company criteria.

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

    // Lock the current ongoing internship; company evaluations do not require a supervisor.
    const [records] = await connection.execute(
      `SELECT id, company_name FROM internship_records WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
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
    if (!departmentId || !(await validateCriteriaScores(connection, "company_evaluation_criteria", departmentId, scores))) {
      await connection.rollback();
      return res.status(400).json({ error: "Answer every current evaluation criterion for your department." });
    }

    const evaluationPeriod = new Date().toISOString().slice(0, 7); // UTC YYYY-MM display label, not a posting limit.

    const masterId = newUUID();

    await connection.execute(
      `INSERT INTO company_evaluation_masters (id, internship_record_id, student_id, other_remarks, evaluation_period)
       VALUES (?, ?, ?, ?, ?)`,
      [
        masterId,
        internship.id,
        studentId,
        other_remarks || null,
        evaluationPeriod,
      ],
    );

    const scoreQuery = `
      INSERT INTO company_evaluation_scores (evaluation_master_id, criterion_id, score)
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
          "company_evaluation_submitted",
          "company_evaluation_masters",
          masterId,
          `Student submitted a company evaluation for their internship at ${internship.company_name}.`,
          JSON.stringify({
            internship_record_id: internship.id,
            evaluation_period: evaluationPeriod,
            criteria_count: scores.length,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (company evaluation):",
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
      message: "Company evaluation submitted successfully.",
      evaluationId: masterId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "The evaluation could not be saved because of a conflicting record. Refresh and try again." });
    reportError("Create company evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit company evaluation.",
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
         ir.company_name
       FROM company_evaluation_masters m
       INNER JOIN internship_records ir ON m.internship_record_id = ir.id
       WHERE m.student_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [studentId],
    );

    if (masters.length === 0) return res.status(200).json([]);

    const masterIds = masters.map((m) => m.id);
    const placeholders = masterIds.map(() => "?").join(",");

    const [scores] = await connection.execute(
      `SELECT s.evaluation_master_id, c.category, s.score
       FROM company_evaluation_scores s
       JOIN company_evaluation_criteria c ON s.criterion_id = c.id
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

export const deleteCompanyEvaluation = evaluationDeleteHandler({ table: 'company_evaluation_masters', scoresTable: 'company_evaluation_scores', ownerColumn: 'student_id', authorRole: 'student' });
