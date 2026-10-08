import { reportError } from "../config/errorTracking.js";
import { invalidateAttendanceHistoryCache } from "../config/attendanceHistoryCache.js";
import { invalidateProfileOverviewCache } from "../config/profileOverviewCache.js";
import { invalidateDepartmentInternshipsCache } from "../config/staffInternshipsCache.js";
import { invalidateDashboardCache } from "../config/dashboardCache.js";
import { db } from "../config/db.js";
import { isWithinRadius } from "../config/helpers.js";
import { getMaxShiftHours } from "../config/shiftLimits.js";

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
       WHERE user_id = ? AND DATE(created_at) = CURDATE() AND internship_id = ?
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
      `SELECT id, clock_in, clock_out, status
       FROM daily_time_records 
       WHERE user_id = ? AND internship_id = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [userId, internshipId],
    );

    // If no records found, they have never clocked in before
    if (records.length === 0) {
      return res.status(200).json({ status: "CLOCKED_OUT", record: null });
    }

    const lastRecord = records[0];

    // Check if the last session is still open
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
  try {
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

    // Check for open time records
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

    // 1. Fetch ongoing internship along with custom dtr_location if available
    const [internships] = await connection.execute(
      `SELECT 
         ir.id AS internship_id, 
         ir.lat AS company_lat, 
         ir.lon AS company_lon,
         dl.lat AS dtr_lat, 
         dl.lon AS dtr_lon, 
         dl.radius_meters
       FROM internship_records ir
       LEFT JOIN dtr_locations dl ON ir.id = dl.internship_id
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

    // 2. Fallback Logic: Use dtr_locations if present; otherwise use internship_records (defaulting radius to 150m)
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

    // 3. Geofence check via isWithinRadius
    const { isWithin, distanceMeters } = isWithinRadius(
      location.latitude,
      location.longitude,
      targetLat,
      targetLon,
      allowedRadius,
    );

    // 4. THE REJECTION GUARD: If outside allowed radius, stop execution
    if (!isWithin) {
      await connection.rollback();
      return res.status(422).json({
        error: `Clock-in rejected. You are ${distanceMeters}m away from the designated area (Limit: ${allowedRadius}m).`,
        success: false,
      });
    }

    // 5. Insert daily time record
    const [result] = await connection.execute(
      `INSERT INTO daily_time_records 
       (internship_id, user_id, clock_in, lat_in, lon_in, status) 
       VALUES (?, ?, NOW(), ?, ?, 'present')`,
      [record.internship_id, userId, location.latitude, location.longitude],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      throw new Error("Insert failed");
    }

    await connection.commit();
    invalidateAttendanceHistoryCache();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();
    invalidateDepartmentInternshipsCache();

    res.status(201).json({
      message: "Clock-in successful. Location verified.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Clock-in error:", error);
    res.status(500).json({
      error: "Server error during clock-in.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

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

  try {
    const maxShiftHours = getMaxShiftHours();
    const { id: userId } = req.verifiedUser;
    const { lat_out, lon_out } = req.body;
    const location = parseDtrCoordinates(lat_out, lon_out);

    if (!location) {
      return res.status(400).json({
        error: "A valid current location is required to clock out. Please enable location access and try again.",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Find active clock-in, company coordinates, AND optional dtr_locations coordinates
    const [activeRecords] = await connection.execute(
      `SELECT 
         dtr.id AS dtr_id, 
         dtr.internship_id, 
         dtr.clock_in, 
         dtr.status,
         dtr.break_started_at,
         dtr.break_total_seconds,
         ir.lat AS company_lat, 
         ir.lon AS company_lon,
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
    if (record.status === "on-break" || record.break_started_at != null) {
      await connection.rollback();
      return res.status(409).json({
        error: "Resume duty before clocking out.",
        success: false,
      });
    }

    // 2. Fallback Logic: Prefer dtr_locations, fallback to internship_records (radius default: 150m)
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

    // 3. Geofence Check for Clock Out using isWithinRadius
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

    // 4. Calculate Shift Hours
    const [timeResult] = await connection.execute(
      `SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, NOW()) - ?) / 3600 AS hours`,
      [record.clock_in, Number(record.break_total_seconds) || 0],
    );

    const rawHours = Number(timeResult[0]?.hours) || 0;

    // 5. Sanity check: cap and flag abnormally long shifts
    let finalHours = rawHours;
    let flagged = false;
    let flagReason = null;

    if (rawHours > maxShiftHours) {
      flagged = true;
      flagReason = `Shift exceeded ${maxShiftHours}h cap (raw: ${rawHours.toFixed(2)}h). Possible forgotten clock-out.`;
      finalHours = maxShiftHours;
    }

    // 6. Update Daily Time Record
    const [updateDtr] = await connection.execute(
      `UPDATE daily_time_records 
       SET clock_out = NOW(), 
           lat_out = ?, 
           lon_out = ?, 
           total_hours = ?,
           flagged = ?,
           flag_reason = ?
       WHERE id = ?`,
      [location.latitude, location.longitude, finalHours, flagged, flagReason, record.dtr_id],
    );

    // 7. Update Internship Accumulated Hours (use capped hours, not raw)
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

    await connection.commit();
    invalidateAttendanceHistoryCache();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();
    invalidateDepartmentInternshipsCache();

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
    reportError("Clock-out Error:", error);
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

    // 1. Subtract hours from the internship record first
    // COALESCE ensures we subtract 0 if they haven't clocked out yet
    await connection.execute(
      `
      UPDATE internship_records ir
      INNER JOIN daily_time_records dtr ON ir.id = dtr.internship_id
      SET ir.accumulated_hours = ir.accumulated_hours - COALESCE(dtr.total_hours, 0)
      WHERE dtr.id = ? AND dtr.user_id = ?
      `,
      [dtrId, id],
    );

    // 2. Delete the record
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

export const getMySettedDtrLocation = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: studentId } = req.verifiedUser;
    const { internshipId } = req.query;

    if (!studentId) {
      return res.status(400).json({ error: "studentId is required." });
    }

    const [rows] = await connection.execute(
      `SELECT 
         ir.id AS internship_id,
         ir.lat AS company_lat,
         ir.lon AS company_lon,
         dl.id AS dtr_location_id,
         dl.set_by,
         dl.lat AS dtr_lat,
         dl.lon AS dtr_lon,
         dl.radius_meters,
         dl.address,
         dl.label,
         dl.created_at AS dtr_created_at,
         dl.updated_at AS dtr_updated_at
       FROM internship_records AS ir
       LEFT JOIN dtr_locations AS dl ON ir.id = dl.internship_id
       WHERE ir.user_id = ? AND ir.status = 'ongoing' AND ir.id = ?
       LIMIT 1`,
      [studentId, internshipId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No ongoing internship found for this student.",
        success: false,
      });
    }

    const record = rows[0];
    const isCustom = record.dtr_location_id !== null;

    res.status(200).json({
      success: true,
      internship_id: record.internship_id,
      is_custom_location: isCustom,
      location: {
        lat: isCustom ? record.dtr_lat : record.company_lat,
        lon: isCustom ? record.dtr_lon : record.company_lon,
        radius_meters: isCustom ? record.radius_meters : 150, // keep in sync with your default elsewhere
        label: isCustom ? record.label : "Company address (default)",
        address: isCustom ? record.address : null,
        set_by: isCustom ? record.set_by : null,
        created_at: isCustom ? record.dtr_created_at : null,
        updated_at: isCustom ? record.dtr_updated_at : null,
      },
    });
  } catch (error) {
    reportError("Get DTR location error:", error);
    res.status(500).json({ error: "Database query failed.", success: false });
  } finally {
    if (connection) connection.release();
  }
};
