import { reportError } from "../../../config/errorTracking.js";
import { invalidateEvaluationHistoryCache } from "../../../config/cache/evaluationHistoryCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";
import { assertInternshipStarted } from "../../../config/internshipStart.js";
import { evaluationReadScope, departmentEvaluationRecipients } from "../evaluationAccess.js";

export const getStudentEvaluationCriteria = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    // Pull the clean schema rows directly from your database table
    const query = `
        SELECT id, category, criterion_name 
        FROM student_evaluation_criteria
        WHERE is_active = 1
        ORDER BY id ASC
      `;

    const [rows] = await connection.execute(query);

    // Group the flat database rows into your required frontend array structure
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
        id: row.criterion_name, // Matches your frontend state key (e.g., "grooming")
        db_id: row.id, // The actual auto-increment integer ID from your database
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
        m.created_at AS evaluation_date,
        c.category,
        c.criterion_name,
        s.score
      FROM internship_records AS ir
      LEFT JOIN student_evaluation_masters AS m ON ir.id = m.internship_record_id
      LEFT JOIN student_evaluation_scores AS s ON m.id = s.evaluation_master_id
      LEFT JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      WHERE ir.user_id = ? AND ir.deleted_at IS NULL ${evaluationReadScope(req.verifiedUser).sql}
      ORDER BY ir.created_at DESC, c.id ASC
    `;

    const [rows] = await connection.execute(query, [studentId, ...evaluationReadScope(req.verifiedUser).params]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No internship or evaluation history found for this student.",
      });
    }

    // 1. Map the structural core internship information
    const payload = {
      student_id: studentId,
      internship_record_id: rows[0].internship_record_id,
      company_name: rows[0].company_name,
      internship_position: rows[0].internship_position,
      internship_status: rows[0].internship_status,
      is_evaluated: rows[0].evaluation_master_id !== null, // Flags if evaluation exists
      evaluation_details: null,
    };

    // 2. If an evaluation master entry exists, populate the score groupings
    if (payload.is_evaluated) {
      const categoriesByName = new Map();
      payload.evaluation_details = {
        evaluation_id: rows[0].evaluation_master_id,
        evaluated_by: rows[0].evaluated_by,
        other_remarks: rows[0].other_remarks,
        evaluation_date: rows[0].evaluation_date,
        categories: [],
      };

      rows.forEach((row) => {
        if (!row.category) return; // Guard against broken entries

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
        m.status AS evaluation_status,
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
      ORDER BY m.created_at DESC, c.id ASC
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
          status: row.evaluation_status === "completed" ? "Submitted" :
            row.evaluation_status.charAt(0).toUpperCase() +
            row.evaluation_status.slice(1),
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

  // 1. STRUCTURAL GUARD CLAUSE
  if (!student_id || !evaluated_by || !Array.isArray(scores)) {
    return res.status(400).json({
      error: "Incomplete submission. Missing required evaluation meta-data.",
    });
  }

  // 2. COUNTER GUARD CLAUSE
  // This could change in the future.
  // I kept this as the required number of scores per criteria that the server needs to receive so an unanswer criterion/criteria wouldn't be saved.
  const TOTAL_REQUIRED_CRITERIA = 29;

  if (scores.length < TOTAL_REQUIRED_CRITERIA) {
    return res.status(400).json({
      error: `Incomplete evaluation form. You answered ${scores.length} out of ${TOTAL_REQUIRED_CRITERIA} required criteria items.`,
    });
  }

  // 3. VALUE GUARD CLAUSE
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

    // Fetch active ongoing internship record — lock it, since we're about
    // to check who's allowed to evaluate this student
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

    // Only this internship's accepted supervisor can submit an evaluation —
    // same restriction as certificate uploads and DTR location
    if (records[0].employer_id !== evaluated_by) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "Only this student's accepted supervisor can submit their evaluation.",
      });
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
      INSERT INTO student_evaluation_masters (id, internship_record_id, evaluated_by, other_remarks, status)
      VALUES (?, ?, ?, ?, 'completed')
    `;
    await connection.execute(masterQuery, [
      masterId,
      internship_record_id,
      evaluated_by,
      other_remarks || null,
    ]);

    // 2. Prepare and run Score Statement
    const scoreQuery = `
      INSERT INTO student_evaluation_scores (evaluation_master_id, criterion_id, score)
      VALUES (?, (SELECT id FROM student_evaluation_criteria WHERE criterion_name = ? LIMIT 1), ?)
    `;

    for (const item of scores) {
      if (
        item.criterion_name === null ||
        item.criterion_name === undefined ||
        String(item.criterion_name).trim() === ""
      ) {
        continue;
      }
      const cleanScore = parseInt(item.score, 10);
      await connection.execute(scoreQuery, [
        masterId,
        item.criterion_name,
        cleanScore,
      ]);
    }

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

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual submission. No scores in metadata;
    // this table already stores those.
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
            status: "completed",
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

    // 4. Real-time Socket Event
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

