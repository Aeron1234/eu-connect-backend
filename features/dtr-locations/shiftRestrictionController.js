import { db } from "../../config/db.js";
import { reportError } from "../../config/errorTracking.js";

const validTime = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

async function ownedInternship(connection, internshipId, employerId) {
  const [rows] = await connection.execute(
    `SELECT ir.id FROM internship_records ir JOIN users u ON u.id = ir.user_id
     WHERE ir.id = ? AND ir.employer_id = ? AND ir.status = 'ongoing'
       AND ir.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [internshipId, employerId],
  );
  return Boolean(rows.length);
}

export async function saveShiftRestriction(req, res) {
  const { clockInTime, clockOutTime } = req.body || {};
  if (!validTime(clockInTime) || !validTime(clockOutTime) || clockInTime === clockOutTime)
    return res.status(400).json({ success: false, error: "Choose different, valid start and end times." });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    if (!await ownedInternship(connection, req.params.internshipId, req.verifiedUser.id)) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: "Only the student's current supervisor can set these hours." });
    }
    await connection.execute(
      `INSERT INTO dtr_shift_restrictions (internship_id, employer_id, clock_in_time, clock_out_time)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE employer_id = VALUES(employer_id),
       clock_in_time = VALUES(clock_in_time), clock_out_time = VALUES(clock_out_time)`,
      [req.params.internshipId, req.verifiedUser.id, clockInTime, clockOutTime],
    );
    await connection.commit();
    return res.json({ success: true, message: "Shift hours saved. Future DTR entries will use this schedule." });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    reportError("Save DTR shift restriction failed:", error);
    return res.status(500).json({ success: false, error: "Could not save shift hours. Refresh before retrying." });
  } finally { connection?.release(); }
}

export async function removeShiftRestriction(req, res) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    if (!await ownedInternship(connection, req.params.internshipId, req.verifiedUser.id)) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: "Only the student's current supervisor can remove these hours." });
    }
    await connection.execute("DELETE FROM dtr_shift_restrictions WHERE internship_id = ?", [req.params.internshipId]);
    await connection.commit();
    return res.json({ success: true, message: "Shift hours removed. Existing DTR labels remain unchanged." });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    reportError("Remove DTR shift restriction failed:", error);
    return res.status(500).json({ success: false, error: "Could not remove shift hours. Refresh before retrying." });
  } finally { connection?.release(); }
}
