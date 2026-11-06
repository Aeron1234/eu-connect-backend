import { evaluationDeleteHandler } from "../evaluationLifecycle.js";
import { reportError } from "../../../config/errorTracking.js";
import { invalidateEvaluationHistoryCache } from "../../../config/cache/evaluationHistoryCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";
import { assertInternshipStarted } from "../../../config/internshipStart.js";
import { evaluationReadScope, departmentEvaluationRecipients } from "../evaluationAccess.js";
import { studentCriteriaDepartment, validateCriteriaScores } from "../../evaluation-criteria/criteriaDepartment.js";

// In this API, student evaluation means the employer evaluating a student.
export const getStudentEvaluationCriteria = async (req, res) => {
  let connection;
  try {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ error: "A student ID is required." });
    connection = await db.getConnection();
    const [records] = await connection.execute(
      `SELECT id FROM internship_records WHERE user_id = ? AND employer_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1`,
      [studentId, req.verifiedUser.id],
    );
    // The profile can still show historical evaluations after supervision ends.
    if (!records.length) return res.status(200).json([]);
    const departmentId = await studentCriteriaDepartment(connection, studentId);
    if (!departmentId) return res.status(404).json({ error: "Student department not found." });

    // Offer active criteria only; historical score reads still join retained inactive criteria.
    const query = `
        SELECT id, category, criterion_name 
        FROM student_evaluation_criteria
        WHERE department_id = ? AND is_active = 1
        ORDER BY id ASC
      `;

    const [rows] = await connection.execute(query, [departmentId]);

    // Group questions by category; the form submits numeric criterion IDs.
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
    console.log("Get student evaluation criteria error:", error);
    res.status(500).json({ error: "Failed to load evaluation questions." });
  } finally {
    if (connection) connection.release();
  }
};

