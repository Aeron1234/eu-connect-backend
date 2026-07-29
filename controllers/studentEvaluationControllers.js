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

  // 🛡️ Guard Clause: Validate request parameters immediately
  if (!studentId) {
    return res.status(400).json({
      success: false,
      error: "Missing required student ID parameter.",
    });
  }

  // 🎯 Clean Constant: Every individual criterion item has a max value of 5 points
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
      WHERE ir.user_id = ?
      ORDER BY m.created_at DESC, c.category ASC
    `;

    const [rows] = await connection.execute(query, [studentId]);

    // 🛡️ Guard Clause: If no history exists, return an empty list gracefully
    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const evaluationsGroup = {};

    rows.forEach((row) => {
      const evalId = row.evaluation_id;

      // 1. If this evaluation instance hasn't been grouped yet, map its metadata
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

      // 2. Accumulate criteria points dynamically into our summary categories
      let existingCategory = evaluationsGroup[evalId].breakdown.find(
        (b) => b.label === row.breakdown_label,
      );

      const currentScore = Number(row.breakdown_score);

      if (existingCategory) {
        // 🌟 FIXED: Add the score and increment the max by 5 for every sub-criterion row found
        existingCategory.score += currentScore;
        existingCategory.max += POINTS_PER_CRITERION;
      } else {
        // Fresh category entry starts at 5 max points for its first item
        evaluationsGroup[evalId].breakdown.push({
          label: row.breakdown_label,
          score: currentScore,
          max: POINTS_PER_CRITERION,
        });
      }
    });

    // Flatten our indexed tracking container directly into a sequential array list
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

    // Fetch active ongoing internship record and employer's profile details
    const [records] = await connection.execute(
      `SELECT id, company_name FROM internship_records WHERE user_id = ? AND status = 'ongoing' LIMIT 1`,
      [student_id],
    );

    if (records.length === 0) {
      return res.status(404).json({
        error:
          "Submission rejected. This student does not have an active, 'ongoing' internship record.",
      });
    }

    const internship_record_id = records[0].id;
    const companyName = records[0].company_name;

    const [employerProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [evaluated_by],
    );

    const employerName =
      employerProfile.length > 0
        ? `${employerProfile[0].first_name} ${employerProfile[0].last_name}`
        : "Your Supervisor";

    const masterId = newUUID();
    await connection.beginTransaction();

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

    // 🌟 UPDATED: Save both the integer mapping layout and our exact string deep-link UUID column
    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES (?, ?, 'submission', ?, ?, ?, ?)`,
      [
        student_id,
        evaluated_by,
        notifTitle,
        notifMessage,
        internship_record_id, // link (int)
        masterId, // link_uuid (char/string)
      ],
    );

    await connection.commit();

    // 4. Real-time Socket Event
    const io = req.app.get("socketio");
    if (io) {
      io.to(`user-${student_id}`).emit("new_notification", {
        title: notifTitle,
        message: notifMessage,
        type: "submission",
        link: internship_record_id,
        link_uuid: masterId, // 🌟 Added payload field for frontend precise routing navigation
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

export const confirmStudentEvaluation = async (req, res) => {
  const { id: studentId } = req.verifiedUser; // Security gate: ensure student is verifying their own record
  const { evaluationId } = req.params; // Passed via link query variable

  if (!evaluationId) {
    return res.status(400).json({ error: "Evaluation ID is required." });
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
        error: "Unauthorized. You can only verify your own evaluation profile.",
      });
    }

    if (evaluationCheck[0].status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        error: "This evaluation has already been verified and posted.",
      });
    }

    // 2. Flip evaluation status to completed
    await connection.execute(
      `UPDATE student_evaluation_masters SET status = 'completed' WHERE id = ?`,
      [evaluationId],
    );

    // 3. Mark the verification notification as read
    await connection.execute(
      `UPDATE notifications SET is_read = 1 WHERE link = ? AND type = 'submission'`,
      [evaluationId],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message:
        "Evaluation verified successfully! Your internship grades are now officially posted.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Confirm student evaluation error:", error);
    res.status(500).json({
      success: false,
      error: "Database transaction validation failed.",
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
    const [deleteNotifResult] = await connection.execute(
      `DELETE FROM notifications WHERE link_uuid = ? AND type = 'submission'`,
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
