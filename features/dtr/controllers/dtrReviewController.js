import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";
import { getMaxShiftHours } from "../../../config/shiftLimits.js";
import { invalidateAttendanceHistoryCache } from "../../../config/cache/attendanceHistoryCache.js";
import { invalidateDashboardCache } from "../../../config/cache/dashboardCache.js";
import { invalidateDepartmentInternshipsCache } from "../../../config/cache/staffInternshipsCache.js";
import { invalidateProfileOverviewCache } from "../../../config/cache/profileOverviewCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validDateTime = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}:00+08:00`));

function refresh(userIds = []) {
  try {
    invalidateAttendanceHistoryCache();
    invalidateDashboardCache();
    invalidateDepartmentInternshipsCache();
    invalidateProfileOverviewCache();
    for (const id of userIds.filter(Boolean)) invalidateNotificationsCache(id);
  } catch (error) {
    // The attendance transaction has committed; a cache failure cannot turn a
    // successful save into a 500 that invites a duplicate submission.
    reportError("Committed DTR cache invalidation failed:", error);
  }
}

async function staffRecord(connection, id, actor, lock = false) {
  const [rows] = await connection.execute(
    `SELECT dtr.*, ir.user_id AS student_id, ir.employer_id, ir.company_name,
            sai.department_id, hd.department_id AS head_department_id, dep.code AS head_department_code
     FROM daily_time_records dtr
     JOIN internship_records ir ON ir.id = dtr.internship_id AND ir.deleted_at IS NULL
     LEFT JOIN student_academic_info sai ON sai.id =
       (SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id)
     LEFT JOIN dept_heads_background_info hd ON hd.user_id = ?
     LEFT JOIN departments dep ON dep.id = hd.department_id
     WHERE dtr.id = ? ${lock ? "FOR UPDATE" : ""}`,
    [actor.id, id],
  );
  const row = rows[0];
  if (!row) return null;
  const employerAllowed = actor.role === "employer" && row.employer_id === actor.id;
  const headAllowed = actor.role === "department_head" && row.head_department_code !== "REG" &&
    row.head_department_id != null && Number(row.head_department_id) === Number(row.department_id);
  return employerAllowed || headAllowed ? row : null;
}

async function notify(connection, userId, senderId, type, title, message, link, linkId) {
  if (!userId) return;
  await connection.execute(
    "INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, senderId, type, title, message, link, linkId],
  );
}

function deliver(req, userId, senderId, type, title, message, link, linkId) {
  if (!userId) return;
  try {
    req.app?.get("socketio")?.to(`user-${userId}`).emit("new_notification", {
      user_id: userId, sender_id: senderId, type, title, message, link, link_uuid: linkId,
    });
  } catch (error) {
    reportError("Committed DTR notification delivery failed:", error);
  }
}

