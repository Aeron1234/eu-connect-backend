import { reportError } from "../../../config/errorTracking.js";
import { invalidateAttendanceHistoryCache } from "../../../config/cache/attendanceHistoryCache.js";
import { invalidateProfileOverviewCache } from "../../../config/cache/profileOverviewCache.js";
import { invalidateDepartmentInternshipsCache } from "../../../config/cache/staffInternshipsCache.js";
import { invalidateDashboardCache } from "../../../config/cache/dashboardCache.js";
import { db } from "../../../config/db.js";
import { isWithinRadius, verifyRecordAccess } from "../../../config/helpers.js";
import { getMaxShiftHours } from "../../../config/shiftLimits.js";
import { afterUploadCommit, cleanupUploadPaths } from "../../../config/uploadLifecycle.js";
import { supabase } from "../../../config/supabase.js";
import { uploadDtrPhoto, validateDtrPhoto } from "../dtrPhoto.js";
import { datedShiftExpectations, clockOutTiming } from "../shiftTiming.js";

const MIN_REST_SECONDS = 6 * 60 * 60;

// Reject absent, blank, non-numeric or out-of-range coordinates, preserving zero.
// This validates submitted values; it does not establish when the device acquired them.
function parseDtrCoordinates(lat, lon) {
  if (lat == null || lon == null || String(lat).trim() === "" || String(lon).trim() === "") {
    return null;
  }
  if (!["number", "string"].includes(typeof lat) ||
      !["number", "string"].includes(typeof lon)) {
    return null;
  }
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  return { latitude, longitude };
}

