import { randomUUID } from "node:crypto";
import { db } from "../../config/db.js";
import { canHeadReadStudentRecords } from "../../config/studentProfileAccess.js";
import { reportError } from "../../config/errorTracking.js";
import { invalidateProfileOverviewCache } from "../../config/cache/profileOverviewCache.js";
import { invalidateWeeklyNarrativesCache } from "../../config/cache/weeklyNarrativesCache.js";
import { invalidateActivityLogsCache } from "../../config/cache/activityLogsCache.js";
import {
  readRotation,
  rotationEnabled,
  rotationError,
} from "./rotationPolicy.js";

async function authorize(connection, internshipId, viewer, write = false) {
  const [records] = await connection.execute(
    `SELECT id, user_id, employer_id, status, deleted_at, rotations_enabled, company_name,
       DATE_FORMAT(date_started, '%Y-%m-%d') AS date_started, DATE_FORMAT(date_ended, '%Y-%m-%d') AS date_ended
     FROM internship_records WHERE id = ?${write ? " FOR UPDATE" : ""}`,
    [internshipId],
  );
  const record = records[0];
  if (!record || record.deleted_at)
    throw rotationError("Internship record not found.", 404);
  const owner =
    viewer.role === "student" && String(record.user_id) === String(viewer.id);
  if (write) {
    if (!owner)
      throw rotationError(
        "Only the student can manage their own company rotations.",
        403,
      );
    if (!["pending", "ongoing"].includes(record.status))
      throw rotationError(
        "Rotations can only be changed on pending or ongoing internships.",
        409,
      );
  } else if (!(
    owner ||
    (viewer.role === "employer" &&
      record.employer_id != null &&
      String(record.employer_id) === String(viewer.id)) ||
    (viewer.role === "department_head" &&
      (await canHeadReadStudentRecords(connection, viewer.id, record.user_id)))
  )) {
    throw rotationError("You cannot view this internship's rotations.", 403);
  }
  return record;
}

export async function getRotations(req, res) {
  let connection;
  try {
    connection = await db.getConnection();
    const record = await authorize(
      connection,
      req.params.internshipId,
      req.verifiedUser,
    );
    const [rotations] = await connection.execute(
      `SELECT id, department_name, supervisor_name, notes, created_at, updated_at,
         DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from, DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
       FROM internship_rotations WHERE internship_id = ? AND deleted_at IS NULL ORDER BY date_from, id`,
      [record.id],
    );
    res.set?.("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      enabled: rotationEnabled(record.rotations_enabled),
      rotations,
      internshipId: record.id,
      dateStarted: record.date_started,
      // Kept as informational metadata for compatible readers, never a date cap.
      dateEnded: record.date_ended,
      canManage:
        req.verifiedUser.role === "student" &&
        ["pending", "ongoing"].includes(record.status),
      status: record.status,
    });
  } catch (error) {
    return fail(res, error);
  } finally {
    connection?.release();
  }
}

function fail(res, error) {
  if (!error.status) reportError("Company rotations request failed:", error);
  return res.status(error.status || 500).json({
    success: false,
    error: error.status
      ? error.message
      : "Could not load or save company rotations. Please try again.",
  });
}

// Locking the parent serializes settings, date-overlap checks and narrative snapshots.
export async function mutateRotation(req, res) {
  let connection,
    transaction = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transaction = true;
    const record = await authorize(
      connection,
      req.params.internshipId,
      req.verifiedUser,
      true,
    );
    let description;
    if (req.rotationOperation === "settings") {
      if (req.body?.enabled === undefined)
        throw rotationError("Choose whether company rotations are enabled.");
      const enabled = rotationEnabled(req.body.enabled);
      await connection.execute(
        "UPDATE internship_records SET rotations_enabled = ?, updated_at = NOW() WHERE id = ?",
        [Number(enabled), record.id],
      );
      description = `${enabled ? "Enabled" : "Disabled"} company rotations for ${record.company_name}.`;
    } else {
      if (!rotationEnabled(record.rotations_enabled))
        throw rotationError("Enable company rotations first.", 409);
      if (record.status !== "ongoing")
        throw rotationError(
          "Rotations can be recorded once the internship is ongoing.",
          409,
        );
      const id = req.params.rotationId;
      if (id) {
        const [existing] = await connection.execute(
          "SELECT id FROM internship_rotations WHERE id = ? AND internship_id = ? AND deleted_at IS NULL",
          [id, record.id],
        );
        if (!existing.length)
          throw rotationError("Rotation not found. Refresh the timeline.", 404);
      }
      if (req.method === "DELETE") {
        await connection.execute(
          "UPDATE internship_rotations SET deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND internship_id = ?",
          [id, record.id],
        );
        description = `Removed a company rotation from ${record.company_name}. Saved narrative assignments were retained.`;
      } else {
        const fields = readRotation(req.body || {}, record);
        const [overlaps] = await connection.execute(
          "SELECT id FROM internship_rotations WHERE internship_id = ? AND deleted_at IS NULL AND date_from <= ? AND date_to >= ? AND id <> ? LIMIT 1",
          [record.id, fields.date_to, fields.date_from, id || ""],
        );
        if (overlaps.length)
          throw rotationError(
            "These dates overlap another rotation. Adjust the range first.",
            409,
          );
        if (id) {
          await connection.execute(
            "UPDATE internship_rotations SET department_name = ?, supervisor_name = ?, notes = ?, date_from = ?, date_to = ?, updated_at = NOW() WHERE id = ? AND internship_id = ?",
            [
              fields.department_name,
              fields.supervisor_name,
              fields.notes,
              fields.date_from,
              fields.date_to,
              id,
              record.id,
            ],
          );
        } else {
          await connection.execute(
            "INSERT INTO internship_rotations (id, internship_id, department_name, supervisor_name, notes, date_from, date_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              randomUUID(),
              record.id,
              fields.department_name,
              fields.supervisor_name,
              fields.notes,
              fields.date_from,
              fields.date_to,
            ],
          );
        }
        description = `${id ? "Updated" : "Added"} the ${fields.department_name} rotation at ${record.company_name} (${fields.date_from} to ${fields.date_to}).`;
      }
    }
    await connection.execute(
      "INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description) VALUES (?, ?, ?, ?, ?, ?)",
      [
        req.verifiedUser.id,
        req.verifiedUser.role,
        "internship_rotations_updated",
        "internship_records",
        record.id,
        description,
      ],
    );
    await connection.commit();
    transaction = false;
    invalidateProfileOverviewCache();
    invalidateWeeklyNarrativesCache();
    invalidateActivityLogsCache();
    return res.json({ success: true, message: "Company rotations updated." });
  } catch (error) {
    if (transaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        reportError("Rotation rollback failed:", rollbackError);
      }
    }
    return fail(res, error);
  } finally {
    connection?.release();
  }
}