// A student can declare overtime from 30 minutes before the expected end.
// Without employer shift hours, offer it after eight net duty hours.
export async function requestOvertime(req, res) {
  const reason = String(req.body?.reason ?? "").trim();
  const intendedEnd = req.body?.intendedEnd;
  if (reason.length < 10 || reason.length > 500 || !validDateTime(intendedEnd))
    return res.status(400).json({ error: "Enter a reason (10–500 characters) and a valid intended end time." });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT dtr.id, dtr.internship_id, dtr.expected_clock_out,
              ir.employer_id, ir.user_id AS student_id, ir.company_name,
              TIMESTAMPDIFF(SECOND, dtr.clock_in, NOW()) - dtr.break_total_seconds AS duty_seconds,
              TIMESTAMPDIFF(MINUTE, NOW(), dtr.expected_clock_out) AS minutes_to_end,
              TIMESTAMPDIFF(MINUTE, NOW(), ?) AS minutes_to_intended_end,
              TIMESTAMPDIFF(MINUTE, NOW(), DATE_ADD(dtr.clock_in, INTERVAL 16 HOUR)) AS minutes_to_safety_close
       FROM daily_time_records dtr
       JOIN internship_records ir ON ir.id = dtr.internship_id AND ir.deleted_at IS NULL
       WHERE dtr.user_id = ? AND dtr.clock_out IS NULL AND ir.status = 'ongoing'
       LIMIT 1 FOR UPDATE`,
      [intendedEnd.replace("T", " ") + ":00", req.verifiedUser.id],
    );
    const row = rows[0];
    if (!row) { await connection.rollback(); return res.status(409).json({ error: "No active shift is available." }); }
    if (!row.employer_id) {
      await connection.rollback();
      return res.status(409).json({ error: "Assign a supervising employer before requesting overtime. You may still clock out normally." });
    }
    if (row.expected_clock_out ? Number(row.minutes_to_end) > 30 : Number(row.duty_seconds) < 8 * 3600) {
      await connection.rollback();
      return res.status(409).json({ error: "Overtime can be requested near the scheduled end, or after eight duty hours without a schedule." });
    }
    if (Number(row.minutes_to_intended_end) <= 0 || Number(row.minutes_to_intended_end) > Number(row.minutes_to_safety_close)) {
      await connection.rollback();
      return res.status(400).json({ error: "Choose an end time after now and before the 16-hour safety close." });
    }
    const [changed] = await connection.execute(
      `UPDATE daily_time_records SET overtime_reason = ?, overtime_intended_end = ?,
         overtime_requested_at = NOW(), overtime_status = 'requested',
         overtime_reviewed_by = NULL, overtime_reviewed_at = NULL
       WHERE id = ? AND overtime_status IS NULL`,
      [reason, intendedEnd.replace("T", " ") + ":00", row.id],
    );
    if (!changed.affectedRows) { await connection.rollback(); return res.status(409).json({ error: "An overtime request already exists for this shift." }); }
    const noticeMessage = `A supervised student requested extra time at ${row.company_name}. Review the DTR entry.`;
    await notify(connection, row.employer_id, req.verifiedUser.id, "dtr_overtime_request",
      "Overtime requested", noticeMessage,
      "/users", row.student_id);
    await connection.commit();
    refresh([row.employer_id]);
    deliver(req, row.employer_id, req.verifiedUser.id, "dtr_overtime_request", "Overtime requested", noticeMessage, "/users", row.student_id);
    return res.json({ success: true, message: "Overtime request sent. You can still clock out normally." });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("DTR overtime request failed:", error);
    return res.status(500).json({ error: "Could not save the overtime request." });
  } finally { connection?.release(); }
}

export async function reviewOvertime(req, res) {
  if (!validId(req.params.dtrId) || !["approved", "not_approved"].includes(req.body?.decision))
    return res.status(400).json({ error: "Choose Approve or Not approved." });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const row = await staffRecord(connection, req.params.dtrId, req.verifiedUser, true);
    if (!row || req.verifiedUser.role !== "employer") {
      await connection.rollback(); return res.status(403).json({ error: "Only the assigned supervisor can decide this request." });
    }
    if (row.overtime_status !== "requested") {
      await connection.rollback(); return res.status(409).json({ error: "This request is no longer pending." });
    }
    await connection.execute(
      "UPDATE daily_time_records SET overtime_status = ?, overtime_reviewed_by = ?, overtime_reviewed_at = NOW() WHERE id = ?",
      [req.body.decision, req.verifiedUser.id, row.id],
    );
    const decisionText = req.body.decision === "approved" ? "approved" : "not approved";
    const noticeTitle = `Overtime ${decisionText}`;
    const noticeMessage = `Your overtime request at ${row.company_name} was ${decisionText}. You must still clock out with a photo and location.`;
    await notify(connection, row.student_id, req.verifiedUser.id, "dtr_overtime_decision",
      noticeTitle, noticeMessage,
      "/student", row.internship_id);
    await connection.commit(); refresh([row.student_id]);
    deliver(req, row.student_id, req.verifiedUser.id, "dtr_overtime_decision", noticeTitle, noticeMessage, "/student", row.internship_id);
    return res.json({ success: true, message: "Overtime decision saved." });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("DTR overtime review failed:", error);
    return res.status(500).json({ error: "Could not review overtime." });
  } finally { connection?.release(); }
}

export async function submitAutoCloseExplanation(req, res) {
  const explanation = String(req.body?.explanation ?? "").trim();
  if (!validId(req.params.dtrId) || explanation.length < 15 || explanation.length > 1000)
    return res.status(400).json({ error: "Explain the missed clock-out in 15–1000 characters." });
  let connection;
  try {
    connection = await db.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT dtr.id, dtr.internship_id, dtr.auto_close_review_status,
              ir.employer_id, ir.user_id AS student_id, ir.company_name
       FROM daily_time_records dtr JOIN internship_records ir ON ir.id = dtr.internship_id
       WHERE dtr.id = ? AND dtr.user_id = ? AND dtr.auto_closed = 1
         AND dtr.student_explanation IS NULL
         AND dtr.auto_close_review_status IN ('pending_explanation', 'legacy_credited') FOR UPDATE`,
      [req.params.dtrId, req.verifiedUser.id],
    );
    const row = rows[0];
    if (!row) { await connection.rollback(); return res.status(409).json({ error: "This entry no longer needs an explanation." }); }
    const legacy = row.auto_close_review_status === "legacy_credited";
    await connection.execute(
      `UPDATE daily_time_records SET student_explanation = ?, explanation_submitted_at = NOW(),
         auto_close_review_status = ? WHERE id = ? AND student_explanation IS NULL`,
      [explanation, legacy ? "legacy_credited" : "pending_review", row.id],
    );
    if (!legacy) {
      const noticeMessage = `A student explained a missed clock-out at ${row.company_name}. Review the proposed hours.`;
      await notify(connection, row.employer_id, req.verifiedUser.id, "dtr_auto_close",
        "Auto-closed DTR needs review", noticeMessage,
        "/users", row.student_id);
      await connection.commit(); refresh([row.employer_id, row.student_id]);
      deliver(req, row.employer_id, req.verifiedUser.id, "dtr_auto_close", "Auto-closed DTR needs review", noticeMessage, "/users", row.student_id);
      return res.json({ success: true, message: "Explanation saved for supervisor or department-head review." });
    }
    await connection.commit(); refresh([row.student_id]);
    return res.json({ success: true, message: "Explanation saved. Previously credited hours are unchanged." });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("DTR explanation failed:", error);
    return res.status(500).json({ error: "Could not save the explanation." });
  } finally { connection?.release(); }
}