// Valid GPS coordinates can still fail when an older schema stores longitude in
// DECIMAL(10,8), which cannot represent values above 99.99999999.
function isCoordinateStorageError(error) {
  return error?.code === "ER_WARN_DATA_OUT_OF_RANGE" &&
    /column ['`](?:lat|lon)_(?:in|out)['`]/i.test(error.sqlMessage || error.message || "");
}

export const getTodayDTR = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id } = req.verifiedUser;
    const { internshipId } = req.query;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [rows] = await connection.execute(
      `SELECT id, clock_in, clock_out, created_at, status FROM daily_time_records 
       WHERE user_id = ? AND internship_id = ? AND clock_in IS NOT NULL
         AND (clock_in >= CURDATE() OR clock_out >= CURDATE() OR clock_out IS NULL)
       ORDER BY clock_in DESC
       LIMIT 1`,
      [id, internshipId],
    );

    const record = rows.length > 0 ? rows[0] : null;

    res.status(200).json(record);
  } catch (error) {
    reportError("Get today's DTR error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getAllDTRs = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id } = req.verifiedUser;
    const internshipId = req.query.internshipId;
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [pageRows] = await connection.execute(
      `SELECT dtr.*,
              (SELECT COUNT(*) FROM daily_time_records
               WHERE user_id = ? AND internship_id = ?) AS total_dtrs
       FROM daily_time_records dtr
       WHERE dtr.user_id = ? AND dtr.internship_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?
       `,
      [id, internshipId, id, internshipId, limit, offset],
    );

    let totalRecords = pageRows[0]?.total_dtrs;
    if (pageRows.length === 0) {
      const [[{ total }]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM daily_time_records
          WHERE user_id = ? AND internship_id = ?`,
        [id, internshipId],
      );
      totalRecords = total;
    }
    const rows = pageRows.map(({ total_dtrs, ...row }) => row);
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      dtrs: rows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
    });
  } catch (error) {
    reportError("Get all DTRs error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getLatestDtrStatus = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;
    const { internshipId } = req.query;

    const [records] = await connection.execute(
      `SELECT id, clock_in, clock_out, status, auto_closed, auto_closed_at,
              auto_close_review_status, proposed_hours, total_hours, student_explanation,
              overtime_status, overtime_intended_end, overtime_reason, expected_clock_out
       FROM daily_time_records 
       WHERE user_id = ? AND internship_id = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [userId, internshipId],
    );

    // No saved rows for this user/internship means there is no shift to resume.
    if (records.length === 0) {
      return res.status(200).json({ status: "CLOCKED_OUT", record: null });
    }

    const lastRecord = records[0];

    // Only a row with clock-in and no clock-out is active; an on-break row remains open.
    if (lastRecord.clock_in != null && lastRecord.clock_out === null) {
      return res.status(200).json({
        status: lastRecord.status === "on-break" ? "ON_BREAK" : "CLOCKED_IN",
        record: lastRecord,
      });
    }

    return res.status(200).json({ status: "CLOCKED_OUT", record: lastRecord });
  } catch (error) {
    reportError(error);
    res.status(500).json({ error: "Failed to get DTR status" });
  } finally {
    if (connection) connection.release();
  }
};

export const clockIn = async (req, res) => {
  let connection;
  let photoPath;
  let commitAttempted = false;
  try {
    await validateDtrPhoto(req.file);
    const { id: userId } = req.verifiedUser;
    const { lat_in, lon_in } = req.body;
    const requestedInternshipId = req.query?.internshipId;
    const location = parseDtrCoordinates(lat_in, lon_in);

    if (!location) {
      return res
        .status(400)
        .json({ error: "A valid current location is required to clock in. Please enable location access and try again." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Serialize this student's clock-ins, including simultaneous requests for
    // different internships. Locking the user row also protects the empty day.
    const [studentRows] = await connection.execute(
      `SELECT id FROM users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (studentRows.length === 0) {
      await connection.rollback();
      return res.status(401).json({ error: "Your account is no longer available." });
    }

    // Check and lock an existing open shift across this student's internships
    // before allowing another clock-in.
    const [openRecords] = await connection.execute(
      `SELECT id FROM daily_time_records 
       WHERE user_id = ? AND clock_out IS NULL 
       LIMIT 1 FOR UPDATE`,
      [userId],
    );

    if (openRecords.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        error:
          "You are already clocked in. Please clock out before starting a new shift.",
      });
    }

    // Check every unresolved system closure, not just the latest shift. A later
    // normal entry must not hide an older explanation that is still required.
    const [unexplainedRows] = await connection.execute(
      `SELECT id FROM daily_time_records
       WHERE user_id = ? AND auto_close_review_status = 'pending_explanation'
       ORDER BY clock_in DESC, id DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (unexplainedRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: "Explain your automatically closed shift before starting another one.",
        dtrId: unexplainedRows[0].id,
      });
    }

    // A shift belongs to its Manila clock-in date, even when clock-out is the
    // next morning. After a prior-day shift, also require rest before another.
    const [lastShifts] = await connection.execute(
      `SELECT DATE(clock_in) = CURDATE() AS started_today,
              id,
              TIMESTAMPDIFF(SECOND, clock_out, NOW()) AS seconds_since_clock_out
       FROM daily_time_records
       WHERE user_id = ? AND clock_in IS NOT NULL
       ORDER BY clock_in DESC, id DESC
       LIMIT 1 FOR UPDATE`,
      [userId],
    );
    const lastShift = lastShifts[0];
    if (Number(lastShift?.started_today) === 1) {
      await connection.rollback();
      return res.status(409).json({
        error: "You have already clocked in for a shift starting today. Your next shift can start tomorrow (Philippine time).",
      });
    }
    const secondsSinceClockOut = Number(lastShift?.seconds_since_clock_out);
    if (lastShift && Number.isFinite(secondsSinceClockOut) && secondsSinceClockOut < MIN_REST_SECONDS) {
      await connection.rollback();
      return res.status(409).json({
        error: "Allow at least six hours after your last clock-out before starting another shift.",
      });
    }

    // Resolve the owned, non-deleted ongoing internship and optional geofence override.
    // has_started uses the database calendar day (configured for Philippine time).
    const [internships] = await connection.execute(
      `SELECT 
         ir.id AS internship_id, 
         ir.date_started,
         ir.date_started IS NOT NULL AND DATE(ir.date_started) <= CURDATE() AS has_started,
         ir.lat AS company_lat, 
         ir.lon AS company_lon,
         dl.lat AS dtr_lat, 
         dl.lon AS dtr_lon, 
         dl.radius_meters,
         TIME_FORMAT(sr.clock_in_time, '%H:%i') AS schedule_in,
         TIME_FORMAT(sr.clock_out_time, '%H:%i') AS schedule_out,
         DATE_FORMAT(sr.start_date, '%Y-%m-%d') AS schedule_start_date,
         DATE_FORMAT(sr.end_date, '%Y-%m-%d') AS schedule_end_date
       FROM internship_records ir
       LEFT JOIN dtr_locations dl ON ir.id = dl.internship_id
       LEFT JOIN dtr_shift_restrictions sr ON sr.internship_id = ir.id AND sr.employer_id = ir.employer_id
       WHERE ir.user_id = ? AND ir.status = 'ongoing' AND ir.deleted_at IS NULL
         ${requestedInternshipId ? "AND ir.id = ?" : ""}
       LIMIT 1`,
      requestedInternshipId ? [userId, requestedInternshipId] : [userId],
    );

    if (internships.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "No ongoing internship found." });
    }

    const record = internships[0];

    if (!record.date_started) {
      await connection.rollback();
      return res.status(409).json({ error: "This internship has no start date. Contact your coordinator before using DTR." });
    }
    if (!record.has_started) {
      await connection.rollback();
      return res.status(409).json({ error: "DTR becomes available on your internship start date." });
    }

    // Prefer non-null override coordinates; otherwise use company coordinates.
    // Use the override radius when provided, with 150 m as the default.
    const targetLat = record.dtr_lat ?? record.company_lat;
    const targetLon = record.dtr_lon ?? record.company_lon;
    const allowedRadius = record.radius_meters ?? 150;

    if (!parseDtrCoordinates(targetLat, targetLon) ||
        !Number.isFinite(Number(allowedRadius)) || Number(allowedRadius) <= 0) {
      await connection.rollback();
      return res.status(409).json({
        error: "No valid DTR location is configured for this internship. Contact your coordinator.",
      });
    }

    // Compare the submitted position to the configured target using rounded distance in meters.
    const { isWithin, distanceMeters } = isWithinRadius(
      location.latitude,
      location.longitude,
      targetLat,
      targetLon,
      allowedRadius,
    );

    // Reject an out-of-radius position before writing attendance.
    if (!isWithin) {
      await connection.rollback();
      return res.status(422).json({
        error: `Clock-in rejected. You are ${distanceMeters}m away from the designated area (Limit: ${allowedRadius}m).`,
        success: false,
      });
    }

    // Use one database clock value for the saved shift and the watermark burned
    // into its image. The browser never supplies the attendance timestamp.
    const [[{ recorded_at: recordedAt }]] = await connection.execute(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS recorded_at",
    );
    const expected = datedShiftExpectations(recordedAt, record.schedule_in, record.schedule_out,
      record.schedule_start_date, record.schedule_end_date);
    photoPath = await uploadDtrPhoto(req.file, recordedAt, "in", userId);
    const [result] = await connection.execute(
      `INSERT INTO daily_time_records 
       (internship_id, user_id, clock_in, lat_in, lon_in, clock_in_photo_path,
        expected_clock_in, expected_clock_out, is_late, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present')`,
      [record.internship_id, userId, recordedAt, location.latitude, location.longitude,
       photoPath, expected?.expectedIn ?? null, expected?.expectedOut ?? null, Number(expected?.late || false)],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      throw new Error("Insert failed");
    }

    commitAttempted = true;
    await connection.commit();
    afterUploadCommit(() => {
      invalidateAttendanceHistoryCache();
      invalidateProfileOverviewCache();
      invalidateDashboardCache();
      invalidateDepartmentInternshipsCache();
    });

    res.status(201).json({
      message: "Clock-in successful. Location verified.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (photoPath && !commitAttempted) await cleanupUploadPaths([photoPath]);
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    reportError("Clock-in error:", error);
    if (commitAttempted) return res.status(503).json({ success: false, error: "Clock-in confirmation was interrupted. Refresh your attendance before trying again." });
    if (isCoordinateStorageError(error)) {
      return res.status(503).json({
        success: false,
        code: "DTR_LOCATION_STORAGE_UNAVAILABLE",
        error: "Your clock-in could not be saved because of a server location-storage issue. Please contact your coordinator or administrator.",
      });
    }
    res.status(500).json({
      error: "Server error during clock-in.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Lock the authenticated user's latest open shift, then enforce present-to-break
// or break-to-present ordering. Repeated/out-of-order transitions return a conflict.
async function changeBreakState(req, res, starting) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, clock_in, status, break_started_at FROM daily_time_records
       WHERE user_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [req.verifiedUser.id],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "No active shift found. Clock in first.",
      });
    }

    const record = rows[0];
    if (record.clock_in == null) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "No active shift found. Clock in first.",
      });
    }

    // Starting records the DB break start without closing the shift. Resuming adds
    // elapsed break seconds once, clears the start and returns the row to present.
    const valid = starting
      ? record.status === "present" && record.break_started_at == null
      : record.status === "on-break" && record.break_started_at != null;
    if (!valid) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: starting ? "Break is already active." : "No active break to resume.",
      });
    }

    const [result] = await connection.execute(
      starting
        ? `UPDATE daily_time_records
           SET status = 'on-break', break_started_at = NOW()
           WHERE id = ? AND clock_in IS NOT NULL AND clock_out IS NULL AND status = 'present'
             AND break_started_at IS NULL`
        : `UPDATE daily_time_records
           SET break_total_seconds = break_total_seconds +
                 GREATEST(0, TIMESTAMPDIFF(SECOND, break_started_at, NOW())),
               break_started_at = NULL, status = 'present'
           WHERE id = ? AND clock_in IS NOT NULL AND clock_out IS NULL AND status = 'on-break'
             AND break_started_at IS NOT NULL`,
      [record.id],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Break state update failed.");
    }

    await connection.commit();
    invalidateAttendanceHistoryCache();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();

    return res.status(200).json({
      success: true,
      status: starting ? "ON_BREAK" : "CLOCKED_IN",
      message: starting ? "Break started." : "Duty resumed.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError(starting ? "Start break error:" : "Resume duty error:", error);
    return res.status(500).json({
      success: false,
      error: starting ? "Server error starting break." : "Server error resuming duty.",
    });
  } finally {
    if (connection) connection.release();
  }
}

