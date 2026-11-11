import { daysArray } from '../dtr/dutyScheduleModel.js';
import { versionEmployerSchedule } from '../dtr/dutyScheduleService.js';
import { db } from "../../config/db.js";
import { reportError } from "../../config/errorTracking.js";
import { invalidateNotificationsCache } from "../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../config/cache/activityLogsCache.js";
import { invalidateRouteCache } from "../../config/cache/cache.js";

const validTime = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function optionalDate(value) {
  if (value === undefined || value === null || value === "") return null;
  return validDate(value) ? value : undefined;
}

async function ownedInternship(connection, internshipId, employerId) {
  const [rows] = await connection.execute(
    `SELECT ir.id, ir.user_id, ir.company_name, p.first_name, p.last_name
     FROM internship_records ir JOIN users u ON u.id = ir.user_id
     LEFT JOIN user_profiles p ON p.user_id = ir.user_id
     WHERE ir.id = ? AND ir.employer_id = ? AND ir.status = 'ongoing'
       AND ir.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [internshipId, employerId],
  );
  return rows[0] || null;
}

async function currentSchedule(connection, internshipId) {
  const [rows] = await connection.execute(
    `SELECT TIME_FORMAT(clock_in_time, '%H:%i') AS clockInTime,
            TIME_FORMAT(clock_out_time, '%H:%i') AS clockOutTime,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
            (SELECT working_days FROM dtr_weekly_schedules v WHERE v.internship_id=dtr_shift_restrictions.internship_id AND v.source='employer' ORDER BY v.id DESC LIMIT 1) AS workingDays
     FROM dtr_shift_restrictions WHERE internship_id = ? LIMIT 1 FOR UPDATE`,
    [internshipId],
  );
  return rows[0] || null;
}

function periodText(startDate, endDate) {
  if (startDate && endDate) return `from ${startDate} through ${endDate}`;
  if (startDate) return `from ${startDate} onward`;
  if (endDate) return `through ${endDate}`;
  return "with no date limit";
}

async function recordChange(connection, actor, internship, kind, schedule) {
  const studentName = [internship.first_name, internship.last_name].filter(Boolean).join(" ") || "the student";
  const [profiles] = await connection.execute(
    "SELECT first_name, last_name FROM user_profiles WHERE user_id = ? LIMIT 1",
    [actor.id],
  );
  const actorName = [profiles[0]?.first_name, profiles[0]?.last_name].filter(Boolean).join(" ") || "Your supervisor";
  const detail = schedule
    ? `${schedule.clockInTime} to ${schedule.clockOutTime} (Philippine time), ${periodText(schedule.startDate, schedule.endDate)}`
    : "removed the expected shift hours";
  const title = kind === "removed" ? "DTR Shift Hours Removed" :
    kind === "updated" ? "DTR Shift Hours Updated" : "DTR Shift Hours Set";
  const message = schedule
    ? `${actorName} ${kind === "updated" ? "updated" : "set"} your expected daily shift hours at ${internship.company_name}: ${detail}. Initial schedules may begin today; updates apply tomorrow or the selected later start date. During this schedule, Clock in opens 30 minutes before the scheduled start. Clock out remains available during your open shift.`
    : `${actorName} removed your expected daily shift hours at ${internship.company_name}. Removal applies tomorrow onward. Set your student fallback schedule if needed. Existing DTR entries keep their recorded labels.`;
  await connection.execute(
    "INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES (?, ?, 'dtr_shift_schedule', ?, ?, ?, ?)",
    [internship.user_id, actor.id, title, message, "/student", internship.id],
  );
  await connection.execute(
    "INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description) VALUES (?, ?, ?, ?, ?, ?)",
    [actor.id, actor.role, `dtr_shift_${kind}`, "dtr_shift_restrictions", internship.id,
      `${actorName} ${kind === "set" ? "set" : kind === "updated" ? "updated" : "removed"} DTR shift hours for ${studentName} at ${internship.company_name}${schedule ? `: ${detail}` : ""}.`],
  );
  return { user_id: internship.user_id, sender_id: actor.id, type: "dtr_shift_schedule", title, message, link: "/student", link_uuid: internship.id };
}

function deliver(req, notice) {
  if (!notice) return;
  try {
    invalidateNotificationsCache(notice.user_id);
    invalidateActivityLogsCache();
    invalidateRouteCache("/api/v1/student-dashboard-data", notice.user_id);
    req.app?.get("socketio")?.to(`user-${notice.user_id}`).emit("new_notification", notice);
  } catch (error) {
    reportError("Committed DTR shift schedule delivery:", error);
  }
}

export async function saveShiftRestriction(req, res) {
  const { clockInTime, clockOutTime } = req.body || {};
  const workingDays = req.body?.workingDays ?? [0,1,2,3,4,5,6];
  if (!Array.isArray(workingDays) || !workingDays.length || workingDays.length>7 || new Set(workingDays).size!==workingDays.length || workingDays.some(d=>!Number.isInteger(d)||d<0||d>6))
    return res.status(400).json({success:false,error:'Choose valid working days.'});
  const startDate = optionalDate(req.body?.startDate);
  const endDate = optionalDate(req.body?.endDate);
  if (!validTime(clockInTime) || !validTime(clockOutTime) || clockInTime === clockOutTime)
    return res.status(400).json({ success: false, error: "Choose different, valid start and end times." });
  if (startDate === undefined || endDate === undefined || (startDate && endDate && startDate > endDate))
    return res.status(400).json({ success: false, error: "Choose valid schedule dates, with the end on or after the start." });
  let connection, transaction = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction(); transaction = true;
    const internship = await ownedInternship(connection, req.params.internshipId, req.verifiedUser.id);
    if (!internship) {
      await connection.rollback(); transaction = false;
      return res.status(403).json({ success: false, error: "Only the student's current supervisor can set these hours." });
    }
    const previous = await currentSchedule(connection, internship.id);
    if (previous && previous.clockInTime===clockInTime && previous.clockOutTime===clockOutTime && previous.startDate===startDate && previous.endDate===endDate &&
      JSON.stringify([...daysArray(previous.workingDays||'[0,1,2,3,4,5,6]')].sort())===JSON.stringify([...workingDays].sort())) {
      await connection.rollback();transaction=false;return res.json({success:true,message:'Shift schedule is already set to these values.'});
    }
    await connection.execute(
      `INSERT INTO dtr_shift_restrictions (internship_id, employer_id, clock_in_time, clock_out_time, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE employer_id = VALUES(employer_id),
       clock_in_time = VALUES(clock_in_time), clock_out_time = VALUES(clock_out_time),
       start_date = VALUES(start_date), end_date = VALUES(end_date)`,
      [internship.id, req.verifiedUser.id, clockInTime, clockOutTime, startDate, endDate],
    );
    await versionEmployerSchedule(connection, internship.id, req.verifiedUser.id, {clockInTime,clockOutTime,startDate,endDate}, workingDays);
    const notice = await recordChange(connection, req.verifiedUser, internship, previous ? "updated" : "set", { clockInTime, clockOutTime, startDate, endDate });
    await connection.commit(); transaction = false;
    deliver(req, notice);
    return res.json({ success: true, message: "Shift hours saved. The student has been notified; future DTR entries use the schedule within its date range." });
  } catch (error) {
    if (transaction) await connection.rollback().catch(() => {});
    if(error.status)return res.status(error.status).json({success:false,error:error.message});
    reportError("Save DTR shift restriction failed:", error);
    return res.status(500).json({ success: false, error: "Could not confirm shift hours. Refresh before retrying; the save may have completed." });
  } finally { connection?.release(); }
}

export async function removeShiftRestriction(req, res) {
  let connection, transaction = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction(); transaction = true;
    const internship = await ownedInternship(connection, req.params.internshipId, req.verifiedUser.id);
    if (!internship) {
      await connection.rollback(); transaction = false;
      return res.status(403).json({ success: false, error: "Only the student's current supervisor can remove these hours." });
    }
    const previous = await currentSchedule(connection, internship.id);
    if (!previous) {
      await connection.rollback(); transaction = false;
      return res.json({ success: true, message: "No shift hours were set for this student." });
    }
    await connection.execute("DELETE FROM dtr_shift_restrictions WHERE internship_id = ?", [internship.id]);
    await versionEmployerSchedule(connection, internship.id, req.verifiedUser.id, null, []);
    const notice = await recordChange(connection, req.verifiedUser, internship, "removed", null);
    await connection.commit(); transaction = false;
    deliver(req, notice);
    return res.json({ success: true, message: "Shift hours removed. The student has been notified; existing DTR labels remain unchanged." });
  } catch (error) {
    if (transaction) await connection.rollback().catch(() => {});
    reportError("Remove DTR shift restriction failed:", error);
    return res.status(500).json({ success: false, error: "Could not confirm removal. Refresh before retrying; the change may have completed." });
  } finally { connection?.release(); }
}
