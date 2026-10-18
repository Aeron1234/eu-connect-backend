import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";
import { getActivityLogUserName } from "../../../config/activityLogNames.js";
import { invalidateProfileOverviewCache } from "../../../config/cache/profileOverviewCache.js";
import { invalidateStaffInternshipsCache } from "../../../config/cache/staffInternshipsCache.js";
import { invalidatePastInternshipsCache } from "../../../config/cache/pastInternshipsCache.js";
import { invalidateHteReportsCache } from "../../../config/cache/reportsCache.js";
import { invalidateAlumniCache } from "../../../config/cache/alumniCache.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";

function readPlacement(body = {}) {
  const fields = {};
  for (const name of ["company_name", "company_address", "internship_position", "description", "date_started", "date_ended", "semester"]) {
    if (typeof body[name] !== "string" || !body[name].trim()) {
      return { error: `${name.replaceAll("_", " ")} is required.` };
    }
    fields[name] = body[name].trim();
  }
  if (body.company_website != null && typeof body.company_website !== "string") {
    return { error: "Company website must be text." };
  }
  fields.company_website = body.company_website?.trim() || null;
  if (!["1st", "2nd", "summer"].includes(fields.semester)) {
    return { error: "Select a valid semester." };
  }
  for (const name of ["date_started", "date_ended"]) {
    const date = new Date(`${fields[name]}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[name]) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fields[name]) {
      return { error: "Enter valid start and end dates." };
    }
  }
  if (fields.date_ended < fields.date_started) return { error: "End date cannot be before the start date." };
  for (const name of ["total_hours", "lat", "lon", "region_id"]) {
    const value = body[name];
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(Number(value))) {
      return { error: `${name.replaceAll("_", " ")} must be a valid number.` };
    }
    fields[name] = Number(value);
  }
  if (fields.total_hours <= 0) return { error: "Required hours must be greater than zero." };
  if (fields.lat < -90 || fields.lat > 90 || fields.lon < -180 || fields.lon > 180) return { error: "Select a valid company location on the map." };
  if (!Number.isInteger(fields.region_id) || fields.region_id <= 0) return { error: "Select a valid region." };
  return { fields };
}

export async function updateOwnPendingInternshipRecord(req, res) {
  let connection;
  let transaction = false;
  try {
    const { id: studentId, role } = req.verifiedUser;
    const { internshipId } = req.params;
    if (role !== "student") return res.status(403).json({ error: "Only students can edit their own pending internship records." });
    if (!internshipId) return res.status(400).json({ error: "Internship record ID is required." });
    const { fields, error } = readPlacement(req.body);
    if (error) return res.status(400).json({ error });

    connection = await db.getConnection();
    await connection.beginTransaction();
    transaction = true;
    const [rows] = await connection.execute(
      "SELECT * FROM internship_records WHERE id = ? FOR UPDATE", [internshipId],
    );
    const record = rows[0];
    if (!record || record.deleted_at !== null) {
      await connection.rollback(); transaction = false;
      return res.status(404).json({ error: "Internship record not found." });
    }
    if (String(record.user_id) !== String(studentId)) {
      await connection.rollback(); transaction = false;
      return res.status(403).json({ error: "You can only edit your own internship records." });
    }
    if (record.status !== "pending") {
      await connection.rollback(); transaction = false;
      return res.status(409).json({ error: "Only pending internship records can be edited. Refresh to view the current status." });
    }
    const [regions] = await connection.execute("SELECT id FROM regions WHERE id = ?", [fields.region_id]);
    if (!regions.length) {
      await connection.rollback(); transaction = false;
      return res.status(400).json({ error: "Select a valid region." });
    }
    const [result] = await connection.execute(
      `UPDATE internship_records SET company_name = ?, company_address = ?, internship_position = ?,
       company_website = ?, description = ?, date_started = ?, date_ended = ?, total_hours = ?,
       region_id = ?, semester = ?, lat = ?, lon = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
      [fields.company_name, fields.company_address, fields.internship_position, fields.company_website,
        fields.description, fields.date_started, fields.date_ended, fields.total_hours, fields.region_id,
        fields.semester, fields.lat, fields.lon, internshipId, studentId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback(); transaction = false;
      return res.status(409).json({ error: "The internship record changed. Please refresh and try again." });
    }
    const name = await getActivityLogUserName(connection, studentId);
    await connection.execute(
      `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [studentId, role, "internship_record_updated", "internship_records", internshipId,
        `${name} updated a pending internship record for ${fields.company_name}.`,
        JSON.stringify({ previous_company_name: record.company_name, company_name: fields.company_name, status: "pending" })],
    );
    await connection.commit();
    transaction = false;
    invalidateProfileOverviewCache();
    invalidateStaffInternshipsCache();
    invalidatePastInternshipsCache();
    invalidateHteReportsCache();
    invalidateAlumniCache();
    invalidateNotificationsCache();
    invalidateActivityLogsCache();
    return res.status(200).json({ success: true, message: "Pending internship record updated.", record: { ...record, ...fields } });
  } catch (error) {
    if (transaction) await connection.rollback();
    reportError("Update own pending internship record error:", error);
    return res.status(500).json({ error: "Failed to update internship record." });
  } finally {
    if (connection) connection.release();
  }
}