export const startBreak = (req, res) => changeBreakState(req, res, true);
export const resumeDuty = (req, res) => changeBreakState(req, res, false);

export const clockOut = async (req, res) => {
  let connection;
  let photoPath;
  let commitAttempted = false;

  try {
    const maxShiftHours = getMaxShiftHours();
    const { id: userId } = req.verifiedUser;
    if (req.verifiedUser.role === "student") await validateDtrPhoto(req.file);
    const { lat_out, lon_out } = req.body;
    const location = parseDtrCoordinates(lat_out, lon_out);

    if (!location) {
      return res.status(400).json({
        error: "A valid current location is required to clock out. Please enable location access and try again.",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the user's open shift with its company/override location and accumulated breaks.
    // Manual clock-out must resume any active break before proceeding.
    const [activeRecords] = await connection.execute(
      `SELECT 
         dtr.id AS dtr_id, 
         dtr.internship_id, 
         dtr.clock_in, 
         DATE_FORMAT(dtr.expected_clock_out, '%Y-%m-%d %H:%i:%s') AS expected_clock_out,
         dtr.overtime_status,
         dtr.status,
         dtr.break_started_at,
         dtr.break_total_seconds,
         ir.lat AS company_lat, 
         ir.lon AS company_lon,
         ir.date_started,
         ir.date_started IS NOT NULL AND DATE(ir.date_started) <= CURDATE() AS has_started,
         dl.lat AS dtr_lat,
         dl.lon AS dtr_lon,
         dl.radius_meters
       FROM daily_time_records dtr
       INNER JOIN internship_records ir ON dtr.internship_id = ir.id
       LEFT JOIN dtr_locations dl ON ir.id = dl.internship_id
       WHERE dtr.user_id = ? AND dtr.clock_out IS NULL 
       LIMIT 1 FOR UPDATE`,
      [userId],
    );

    if (activeRecords.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "No active clock-in found. You need to clock in first.",
      });
    }

    const record = activeRecords[0];
    if (!record.date_started) {
      await connection.rollback();
      return res.status(409).json({ error: "This internship has no start date. Contact your coordinator before using DTR." });
    }
    if (!record.has_started) {
      await connection.rollback();
      return res.status(409).json({ error: "DTR becomes available on your internship start date." });
    }
    if (record.status === "on-break" || record.break_started_at != null) {
      await connection.rollback();
      return res.status(409).json({
        error: "Resume duty before clocking out.",
        success: false,
      });
    }

    // Use the same non-null coordinate fallback and 150 m default as clock-in.
    const targetLat = record.dtr_lat ?? record.company_lat;
    const targetLon = record.dtr_lon ?? record.company_lon;
    const allowedRadius = record.radius_meters ?? 150;

    if (!parseDtrCoordinates(targetLat, targetLon) ||
        !Number.isFinite(Number(allowedRadius)) || Number(allowedRadius) <= 0) {
      await connection.rollback();
      return res.status(409).json({
        error:
          "No valid DTR location is configured for this internship. Contact your coordinator.",
      });
    }

    // Manual clock-out also requires the submitted position to be within the target radius.
    const { isWithin, distanceMeters } = isWithinRadius(
      location.latitude,
      location.longitude,
      targetLat,
      targetLon,
      allowedRadius,
    );

    if (!isWithin) {
      await connection.rollback();
      return res.status(422).json({
        error: `Clock-out rejected. You are ${distanceMeters}m away from the designated area (Limit: ${allowedRadius}m).`,
        success: false,
      });
    }

    // Calculate elapsed duty in DB time, subtract completed break seconds and clamp at zero.
    // An active break has already been rejected, so no unfinished break is credited.
    const [timeResult] = await connection.execute(
      `SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, NOW()) - ?) / 3600 AS hours`,
      [record.clock_in, Number(record.break_total_seconds) || 0],
    );

    const rawHours = Number(timeResult[0]?.hours) || 0;

    // Cap credited duty and flag only when raw hours strictly exceed the duty limit.
    // Unlike automatic closure, manual clock-out retains the current DB clock-out time.
    let finalHours = rawHours;
    let flagged = false;
    let flagReason = null;

    if (rawHours > maxShiftHours) {
      flagged = true;
      flagReason = `Shift exceeded ${maxShiftHours}h credit cap (raw: ${rawHours.toFixed(2)}h; overtime ${record.overtime_status || "not requested"}).`;
      finalHours = maxShiftHours;
    }

    const [[{ recorded_at: recordedAt }]] = await connection.execute(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS recorded_at",
    );
    const timing = clockOutTiming(recordedAt, record.expected_clock_out);
    if (req.file) photoPath = await uploadDtrPhoto(req.file, recordedAt, "out", userId);
    // Save the clock-out position, credited hours and flag on the locked shift.
    const [updateDtr] = await connection.execute(
      `UPDATE daily_time_records 
       SET clock_out = ?, clock_out_photo_path = ?,
           lat_out = ?, 
           lon_out = ?, 
           total_hours = ?,
           flagged = ?,
           flag_reason = ?,
           is_undertime = ?, is_overtime = ?
       WHERE id = ?`,
      [recordedAt, photoPath ?? null, location.latitude, location.longitude, finalHours,
       flagged, flagReason, Number(timing.undertime), Number(timing.overtime), record.dtr_id],
    );

    // Add exactly the credited (possibly capped) hours to the internship in the
    // same transaction as shift closure, then invalidate caches after commit.
    const [updateInternship] = await connection.execute(
      `UPDATE internship_records 
       SET accumulated_hours = accumulated_hours + ? 
       WHERE id = ?`,
      [finalHours, record.internship_id],
    );

    if (updateDtr.affectedRows === 0 || updateInternship.affectedRows === 0) {
      await connection.rollback();
      throw new Error("Failed to update records.");
    }

    commitAttempted = true;
    await connection.commit();
    afterUploadCommit(() => {
      invalidateAttendanceHistoryCache();
      invalidateProfileOverviewCache();
      invalidateDashboardCache();
      invalidateDepartmentInternshipsCache();
    });

    res.status(200).json({
      message: flagged
        ? "Clocked-out successfully, but this shift was flagged for review (unusually long duration)."
        : "Clocked-out successfully! Hours recorded.",
      success: true,
      shiftHours: finalHours.toFixed(2),
      flagged,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (photoPath && !commitAttempted) await cleanupUploadPaths([photoPath]);
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    reportError("Clock-out Error:", error);
    if (commitAttempted) return res.status(503).json({ success: false, error: "Clock-out confirmation was interrupted. Refresh your attendance before trying again." });
    if (isCoordinateStorageError(error)) {
      return res.status(503).json({
        success: false,
        code: "DTR_LOCATION_STORAGE_UNAVAILABLE",
        error: "Your clock-out could not be saved because of a server location-storage issue. Please contact your coordinator or administrator.",
      });
    }
    res.status(500).json({
      error: "Server error during clock-out.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteDTR = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id } = req.verifiedUser;
    const dtrId = req.params.dtrId;

    if (!dtrId) {
      return res.status(400).json({ error: "DTR ID is required" });
    }

    await connection.beginTransaction();

    const [records] = await connection.execute(
      `SELECT clock_in, clock_out, clock_in_photo_path, clock_out_photo_path, auto_closed,
              DATE(clock_in) = CURDATE() AS started_today,
              TIMESTAMPDIFF(SECOND, clock_out, NOW()) AS seconds_since_clock_out
       FROM daily_time_records WHERE id = ? AND user_id = ? FOR UPDATE`,
      [dtrId, id],
    );
    if (records.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "DTR record not found or you do not have permission to delete it." });
    }
    const record = records[0];
    if (record.auto_closed) {
      await connection.rollback();
      return res.status(409).json({ error: "Auto-closed attendance entries must remain available for explanation and review." });
    }
    const elapsedSinceClockOut = Number(record.seconds_since_clock_out);
    if (record.clock_in != null &&
        (record.clock_out == null || Number(record.started_today) === 1 ||
         (Number.isFinite(elapsedSinceClockOut) && elapsedSinceClockOut < MIN_REST_SECONDS))) {
      await connection.rollback();
      return res.status(409).json({
        error: "An open shift, today's shift, or a shift ended less than six hours ago cannot be deleted.",
      });
    }

    // Subtract this owned DTR's credited total from its internship before deletion.
    // An unfinished row has no credited total, so COALESCE subtracts zero.
    await connection.execute(
      `
      UPDATE internship_records ir
      INNER JOIN daily_time_records dtr ON ir.id = dtr.internship_id
      SET ir.accumulated_hours = ir.accumulated_hours - COALESCE(dtr.total_hours, 0)
      WHERE dtr.id = ? AND dtr.user_id = ?
      `,
      [dtrId, id],
    );

    // Delete only the authenticated user's row; rollback also reverses the subtraction.
    const [result] = await connection.execute(
      `DELETE FROM daily_time_records WHERE id = ? AND user_id = ?`,
      [dtrId, id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "DTR record not found or you do not have permission to delete it.",
      });
    }

    await connection.commit();
    await cleanupUploadPaths([record.clock_in_photo_path, record.clock_out_photo_path].filter(Boolean));
    invalidateAttendanceHistoryCache();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();
    invalidateDepartmentInternshipsCache();
    res.status(200).json({
      message: "Record deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Delete DTR error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getDtrPhoto = async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const dtrId = Number(req.params.dtrId);
  const kind = req.params.kind;
  if (!Number.isSafeInteger(dtrId) || dtrId < 1 || !["in", "out"].includes(kind))
    return res.status(400).json({ error: "Invalid attendance photo request." });
  let connection;
  try {
    connection = await db.getConnection();
    const [rows] = await connection.execute(
      `SELECT dtr.clock_in_photo_path, dtr.clock_out_photo_path, ir.id AS internship_id,
              ir.user_id, ir.employer_id, ir.deleted_at
       FROM daily_time_records dtr
       JOIN internship_records ir ON ir.id = dtr.internship_id
       WHERE dtr.id = ? LIMIT 1`, [dtrId],
    );
    const row = rows[0];
    if (!row || row.deleted_at) return res.status(404).json({ error: "Attendance photo not found." });
    const { id, role } = req.verifiedUser;
    if (role === "department_head") await verifyRecordAccess(connection, row.internship_id, id, role);
    else if (role !== "admin" && !(role === "student" && row.user_id === id) &&
             !(role === "employer" && row.employer_id === id))
      return res.status(403).json({ error: "Access denied." });
    const path = kind === "in" ? row.clock_in_photo_path : row.clock_out_photo_path;
    if (!path) return res.status(404).json({ error: "This attendance record has no photo." });
    const { data, error } = await supabase.storage.from(process.env.SUPABASE_BUCKET).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return res.status(503).json({ error: "Photo is temporarily unavailable." });
    return res.json({ url: data.signedUrl });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    reportError("DTR photo read failed:", error);
    return res.status(500).json({ error: "Could not load attendance photo." });
  } finally {
    connection?.release();
  }
};

