import { reportError } from "../../../config/errorTracking.js";
import { invalidateProfileOverviewCache } from "../../../config/cache/profileOverviewCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { invalidateDashboardCache } from "../../../config/cache/dashboardCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";

export const getSupervisorStatus = async (req, res) => {
  let connection;
  try {
    const { id: studentId } = req.verifiedUser;
    const { employerId } = req.params;

    if (!employerId) {
      return res.status(400).json({ error: "employerId is required." });
    }

    connection = await db.getConnection();

    // Derive accepted status from the student's current ongoing assignment,
    // rather than an older accepted request row.
    const [internships] = await connection.execute(
      `SELECT id, employer_id FROM internship_records
       WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1`,
      [studentId],
    );

    if (internships.length === 0) {
      return res.status(200).json({
        status: null,
        hasOngoingInternship: false,
        hasSupervisor: false,
      });
    }

    const internship = internships[0];

    if (internship.employer_id === employerId) {
      return res.status(200).json({
        status: "accepted",
        hasOngoingInternship: true,
        hasSupervisor: true,
      });
    }

    if (internship.employer_id) {
      return res.status(200).json({
        status: null,
        hasOngoingInternship: true,
        hasSupervisor: true,
      });
    }

    // With no assigned supervisor, check for a pending request to this employer.
    const [requests] = await connection.execute(
      `SELECT id FROM supervisor_requests 
       WHERE internship_id = ? AND employer_id = ? AND status = 'pending'
       LIMIT 1`,
      [internship.id, employerId],
    );

    if (requests.length > 0) {
      return res.status(200).json({
        status: "pending",
        hasOngoingInternship: true,
        hasSupervisor: false,
        requestId: requests[0].id,
      });
    }

    // No relationship yet — button should say "Set as Supervisor"
    return res.status(200).json({
      status: null,
      hasOngoingInternship: true,
      hasSupervisor: false,
    });
  } catch (error) {
    reportError("Get supervisor status error:", error);
    return res
      .status(500)
      .json({ error: "Failed to check supervisor status." });
  } finally {
    if (connection) connection.release();
  }
};