export const deleteStudentEvaluation = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id: currentUserId, role: userRole } = req.verifiedUser;
    const { evaluationId } = req.params; // Route URL Parameters (:evaluationId)

    // GUARD CLAUSE: Validate that required parameters exist before executing transaction
    if (!evaluationId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter. evaluationId is required.",
      });
    }

    await connection.beginTransaction();

    // 1. Cross-reference records using only evaluationId (Retrieving internship_record_id natively)
    const [evaluationCheck] = await connection.execute(
      `SELECT 
        m.status AS evaluation_status, 
        m.evaluated_by AS employer_id,
        m.internship_record_id AS internship_id, 
        ir.user_id AS student_id,
        ir.company_name AS company
       FROM student_evaluation_masters AS m
       INNER JOIN internship_records AS ir ON m.internship_record_id = ir.id
       WHERE m.id = ?`,
      [evaluationId],
    );

    // GUARD CLAUSE: Verify the master evaluation and linked internship records exist
    if (!evaluationCheck || evaluationCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "No evaluation record found matching the provided identifier.",
      });
    }

    const evaluation = evaluationCheck[0];

    // GUARD CLAUSE: Enforce business logic rule (Only pending records can be managed/deleted)
    if (evaluation.evaluation_status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Only pending evaluations are allowed to be deleted.",
      });
    }

    const isAdmin = userRole === "admin";
    const isOwner = evaluation.employer_id === currentUserId;

    // GUARD CLAUSE: Enforce Role-Based Access Control (RBAC) security
    if (!isAdmin && !isOwner) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        error: "Access denied. Unauthorized request.",
      });
    }

    // 2. Clean up the exact pending verification notification using the precise UUID
    // in deleteStudentEvaluation, step 2
    const [deleteNotifResult] = await connection.execute(
      `DELETE FROM notifications WHERE link_uuid = ? AND type = 'evaluation_submitted'`,
      [evaluationId],
    );

    // GUARD CLAUSE: Verify the associated submission notification was successfully dropped
    if (!deleteNotifResult || deleteNotifResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error:
          "Failed to remove the corresponding pending submission notification record.",
      });
    }

    // 3. Wipe downstream dependent evaluation scores
    const [deleteScoresResult] = await connection.execute(
      `DELETE FROM student_evaluation_scores WHERE evaluation_master_id = ?`,
      [evaluationId],
    );

    // GUARD CLAUSE: Verify the score rows removal execution didn't error out out of context
    if (!deleteScoresResult) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error:
          "An error occurred while wiping dependent evaluation score matrices.",
      });
    }

    // 4. Wipe master evaluation record
    const deleteMasterQuery = isAdmin
      ? `DELETE FROM student_evaluation_masters 
     WHERE id = ? AND status = 'pending' AND internship_record_id = ?`
      : `DELETE FROM student_evaluation_masters 
     WHERE id = ? AND status = 'pending' AND evaluated_by = ? AND internship_record_id = ?`;

    const deleteMasterParams = isAdmin
      ? [evaluationId, evaluation.internship_id]
      : [evaluationId, currentUserId, evaluation.internship_id];

    const [deleteMasterResult] = await connection.execute(
      deleteMasterQuery,
      deleteMasterParams,
    );

    // GUARD CLAUSE: Ensure the primary master evaluation record was actually removed
    if (!deleteMasterResult || deleteMasterResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to delete the primary evaluation master record.",
      });
    }

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual deletion.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          currentUserId,
          userRole,
          "student_evaluation_deleted",
          "student_evaluation_masters",
          evaluationId,
          `${isAdmin ? "Admin" : "Supervisor"} deleted a pending evaluation for the internship at ${evaluation.company}.`,
          JSON.stringify({
            internship_id: evaluation.internship_id,
            student_id: evaluation.student_id,
            employer_id: evaluation.employer_id,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (student evaluation deleted):",
        logError,
      );
    }

    // 5. Build dynamic deletion notification payloads using the integer link
    const recipientsToNotify = (await departmentEvaluationRecipients(connection, evaluation.student_id)).map(recipient => ({
      id: recipient.id,
      msg: `A pending performance evaluation for a student at ${evaluation.company} has been cancelled.`,
    }));
    const notifTitle = "Evaluation Cancelled";

    if (isAdmin) {
      recipientsToNotify.push(
        {
          id: evaluation.employer_id,
          msg: `The pending performance evaluation you submitted for your intern has been removed by the Administrator.`,
        },
      );
    }

    // 6. Insert alert records safely into the notifications table
    const io = req.app.get("socketio");
    const insertNotifQuery = `
      INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) 
      VALUES (?, ?, 'evaluation_deleted', ?, ?, ?, ?)
    `;

    for (const recipient of recipientsToNotify) {
      try {
        // GUARD CLAUSE: Ensure recipient data variables are valid before running database query
        if (!recipient.id || !recipient.msg) {
          throw new Error(
            "Invalid recipient distribution data found during routing process.",
          );
        }

        const [insertResult] = await connection.execute(insertNotifQuery, [
          recipient.id,
          currentUserId,
          notifTitle,
          recipient.msg,
          evaluation.internship_id, // Safe, database-verified link (int)
          evaluationId, // link_uuid (char/string)
        ]);

        // GUARD CLAUSE: Double check that MySQL successfully inserted the structural notification log row
        if (!insertResult || insertResult.affectedRows === 0) {
          throw new Error(
            `Database failed to commit notification row for user ID: ${recipient.id}`,
          );
        }

      } catch (insertionError) {
        // Immediately abort everything if any single notification fails to generate safely
        await connection.rollback();
        reportError(
          `Notification dispatch guard triggered:`,
          insertionError.message,
        );

        return res.status(500).json({
          success: false,
          error: "Notification dispatch failed. Transaction aborted safely.",
          details: insertionError.message,
        });
      }
    }

    // Commit everything once every standalone query passes safely
    await connection.commit();
    invalidateEvaluationHistoryCache();
    invalidateNotificationsCache();
    invalidateActivityLogsCache();

    // Notify only after the data is committed and the inbox cache is cleared.
    for (const recipient of recipientsToNotify) {
      try {
        if (io) io.to(`user-${recipient.id}`).emit("new_notification", {
          title: notifTitle,
          message: recipient.msg,
          type: "evaluation_deleted",
          link: evaluation.internship_id,
          link_uuid: evaluationId,
        });
      } catch (socketError) {
        reportError("Evaluation deletion notification delivery failed:", socketError);
      }
    }

    return res.status(200).json({
      success: true,
      message:
        "Evaluation record successfully removed, and notifications cleanly updated.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Delete student evaluation error:", error);
    return res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const respondToStudentEvaluation = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const restoreDisputedEvaluation = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const reviewDisputedEvaluation = async (req, res) => {
  const { id: reviewerId, role } = req.verifiedUser; // Security gate: only staff can review
  const { evaluationId } = req.params;
  const { review_notes } = req.body;

  if (!evaluationId) {
    return res.status(400).json({ error: "Evaluation ID is required." });
  }

  if (!["department_head", "admin"].includes(role)) {
    return res.status(403).json({
      error:
        "Only a department head or admin can review a disputed evaluation.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // 1. Verify the evaluation exists and is currently disputed —
    // reviewing doesn't require ownership of the internship, since this
    // is a staff-side action, not the student's own
    const [evaluationCheck] = await connection.execute(
      `SELECT m.status,
              (SELECT ir.company_name FROM internship_records ir
               WHERE ir.id = m.internship_record_id) AS company_name
       FROM student_evaluation_masters m
       WHERE m.id = ? FOR UPDATE`,
      [evaluationId],
    );

    if (evaluationCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Evaluation record not found." });
    }

    if (evaluationCheck[0].status !== "disputed") {
      await connection.rollback();
      return res.status(400).json({
        error: "Only a disputed evaluation can be marked as reviewed.",
      });
    }

    // 2. Record who reviewed it, when, and any notes — this does NOT
    // change `status`. Reviewing acknowledges the dispute was looked at;
    // it doesn't overturn it. The student's dispute still stands unless
    // they themselves restore it via restoreDisputedEvaluation.
    await connection.execute(
      `UPDATE student_evaluation_masters 
       SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
       WHERE id = ?`,
      [reviewerId, review_notes || null, evaluationId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual review. review_notes is left out
    // of metadata deliberately — it already lives on the row itself
    // (reviewed_by/review_notes), no need to duplicate it here.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          reviewerId,
          role,
          "student_evaluation_reviewed",
          "student_evaluation_masters",
          evaluationId,
          `${role === "admin" ? "Admin" : "Department head"} marked the disputed evaluation for ${evaluationCheck[0].company_name || "the associated internship"} as reviewed.`,
          JSON.stringify({ has_review_notes: Boolean(review_notes) }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (student evaluation reviewed):",
        logError,
      );
    }

    await connection.commit();
    invalidateEvaluationHistoryCache();

    invalidateActivityLogsCache();

    res.status(200).json({
      success: true,
      message: "Disputed evaluation marked as reviewed.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Review disputed evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getDisputedStudentEvaluations = async (req, res) => res.status(403).json({ error: "Employer evaluations are confidential and do not require student confirmation." });

export const getAllStudentEvaluations = async (req, res) => {
  const { id: studentId } = req.verifiedUser;

  const POINTS_PER_CRITERION = 5;

  let connection;
  try {
    connection = await db.getConnection();

    // 2. Evaluations the student submitted ABOUT their supervisor —
    // this direction has no review step, so reviewer fields stay null
    const givenQuery = `
      SELECT 
        m.id AS evaluation_id,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.employer_id AS actor_id,
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS actor_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM employer_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN employer_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN employer_evaluation_criteria AS c ON s.criterion_id = c.id
      LEFT JOIN user_profiles AS up ON m.employer_id = up.user_id
      WHERE m.student_id = ?
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
            status: "Confirmed",
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

    const [headerRows] = await connection.execute(
      `SELECT 
         sem.id, sem.evaluated_by, sem.other_remarks, sem.status, sem.created_at,
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