export async function reviewAutoClosedDtr(req, res) {
  const hours = Number(req.body?.hours);
  if (!validId(req.params.dtrId) || req.body?.hours == null || req.body.hours === "" ||
      !Number.isFinite(hours) || hours < 0 || hours > getMaxShiftHours())
    return res.status(400).json({ error: `Enter credited hours from 0 to ${getMaxShiftHours()}.` });
  let connection;
  try {
    connection = await db.getConnection(); await connection.beginTransaction();
    const row = await staffRecord(connection, req.params.dtrId, req.verifiedUser, true);
    if (!row) { await connection.rollback(); return res.status(403).json({ error: "You cannot review this student's DTR." }); }
    if (!row.auto_closed || row.auto_close_review_status !== "pending_review") {
      await connection.rollback(); return res.status(409).json({ error: "This auto-closed entry is not ready for review." });
    }
    // The proposed amount is only a ceiling; an explanation is not proof of work.
    if (hours > Number(row.proposed_hours ?? 0)) {
      await connection.rollback(); return res.status(400).json({ error: "Credited hours cannot exceed the proposed duty hours." });
    }
    const credited = Math.round(hours * 100) / 100;
    await connection.execute(
      `UPDATE daily_time_records SET total_hours = ?, auto_close_review_status = ?,
         reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [credited, credited === Number(row.proposed_hours) ? "approved" : "adjusted", req.verifiedUser.id, row.id],
    );
    await connection.execute(
      "UPDATE internship_records SET accumulated_hours = accumulated_hours + ? WHERE id = ?",
      [credited, row.internship_id],
    );
    const noticeMessage = `Your auto-closed shift at ${row.company_name} was reviewed. ${credited.toFixed(2)} hours were credited.`;
    await notify(connection, row.student_id, req.verifiedUser.id, "dtr_auto_close",
      "Auto-closed DTR reviewed", noticeMessage,
      "/student", row.internship_id);
    await connection.commit(); refresh([row.student_id]);
    deliver(req, row.student_id, req.verifiedUser.id, "dtr_auto_close", "Auto-closed DTR reviewed", noticeMessage, "/student", row.internship_id);
    return res.json({ success: true, message: `${credited.toFixed(2)} hours credited after review.` });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("DTR auto-close review failed:", error);
    return res.status(500).json({ error: "Could not review the auto-closed entry." });
  } finally { connection?.release(); }
}