export const requestSupervisor = async (req, res) => {
  let connection;
  try {
    const { id: studentId } = req.verifiedUser;
    const { employerId } = req.body;

    if (!employerId) {
      return res.status(400).json({ error: "employerId is required." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Serialize request creation on the student's ongoing internship before
    // superseding older requests or checking whether a supervisor is assigned.
    const [internships] = await connection.execute(
      `SELECT id, employer_id, company_name FROM internship_records
       WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [studentId],
    );

    if (internships.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "You don't have an ongoing internship to request a supervisor for.",
      });
    }

    const internship = internships[0];

    if (internship.employer_id) {
      await connection.rollback();
      return res.status(409).json({
        error: internship.employer_id === employerId
          ? "This employer is already your supervisor. Remove them first if you want to choose someone else."
          : "You already have a supervisor. Remove your current supervisor before requesting another.",
      });
    }

    // Sender name for the notification sent to the employer
    const [senderRows] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [studentId],
    );

    if (senderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Student profile not found." });
    }

    const senderName = `${senderRows[0].first_name} ${senderRows[0].last_name}`;

    // Supersede earlier pending requests under the internship lock before inserting
    // the new request. Old rows remain for history and their alerts become dismissible.
    // Superseding creates no separate notification; the new request notifies its recipient.
    await connection.execute(
      `UPDATE supervisor_requests SET status = 'superseded' 
       WHERE internship_id = ? AND status = 'pending'`,
      [internship.id],
    );

    // The notification stores this request UUID, not the internship UUID,
    // so responses and deletion protection resolve the same request.
    const requestId = newUUID();
    await connection.execute(
      `INSERT INTO supervisor_requests (id, internship_id, student_id, employer_id)
       VALUES (?, ?, ?, ?)`,
      [requestId, internship.id, studentId, employerId],
    );

    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        employerId,
        studentId,
        "supervisor_request_submitted",
        "New Supervisor Request",
        `${senderName} requested you as their supervisor`,
        requestId,
      ],
    );

    // A caught activity-log insert error does not by itself abort this request.
    // The request and its inbox notification remain in the surrounding transaction.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          "student",
          "supervisor_request_sent",
          "supervisor_requests",
          requestId,
          `${senderName} requested a new supervisor for their internship at ${internship.company_name}.`,
          JSON.stringify({
            internship_id: internship.id,
            employer_id: employerId,
            previous_employer_id: internship.employer_id,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (supervisor request sent):",
        logError,
      );
    }

    await connection.commit();
    invalidateProfileOverviewCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    const io = req.app.get("socketio");
    io.to(`user-${employerId}`).emit("new_notification", {
      title: "New Supervisor Request",
      message: `${senderName} requested you as their supervisor`,
      type: "supervisor_request_submitted",
      link_uuid: requestId,
    });

    return res.status(201).json({
      message: "Supervisor request sent.",
      success: true,
      id: requestId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Request supervisor error:", error);
    return res
      .status(500)
      .json({ error: "Failed to send supervisor request." });
  } finally {
    if (connection) connection.release();
  }
};

export const removeSupervisor = async (req, res) => {
  const { id: studentId } = req.verifiedUser;
  const { employerId } = req.params;
  if (!employerId) return res.status(400).json({ error: "employerId is required." });

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [internships] = await connection.execute(
      `SELECT id, employer_id, company_name FROM internship_records
       WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [studentId],
    );
    const internship = internships[0];
    if (!internship || internship.employer_id !== employerId) {
      await connection.rollback();
      return res.status(404).json({ error: "This employer is not your current supervisor." });
    }

    const [update] = await connection.execute(
      `UPDATE internship_records SET employer_id = NULL
       WHERE id = ? AND user_id = ? AND employer_id = ?`,
      [internship.id, studentId, employerId],
    );
    if (update.affectedRows !== 1) {
      await connection.rollback();
      return res.status(409).json({ error: "Your supervisor changed. Refresh and try again." });
    }

    // A request left pending by an older client must not become active later.
    await connection.execute(
      `UPDATE supervisor_requests SET status = 'superseded'
       WHERE internship_id = ? AND status = 'pending'`,
      [internship.id],
    );

    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          "student",
          "supervisor_removed",
          "internship_records",
          internship.id,
          `Student removed their supervisor for the internship at ${internship.company_name}.`,
          JSON.stringify({ employer_id: employerId }),
        ],
      );
    } catch (logError) {
      reportError("Activity log insert failed (supervisor removed):", logError);
    }

    await connection.commit();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();
    invalidateActivityLogsCache();

    try {
      const io = req.app.get("socketio");
      // After commit, remove the former employer from the student's live-location room
      // and notify both users to refresh their supervision state.
      io?.in?.(`user-${employerId}`)?.socketsLeave?.(`dtr-location:${studentId}:${internship.id}`);
      io?.to(`user-${studentId}`).emit("supervisor_status_changed", { internshipId: internship.id });
      io?.to(`user-${employerId}`).emit("supervisor_status_changed", { internshipId: internship.id });
    } catch (socketError) {
      reportError("Supervisor removal socket update failed:", socketError);
    }

    return res.status(200).json({ message: "Supervisor removed.", success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Remove supervisor error:", error);
    return res.status(500).json({ error: "Failed to remove supervisor." });
  } finally {
    if (connection) connection.release();
  }
};

export const cancelSupervisorRequest = async (req, res) => {
  let connection;
  try {
    const { id: studentId } = req.verifiedUser;
    const { requestId } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, student_id, employer_id, internship_id, status FROM supervisor_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Request not found." });
    }

    const request = rows[0];

    if (request.student_id !== studentId) {
      await connection.rollback();
      return res.status(403).json({ error: "You cannot cancel this request." });
    }

    if (request.status !== "pending") {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "Only a pending request can be cancelled." });
    }

    // Cancellation retains the request as superseded instead of deleting its history.
    // The employer's existing alert becomes dismissible without a new inbox notification.
    await connection.execute(
      `UPDATE supervisor_requests SET status = 'superseded' WHERE id = ?`,
      [requestId],
    );

    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          "student",
          "supervisor_request_cancelled",
          "supervisor_requests",
          requestId,
          `Student cancelled their pending supervisor request.`,
          null,
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (supervisor request cancelled):",
        logError,
      );
    }

    await connection.commit();
    invalidateProfileOverviewCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();
    const io = req.app?.get?.("socketio");
    // Refresh the employer's existing alert after the cancellation commits.
    io?.to(`user-${request.employer_id}`).emit("supervisor_status_changed", { internshipId: request.internship_id });

    return res
      .status(200)
      .json({ message: "Request cancelled.", success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Cancel supervisor request error:", error);
    return res.status(500).json({ error: "Failed to cancel request." });
  } finally {
    if (connection) connection.release();
  }
};

