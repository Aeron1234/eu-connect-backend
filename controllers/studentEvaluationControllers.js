import { db } from "../config/db.js";
import { newUUID } from "../config/helpers.js";

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
      WHERE ir.user_id = ?
      ORDER BY ir.created_at DESC, c.id ASC
    `;

    const [rows] = await connection.execute(query, [studentId]);

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
      payload.evaluation_details = {
        evaluation_id: rows[0].evaluation_master_id,
        evaluated_by: rows[0].evaluated_by,
        other_remarks: rows[0].other_remarks,
        evaluation_date: rows[0].evaluation_date,
        categories: [],
      };

      rows.forEach((row) => {
        if (!row.category) return; // Guard against broken entries

        let categoryGroup = payload.evaluation_details.categories.find(
          (cat) => cat.category_name === row.category,
        );

        if (!categoryGroup) {
          categoryGroup = {
            category_name: row.category,
            items: [],
          };
          payload.evaluation_details.categories.push(categoryGroup);
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
      WHERE ir.user_id = ?
      ORDER BY m.created_at DESC, c.category ASC
    `;

    const [rows] = await connection.execute(query, [studentId]);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const evaluationsGroup = {};

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
          status:
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
      }

      let existingCategory = evaluationsGroup[evalId].breakdown.find(
        (b) => b.label === row.breakdown_label,
      );

      const currentScore = Number(row.breakdown_score);

      if (existingCategory) {
        existingCategory.score += currentScore;
        existingCategory.max += POINTS_PER_CRITERION;
      } else {
        evaluationsGroup[evalId].breakdown.push({
          label: row.breakdown_label,
          score: currentScore,
          max: POINTS_PER_CRITERION,
        });
      }
    });

    const evaluationsList = Object.values(evaluationsGroup);

    return res.status(200).json({
      success: true,
      data: evaluationsList,
    });
  } catch (error) {
    console.error("Get all student evaluations error:", error);
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
  const { evaluated_by, other_remarks, scores, student_id } = req.body;

  // 1. STRUCTURAL GUARD CLAUSE
  if (!student_id || !evaluated_by || !Array.isArray(scores)) {
    return res.status(400).json({
      error: "Incomplete submission. Missing required evaluation meta-data.",
    });
  }

  // 2. COUNTER GUARD CLAUSE
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
      `SELECT id, company_name, employer_id FROM internship_records 
       WHERE user_id = ? AND status = 'ongoing' LIMIT 1 FOR UPDATE`,
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

    const [employerProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [evaluated_by],
    );

    const employerName =
      employerProfile.length > 0
        ? `${employerProfile[0].first_name} ${employerProfile[0].last_name}`
        : "Your Supervisor";

    const masterId = newUUID();

    // 1. Insert Master Entry as 'pending'
    const masterQuery = `
      INSERT INTO student_evaluation_masters (id, internship_record_id, evaluated_by, other_remarks, status)
      VALUES (?, ?, ?, ?, 'pending')
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

    // 3. Dispatch Notification to Student for Verification Link
    const notifTitle = "Verify Your Evaluation";
    const notifMessage = `${employerName} from ${companyName} has submitted your internship evaluation. Please confirm this was your actual supervisor to finalize your grade.`;

    // in createStudentEvaluation
    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES (?, ?, 'evaluation_submitted', ?, ?, ?, ?)`,
      [
        student_id,
        evaluated_by,
        notifTitle,
        notifMessage,
        internship_record_id,
        masterId,
      ],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual submission. No scores in metadata;
    // this table already stores those, and this is still pending student
    // verification, so it isn't final yet.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          evaluated_by,
          "employer",
          "student_evaluation_submitted",
          "student_evaluation_masters",
          masterId,
          `${employerName} submitted a pending performance evaluation for a student at ${companyName}.`,
          JSON.stringify({
            internship_record_id,
            student_id,
            status: "pending",
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (student evaluation submitted):",
        logError,
      );
    }

    await connection.commit();

    // 4. Real-time Socket Event
    const io = req.app.get("socketio");
    if (io) {
      // in the socket emit right after
      io.to(`user-${student_id}`).emit("new_notification", {
        title: notifTitle,
        message: notifMessage,
        type: "evaluation_submitted", // was "submission"
        link: internship_record_id,
        link_uuid: masterId,
      });
    }

    res.status(201).json({
      success: true,
      message:
        "Evaluation draft posted successfully! Awaiting student identity verification.",
      evaluationId: masterId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
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
          `${isAdmin ? "Admin" : "Supervisor"} deleted a pending evaluation for internship record ${evaluation.internship_id}.`,
          JSON.stringify({
            internship_id: evaluation.internship_id,
            student_id: evaluation.student_id,
            employer_id: evaluation.employer_id,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (student evaluation deleted):",
        logError,
      );
    }

    // 5. Build dynamic deletion notification payloads using the integer link
    const recipientsToNotify = [];
    const notifTitle = "Evaluation Cancelled";

    if (isAdmin) {
      recipientsToNotify.push(
        {
          id: evaluation.student_id,
          msg: `Your pending performance evaluation from ${evaluation.company} has been cancelled and removed by the Administrator.`,
        },
        {
          id: evaluation.employer_id,
          msg: `The pending performance evaluation you submitted for your intern has been removed by the Administrator.`,
        },
      );
    } else if (isOwner) {
      recipientsToNotify.push({
        id: evaluation.student_id,
        msg: `Your pending performance evaluation from ${evaluation.company} has been cancelled and removed by your Supervisor.`,
      });
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

        // Dispatch real-time socket emit safely
        if (io) {
          io.to(`user-${recipient.id}`).emit("new_notification", {
            title: notifTitle,
            message: recipient.msg,
            type: "evaluation_deleted",
            link: Number(evaluation.internship_id),
            link_uuid: evaluationId,
          });
        }
      } catch (insertionError) {
        // Immediately abort everything if any single notification fails to generate safely
        await connection.rollback();
        console.error(
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

    return res.status(200).json({
      success: true,
      message:
        "Evaluation record successfully removed, and notifications cleanly updated.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete student evaluation error:", error);
    return res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const respondToStudentEvaluation = async (req, res) => {
  const { id: studentId } = req.verifiedUser; // Security gate: ensure student is verifying their own record
  const { evaluationId } = req.params;
  const { decision } = req.body; // "completed" | "disputed"

  if (!evaluationId) {
    return res.status(400).json({ error: "Evaluation ID is required." });
  }

  if (!["completed", "disputed"].includes(decision)) {
    return res
      .status(400)
      .json({ error: "decision must be 'completed' or 'disputed'." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // 1. Verify the evaluation master belongs to this student and is pending
    const [evaluationCheck] = await connection.execute(
      `SELECT m.status, ir.user_id 
       FROM student_evaluation_masters m
       INNER JOIN internship_records ir ON m.internship_record_id = ir.id
       WHERE m.id = ?`,
      [evaluationId],
    );

    if (evaluationCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Evaluation record not found." });
    }

    if (evaluationCheck[0].user_id !== studentId) {
      await connection.rollback();
      return res.status(403).json({
        error: "Unauthorized. You can only respond to your own evaluation.",
      });
    }

    if (evaluationCheck[0].status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        error: "This evaluation has already been responded to.",
      });
    }

    const newStatus = decision; // decision now maps 1:1 to the enum value

    // 2. Flip evaluation status
    await connection.execute(
      `UPDATE student_evaluation_masters SET status = ? WHERE id = ?`,
      [newStatus, evaluationId],
    );

    // 3. Mark the verification notification as read either way —
    // the student has acted on it, whether by confirming or disputing.
    // evaluationId is the master's UUID, which was inserted into link_uuid
    // (see createStudentEvaluation), and the type there is 'evaluation_submitted'.
    await connection.execute(
      `UPDATE notifications SET is_read = 1 WHERE link_uuid = ? AND type = 'evaluation_submitted'`,
      [evaluationId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual response.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          "student",
          decision === "completed"
            ? "student_evaluation_completed"
            : "student_evaluation_disputed",
          "student_evaluation_masters",
          evaluationId,
          `Student ${decision === "completed" ? "confirmed" : "disputed"} their performance evaluation.`,
          null,
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (student evaluation response):",
        logError,
      );
    }

    await connection.commit();

    const message =
      decision === "completed"
        ? "Evaluation verified successfully! Your internship grades are now officially posted."
        : "Evaluation disputed. This has been flagged for review.";

    res.status(200).json({ success: true, message, status: newStatus });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Respond to student evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const restoreDisputedEvaluation = async (req, res) => {
  const { id: studentId } = req.verifiedUser; // Security gate: student can only restore their own record
  const { evaluationId } = req.params;

  if (!evaluationId) {
    return res.status(400).json({ error: "Evaluation ID is required." });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Verify the evaluation master belongs to this student and is currently disputed
    const [evaluationCheck] = await connection.execute(
      `SELECT m.status, ir.user_id 
       FROM student_evaluation_masters m
       INNER JOIN internship_records ir ON m.internship_record_id = ir.id
       WHERE m.id = ?`,
      [evaluationId],
    );

    if (evaluationCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Evaluation record not found." });
    }

    if (evaluationCheck[0].user_id !== studentId) {
      await connection.rollback();
      return res.status(403).json({
        error: "Unauthorized. You can only restore your own evaluation.",
      });
    }

    if (evaluationCheck[0].status !== "disputed") {
      await connection.rollback();
      return res.status(400).json({
        error: "Only a disputed evaluation can be restored.",
      });
    }

    // 2. Flip status back to pending — the student can review and
    // confirm/dispute it again from a clean slate
    await connection.execute(
      `UPDATE student_evaluation_masters SET status = 'pending' WHERE id = ?`,
      [evaluationId],
    );

    // 3. Re-open the original notification so it shows as unread/pending
    // again in whatever inbox surfaces it. Same fix as respondToStudentEvaluation:
    // evaluationId belongs in link_uuid, and the type is 'evaluation_submitted'.
    await connection.execute(
      `UPDATE notifications SET is_read = 0 WHERE link_uuid = ? AND type = 'evaluation_submitted'`,
      [evaluationId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual restore.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          "student",
          "student_evaluation_restored",
          "student_evaluation_masters",
          evaluationId,
          `Student restored their disputed evaluation back to pending.`,
          null,
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (student evaluation restored):",
        logError,
      );
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Evaluation restored to pending. You can review it again.",
      status: "pending",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Restore disputed evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
    });
  } finally {
    if (connection) connection.release();
  }
};

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
      `SELECT status FROM student_evaluation_masters WHERE id = ? FOR UPDATE`,
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
          `${role === "admin" ? "Admin" : "Department head"} marked disputed evaluation ${evaluationId} as reviewed.`,
          JSON.stringify({ has_review_notes: Boolean(review_notes) }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (student evaluation reviewed):",
        logError,
      );
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Disputed evaluation marked as reviewed.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Review disputed evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getDisputedStudentEvaluations = async (req, res) => {
  const { id: studentId } = req.verifiedUser; // Security gate: only the student's own disputed records

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
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS evaluator,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM student_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN student_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      JOIN user_profiles AS up ON m.evaluated_by = up.user_id
      WHERE ir.user_id = ? AND m.status = 'disputed'
      ORDER BY m.created_at DESC, c.category ASC
    `;

    const [rows] = await connection.execute(query, [studentId]);

    // 🛡️ Guard Clause: If nothing is disputed, return an empty list gracefully
    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const evaluationsGroup = {};

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
          status:
            row.evaluation_status.charAt(0).toUpperCase() +
            row.evaluation_status.slice(1),
          period: formattedPeriod,
          evaluator: row.evaluator,
          evaluator_id: row.evaluator_id,
          company: row.company,
          submittedDate: formattedDate,
          comments: row.comments || "",
          breakdown: [],
        };
      }

      let existingCategory = evaluationsGroup[evalId].breakdown.find(
        (b) => b.label === row.breakdown_label,
      );

      const currentScore = Number(row.breakdown_score);

      if (existingCategory) {
        existingCategory.score += currentScore;
        existingCategory.max += POINTS_PER_CRITERION;
      } else {
        evaluationsGroup[evalId].breakdown.push({
          label: row.breakdown_label,
          score: currentScore,
          max: POINTS_PER_CRITERION,
        });
      }
    });

    const evaluationsList = Object.values(evaluationsGroup);

    return res.status(200).json({
      success: true,
      data: evaluationsList,
    });
  } catch (error) {
    console.error("Get disputed student evaluations error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to compile disputed evaluation records.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getAllStudentEvaluations = async (req, res) => {
  const { id: studentId } = req.verifiedUser;

  const POINTS_PER_CRITERION = 5;

  let connection;
  try {
    connection = await db.getConnection();

    // 1. Evaluations ABOUT the student, from their employer — only once confirmed
    const receivedQuery = `
      SELECT 
        m.id AS evaluation_id,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.evaluated_by AS actor_id,
        m.reviewed_by,
        m.reviewed_at,
        m.review_notes,
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS actor_name,
        CONCAT(reviewer_up.first_name, ' ', reviewer_up.last_name) AS reviewer_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM student_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN student_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      JOIN user_profiles AS up ON m.evaluated_by = up.user_id
      LEFT JOIN user_profiles AS reviewer_up ON m.reviewed_by = reviewer_up.user_id
      WHERE ir.user_id = ? AND m.status = 'completed'
      ORDER BY m.created_at DESC, c.category ASC
    `;

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

    const [receivedRows] = await connection.execute(receivedQuery, [studentId]);
    const [givenRows] = await connection.execute(givenQuery, [studentId]);

    function groupRows(rows, type, actorLabel) {
      const group = {};

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
        }

        let existingCategory = group[evalId].breakdown.find(
          (b) => b.label === row.breakdown_label,
        );

        const currentScore = Number(row.breakdown_score);

        if (existingCategory) {
          existingCategory.score += currentScore;
          existingCategory.max += POINTS_PER_CRITERION;
        } else {
          group[evalId].breakdown.push({
            label: row.breakdown_label,
            score: currentScore,
            max: POINTS_PER_CRITERION,
          });
        }
      });

      return Object.values(group);
    }

    const received = groupRows(
      receivedRows,
      "Performance Evaluation",
      "employer",
    );
    const given = groupRows(givenRows, "Supervisor Evaluation", "self");

    const combined = [...received, ...given].sort(
      (a, b) => new Date(b.submittedDate) - new Date(a.submittedDate),
    );

    return res.status(200).json({
      success: true,
      data: combined,
    });
  } catch (error) {
    console.error("Get all student evaluations error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to compile evaluation history.",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