export const getStudentCompleteEvaluations = async (req, res) => {
  res.set?.("Cache-Control", "private, no-store");
  if (!["employer", "department_head", "admin"].includes(req.verifiedUser?.role)) return res.status(403).json({ error: "Employer evaluations are confidential." });
  const { studentId } = req.params; // The searched user ID passed from the frontend

  if (!studentId) {
    return res.status(400).json({
      success: false,
      error: "Missing required student ID parameter.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const query = `
      SELECT 
        ir.id AS internship_record_id,
        ir.company_name,
        ir.internship_position,
        ir.status AS internship_status,
        m.id AS evaluation_master_id,
        m.evaluated_by,
        m.other_remarks,
        m.deleted_at,
        m.created_at AS evaluation_date,
        c.category,
        c.criterion_name,
        s.score
      FROM internship_records AS ir
      LEFT JOIN student_evaluation_masters AS m ON ir.id = m.internship_record_id
      LEFT JOIN student_evaluation_scores AS s ON m.id = s.evaluation_master_id
      LEFT JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      WHERE ir.user_id = ? AND ir.deleted_at IS NULL ${evaluationReadScope(req.verifiedUser).sql}
      ORDER BY ir.created_at DESC, m.created_at DESC, m.id DESC, c.id ASC
    `;

    const [rows] = await connection.execute(query, [studentId, ...evaluationReadScope(req.verifiedUser).params]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No internship or evaluation history found for this student.",
      });
    }

    // Build a summary for the first internship/master in the query's descending order.
    const payload = {
      student_id: studentId,
      internship_record_id: rows[0].internship_record_id,
      company_name: rows[0].company_name,
      internship_position: rows[0].internship_position,
      internship_status: rows[0].internship_status,
      is_evaluated: rows[0].evaluation_master_id !== null, // Flags if evaluation exists
      evaluation_details: null,
    };

    // Only the selected master's scores belong in this summary; history may contain multiple performance evaluations.
    if (payload.is_evaluated) {
      const categoriesByName = new Map();
      payload.evaluation_details = {
        evaluation_id: rows[0].evaluation_master_id,
        evaluated_by: rows[0].evaluated_by,
        other_remarks: rows[0].other_remarks,
        evaluation_date: rows[0].evaluation_date,
        deleted_at: rows[0].deleted_at || null,
        categories: [],
      };

      rows.forEach((row) => {
        if (!row.category || row.evaluation_master_id !== rows[0].evaluation_master_id) return; // Skip missing categories and other historical masters.

        let categoryGroup = categoriesByName.get(row.category);

        if (!categoryGroup) {
          categoryGroup = {
            category_name: row.category,
            items: [],
          };
          payload.evaluation_details.categories.push(categoryGroup);
          categoriesByName.set(row.category, categoryGroup);
        }

        categoryGroup.items.push({
          criterion: row.criterion_name,
          score: row.score,
        });
      });
    }

    return res.status(200).json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.log("Get student evaluation details error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to compile complete student data metrics.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getPastStudentEvaluations = async (req, res) => {
  res.set?.("Cache-Control", "private, no-store");
  if (!["employer", "department_head", "admin"].includes(req.verifiedUser?.role)) return res.status(403).json({ error: "Employer evaluations are confidential." });
  const { studentId } = req.params;

  if (!studentId) {
    return res.status(400).json({
      success: false,
      error: "Missing required student ID parameter.",
    });
  }

  const POINTS_PER_CRITERION = 5;

  let connection;
  try {
    connection = await db.getConnection();

    const query = `
      SELECT 
        m.id AS evaluation_id,
        m.deleted_at, m.internship_record_id,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.evaluated_by AS evaluator_id,
        m.reviewed_by,
        m.reviewed_at,
        m.review_notes,
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS evaluator,
        CONCAT(reviewer_up.first_name, ' ', reviewer_up.last_name) AS reviewer_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM student_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN student_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      JOIN user_profiles AS up ON m.evaluated_by = up.user_id
      LEFT JOIN user_profiles AS reviewer_up ON m.reviewed_by = reviewer_up.user_id
      WHERE ir.user_id = ? AND ir.deleted_at IS NULL ${evaluationReadScope(req.verifiedUser).sql}
      ORDER BY m.created_at DESC, m.id DESC, c.id ASC
    `;

    const [rows] = await connection.execute(query, [studentId, ...evaluationReadScope(req.verifiedUser).params]);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const evaluationsGroup = {};
    const categoryGroups = new Map();

    rows.forEach((row) => {
      const evalId = row.evaluation_id;

      if (!evaluationsGroup[evalId]) {
        const dateObj = new Date(row.submitted_date);

        const formattedDate = dateObj.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        const formattedPeriod = dateObj.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

        evaluationsGroup[evalId] = {
          id: evalId,
          type: "Performance Evaluation",
          status: row.deleted_at ? "Deleted" : "Submitted",
          deleted_at: row.deleted_at || null,
          internship_record_id: row.internship_record_id,
          period: formattedPeriod,
          evaluator: row.evaluator,
          evaluator_id: row.evaluator_id,
          company: row.company,
          submittedDate: formattedDate,
          comments: row.comments || "",
          reviewed_by: row.reviewed_by || null,
          reviewer_name: row.reviewer_name || null,
          reviewed_at: row.reviewed_at || null,
          review_notes: row.review_notes || null,
          breakdown: [],
        };
        categoryGroups.set(evalId, new Map());
      }

      const categories = categoryGroups.get(evalId);
      const existingCategory = categories.get(row.breakdown_label);

      const currentScore = Number(row.breakdown_score);

      if (existingCategory) {
        existingCategory.score += currentScore;
        existingCategory.max += POINTS_PER_CRITERION;
      } else {
        const category = {
          label: row.breakdown_label,
          score: currentScore,
          max: POINTS_PER_CRITERION,
        };
        evaluationsGroup[evalId].breakdown.push(category);
        categories.set(row.breakdown_label, category);
      }
    });

    const evaluationsList = Object.values(evaluationsGroup);

    return res.status(200).json({
      success: true,
      data: evaluationsList,
    });
  } catch (error) {
    reportError("Get all student evaluations error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to compile historical evaluation records.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const createStudentEvaluation = async (req, res) => {
  const { other_remarks, scores, student_id } = req.body;
  const evaluated_by = req.verifiedUser?.id;

  // Require a target student, authenticated evaluator and score array.
  if (!student_id || !evaluated_by || !Array.isArray(scores)) {
    return res.status(400).json({
      error: "Incomplete submission. Missing required evaluation meta-data.",
    });
  }

  // Reject blank or out-of-range submitted values; zero is a valid score.
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

    // Lock the student's live ongoing internship before checking the accepted
    // supervisor and Philippine start date. Each performance review gets its own master.
    const [records] = await connection.execute(
      `SELECT id, company_name, employer_id, DATE_FORMAT(date_started, '%Y-%m-%d') AS date_started FROM internship_records
       WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [student_id],
    );

    if (records.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "Submission rejected. This student does not have an active, 'ongoing' internship record.",
      });
    }

    const internship_record_id = records[0].id;
    const companyName = records[0].company_name;

    // Use the authenticated evaluator and current assignment; never authorize
    // an employer from a submitted evaluated_by value.
    if (records[0].employer_id !== evaluated_by) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "Only this student's accepted supervisor can submit their evaluation.",
      });
    }
    const departmentId = await studentCriteriaDepartment(connection, student_id);
    if (!departmentId || !(await validateCriteriaScores(connection, "student_evaluation_criteria", departmentId, scores))) {
      await connection.rollback();
      return res.status(400).json({ error: "Answer every current evaluation criterion for this student's department." });
    }

    assertInternshipStarted(records[0].date_started, "Student evaluations");

    const [employerProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [evaluated_by],
    );

    const employerName =
      employerProfile.length > 0
        ? `${employerProfile[0].first_name} ${employerProfile[0].last_name}`
        : "Your Supervisor";

    const masterId = newUUID();

    // Accepted supervisors submit directly; student confirmation is not part of this private workflow.
    const masterQuery = `
      INSERT INTO student_evaluation_masters (id, internship_record_id, evaluated_by, other_remarks)
      VALUES (?, ?, ?, ?)
    `;
    await connection.execute(masterQuery, [
      masterId,
      internship_record_id,
      evaluated_by,
      other_remarks || null,
    ]);

    // Active IDs were validated for this student's department above. Master and
    // score writes share the transaction, so a failed score cannot leave a master.
    const scoreQuery = `
      INSERT INTO student_evaluation_scores (evaluation_master_id, criterion_id, score)
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

    // The notification link targets the internship record; link_uuid identifies
    // the evaluation for cleanup. Notify department heads without exposing scores.
    const recipients = await departmentEvaluationRecipients(connection, student_id);
    const notifTitle = "Student Evaluation Submitted";
    const notifMessage = `${employerName} submitted a student performance evaluation for ${companyName}.`;

    for (const recipient of recipients) await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES (?, ?, 'evaluation_submitted', ?, ?, ?, ?)`,
      [
        recipient.id,
        evaluated_by,
        notifTitle,
        notifMessage,
        internship_record_id,
        masterId,
      ],
    );

    // A caught log-insert error does not by itself abort this submission.
    // Keep scores out of audit metadata; the evaluation tables store them.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          evaluated_by,
          "employer",
          "student_evaluation_submitted",
          "student_evaluation_masters",
          masterId,
          `${employerName} submitted a confidential performance evaluation for a student at ${companyName}.`,
          JSON.stringify({
            internship_record_id,
            student_id,

          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (student evaluation submitted):",
        logError,
      );
    }

    await connection.commit();
    invalidateEvaluationHistoryCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    // Deliver department-head notifications only after commit and cache invalidation.
    // Socket delivery failures are logged without undoing the committed evaluation.
    const io = req.app.get("socketio");
    if (io) {
      for (const recipient of recipients) {
        try {
          io.to(`user-${recipient.id}`).emit("new_notification", {
            title: notifTitle, message: notifMessage, type: "evaluation_submitted",
            link: internship_record_id, link_uuid: masterId,
          });
        } catch (deliveryError) {
          reportError("Evaluation notification delivery failed:", deliveryError);
        }
      }
    }

    res.status(201).json({
      success: true,
      message:
        "Evaluation submitted successfully. The student's department head has been notified.",
      evaluationId: masterId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    // An older deployment may still enforce the retired performance unique index.
    // Give an actionable error without telling employers to delete earlier reviews.
    if (error?.code === "ER_DUP_ENTRY" && /uq_student_evaluation_active_slot/.test(error.sqlMessage || error.message || "")) {
      return res.status(503).json({
        error: "Multiple performance evaluations require a database update. Please ask your administrator to apply the evaluation migration.",
        code: "EVALUATION_SCHEMA_UPGRADE_REQUIRED",
      });
    }
    if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "The evaluation could not be saved because of a conflicting record. Refresh and try again." });
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    console.log("Post student evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process evaluation submission safely.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteStudentEvaluation = evaluationDeleteHandler({ table: 'student_evaluation_masters', scoresTable: 'student_evaluation_scores', ownerColumn: 'evaluated_by', authorRole: 'employer' });

// Retired confirmation/dispute routes reject requests rather than mutate private evaluations.
export const respondToStudentEvaluation = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const restoreDisputedEvaluation = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const reviewDisputedEvaluation = async (req, res) => res.status(410).json({ error: 'Evaluation confirmation, disputes and reviews are no longer used.' });

export const getDisputedStudentEvaluations = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const getAllStudentEvaluations = async (req, res) => {
  const { id: studentId } = req.verifiedUser;

  const POINTS_PER_CRITERION = 5;

  let connection;
  try {
    connection = await db.getConnection();

    // The student's history contains their own undeleted Supervisor Evaluations only.
    // It excludes confidential employer Performance Evaluations; legacy reviewer fields stay null.
    const givenQuery = `
      SELECT 
        m.id AS evaluation_id,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.student_id AS actor_id,
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS actor_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM employer_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN employer_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN employer_evaluation_criteria AS c ON s.criterion_id = c.id
      LEFT JOIN user_profiles AS up ON m.employer_id = up.user_id
      WHERE m.student_id = ? AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, c.category ASC
    `;

    const [givenRows] = await connection.execute(givenQuery, [studentId]);

    function groupRows(rows, type, actorLabel) {
      const group = {};
      const categoryGroups = new Map();

      rows.forEach((row) => {
        const evalId = row.evaluation_id;

        if (!group[evalId]) {
          const dateObj = new Date(row.submitted_date);

          const formattedDate = dateObj.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          const formattedPeriod = dateObj.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          });

          group[evalId] = {
            id: evalId,
            type,
            status: "Submitted",
            period: formattedPeriod,
            evaluator:
              actorLabel === "self"
                ? "You"
                : row.actor_name || "Your Supervisor",
            evaluator_id: row.actor_id,
            company: row.company,
            submittedDate: formattedDate,
            comments: row.comments || "",
            reviewed_by: row.reviewed_by || null,
            reviewer_name: row.reviewer_name || null,
            reviewed_at: row.reviewed_at || null,
            review_notes: row.review_notes || null,
            breakdown: [],
          };
          categoryGroups.set(evalId, new Map());
        }

        const categories = categoryGroups.get(evalId);
        const existingCategory = categories.get(row.breakdown_label);

        const currentScore = Number(row.breakdown_score);

        if (existingCategory) {
          existingCategory.score += currentScore;
          existingCategory.max += POINTS_PER_CRITERION;
        } else {
          const category = {
            label: row.breakdown_label,
            score: currentScore,
            max: POINTS_PER_CRITERION,
          };
          group[evalId].breakdown.push(category);
          categories.set(row.breakdown_label, category);
        }
      });

      return Object.values(group);
    }

    const given = groupRows(givenRows, "Supervisor Evaluation", "self");

    const combined = [...given].sort(
      (a, b) => new Date(b.submittedDate) - new Date(a.submittedDate),
    );

    return res.status(200).json({
      success: true,
      data: combined,
    });
  } catch (error) {
    reportError("Get all student evaluations error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to compile evaluation history.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getStudentEvaluationForPrint = async (req, res) => {
  let connection;
  try {
    const { role } = req.verifiedUser;
    const { evaluationId } = req.params;

    if (!["employer", "department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Not authorized." });
    }

    connection = await db.getConnection();

    // Authorize the PDF header read with the same current role/department scope
    // as history. Employers cannot print deleted entries; authorized staff can.
    const [headerRows] = await connection.execute(
      `SELECT 
         sem.id, sem.evaluated_by, sem.other_remarks, sem.deleted_at, sem.created_at,
         ir.company_name, ir.user_id AS record_owner_id,
         up.first_name, up.last_name,
         d.name AS department_name
       FROM student_evaluation_masters sem
       INNER JOIN internship_records ir ON ir.id = sem.internship_record_id
       INNER JOIN user_profiles up ON up.user_id = ir.user_id
       INNER JOIN student_academic_info sai ON sai.user_id = ir.user_id
         AND sai.id = (SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id)
       INNER JOIN departments d ON d.id = sai.department_id
       WHERE sem.id = ? AND ir.deleted_at IS NULL ${evaluationReadScope(req.verifiedUser, "sem").sql}
       LIMIT 1`,
      [evaluationId, ...evaluationReadScope(req.verifiedUser, "sem").params],
    );

    if (headerRows.length === 0) {
      return res.status(404).json({ error: "Evaluation not found." });
    }

    const header = headerRows[0];

    const [scoreRows] = await connection.execute(
      `SELECT sec.category, sec.criterion_name, ses.score
       FROM student_evaluation_scores ses
       INNER JOIN student_evaluation_criteria sec ON sec.id = ses.criterion_id
       WHERE ses.evaluation_master_id = ?
       ORDER BY sec.id ASC`,
      [evaluationId],
    );

    const categories = {};
    scoreRows.forEach((row) => {
      if (!categories[row.category]) categories[row.category] = [];
      categories[row.category].push({
        criterion_name: row.criterion_name,
        score: row.score,
      });
    });

    res.status(200).json({
      id: header.id,
      student_name: `${header.first_name} ${header.last_name}`,
      company_name: header.company_name,
      department_name: header.department_name,
      other_remarks: header.other_remarks,
      created_at: header.created_at,
      categories: Object.entries(categories).map(([category, items]) => ({
        category,
        items,
      })),
    });
  } catch (error) {
    reportError("Get student evaluation for print error:", error);
    res.status(500).json({ error: "Failed to load evaluation." });
  } finally {
    if (connection) connection.release();
  }
};