export const respondToSupervisorRequest = async (req, res) => {
  let connection;
  try {
    const { id: employerId } = req.verifiedUser;
    const { requestId } = req.params;
    const { decision } = req.body; // "accept" | "reject"

    if (!["accept", "reject"].includes(decision)) {
      return res
        .status(400)
        .json({ error: "decision must be 'accept' or 'reject'." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the internship before its request, matching request creation and
    // supervisor removal so concurrent changes cannot replace an assignment.
    const [requestRefs] = await connection.execute(
      `SELECT internship_id FROM supervisor_requests WHERE id = ? LIMIT 1`,
      [requestId],
    );
    if (requestRefs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Request not found." });
    }
    const [internships] = await connection.execute(
      `SELECT id, status, company_name, employer_id, deleted_at
       FROM internship_records WHERE id = ? FOR UPDATE`,
      [requestRefs[0].internship_id],
    );

    // Lock and reread the request before checking recipient and pending state.
    // student_id identifies the recipient of the eventual decision notification.
    const [rows] = await connection.execute(
      `SELECT id, internship_id, student_id, employer_id, status 
       FROM supervisor_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Request not found." });
    }

    const request = rows[0];

    if (request.employer_id !== employerId) {
      await connection.rollback();
      return res
        .status(403)
        .json({ error: "This request is not addressed to you." });
    }

    if (request.status !== "pending") {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "This request has already been responded to." });
    }

    // Validate the locked internship's current state; the original request may predate
    // completion or deletion. Acceptance must also preserve an existing assignment.
    if (internships.length === 0 || internships[0].status !== "ongoing" || internships[0].deleted_at) {
      await connection.rollback();
      return res.status(400).json({
        error:
          "This internship is no longer ongoing; the request can't be actioned.",
      });
    }

    if (decision === "accept" && internships[0].employer_id) {
      await connection.rollback();
      return res.status(409).json({
        error: "This student already has a supervisor. They must remove that supervisor before this request can be accepted.",
      });
    }

    // Sender name for the notification sent to the student
    const [senderRows] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [employerId],
    );

    if (senderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Employer profile not found." });
    }

    const senderName = `${senderRows[0].first_name} ${senderRows[0].last_name}`;

    if (decision === "reject") {
      await connection.execute(
        `UPDATE supervisor_requests SET status = 'rejected', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [requestId],
      );

      await connection.execute(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          request.student_id,
          employerId,
          "supervisor_request_rejected",
          "Supervisor Request Declined",
          `${senderName} declined your supervisor request`,
          requestId,
        ],
      );

      try {
        await connection.execute(
          `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            employerId,
            "employer",
            "supervisor_request_rejected",
            "supervisor_requests",
            requestId,
            `${senderName} declined a supervisor request for the internship at ${internships[0].company_name}.`,
            JSON.stringify({
              internship_id: request.internship_id,
              student_id: request.student_id,
            }),
          ],
        );
      } catch (logError) {
        reportError(
          "Activity log insert failed (supervisor request rejected):",
          logError,
        );
      }

      await connection.commit();
    invalidateProfileOverviewCache();
      invalidateNotificationsCache();

      invalidateActivityLogsCache();

      const io = req.app.get("socketio");
      io?.to(`user-${employerId}`).emit("supervisor_status_changed", { internshipId: request.internship_id });
      io.to(`user-${request.student_id}`).emit("new_notification", {
        title: "Supervisor Request Declined",
        message: `${senderName} declined your supervisor request`,
        type: "supervisor_request_rejected",
        link_uuid: requestId,
      });

      return res
        .status(200)
        .json({ message: "Request rejected.", success: true });
    }

    // Accept the request, assign the supervisor and create the student's notification
    // in the same transaction. Cache invalidation and socket events follow commit.
    await connection.execute(
      `UPDATE supervisor_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [requestId],
    );

    await connection.execute(
      `UPDATE internship_records SET employer_id = ? WHERE id = ?`,
      [employerId, request.internship_id],
    );

    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        request.student_id,
        employerId,
        "supervisor_request_accepted",
        "Supervisor Request Accepted",
        `${senderName} accepted your supervisor request`,
        requestId,
      ],
    );

    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          employerId,
          "employer",
          "supervisor_request_accepted",
          "supervisor_requests",
          requestId,
          `${senderName} accepted a supervisor request for the internship at ${internships[0].company_name}.`,
          JSON.stringify({
            internship_id: request.internship_id,
            student_id: request.student_id,
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (supervisor request accepted):",
        logError,
      );
    }

    await connection.commit();
    invalidateProfileOverviewCache();
    invalidateNotificationsCache();

    invalidateActivityLogsCache();

    const io = req.app.get("socketio");
    io?.to(`user-${employerId}`).emit("supervisor_status_changed", { internshipId: request.internship_id });
    io.to(`user-${request.student_id}`).emit("new_notification", {
      title: "Supervisor Request Accepted",
      message: `${senderName} accepted your supervisor request`,
      type: "supervisor_request_accepted",
      link_uuid: requestId,
    });

    return res
      .status(200)
      .json({ message: "Supervisor request accepted.", success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Respond to supervisor request error:", error);
    return res.status(500).json({ error: "Failed to respond to request." });
  } finally {
    if (connection) connection.release();
  }
};
