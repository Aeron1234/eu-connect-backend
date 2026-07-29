import { db } from "../config/db.js";
import { isWithinRadius } from "../config/helpers.js";

export const getTodayDTR = async (req, res) => {
  try {
    const { id } = req.verifiedUser;
    const { internshipId } = req.query;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [rows] = await db.execute(
      `SELECT id, clock_in, clock_out, created_at, status FROM daily_time_records 
       WHERE user_id = ? AND DATE(created_at) = CURDATE() AND internship_id = ?
       LIMIT 1`,
      [id, internshipId],
    );

    const record = rows.length > 0 ? rows[0] : null;

    res.status(200).json(record);
  } catch (error) {
    console.error("Get today's DTR error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllDTRs = async (req, res) => {
  try {
    const { id } = req.verifiedUser;
    const internshipId = req.query.internshipId;
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM daily_time_records 
       WHERE user_id = ? AND internship_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?
       `,
      [id, internshipId, limit, offset],
    );

    const [countResult] = await db.execute(
      `SELECT COUNT(*) AS total FROM daily_time_records
        WHERE user_id = ? AND internship_id = ?`,
      [id, internshipId],
    );

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      dtrs: rows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
    });
  } catch (error) {
    console.error("Get all DTRs error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getLatestDtrStatus = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { internshipId } = req.query;

    const [records] = await db.execute(
      `SELECT id, clock_in, clock_out 
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
    if (lastRecord.clock_out === null) {
      return res.status(200).json({ status: "CLOCKED_IN", record: lastRecord });
    }

    return res.status(200).json({ status: "CLOCKED_OUT", record: lastRecord });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get DTR status" });
  }
};

export const clockIn = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id: userId } = req.verifiedUser;
    const { lat_in, lon_in } = req.body;

    if (!lat_in || !lon_in) {
      return res
        .status(400)
        .json({ error: "Location data is required to clock in." });
    }

    await connection.beginTransaction();

    // Check for open time records
    const [openRecords] = await connection.execute(
      `SELECT id FROM daily_time_records 
       WHERE user_id = ? AND clock_out IS NULL 
       LIMIT 1`,
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
       WHERE ir.user_id = ? AND ir.status = 'ongoing' 
       LIMIT 1`,
      [userId],
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

    // 3. Geofence check via isWithinRadius
    const { isWithin, distanceMeters } = isWithinRadius(
      lat_in,
      lon_in,
      targetLat,
      targetLon,
      allowedRadius,
    );

    // 4. THE REJECTION GUARD: If outside allowed radius, stop execution
    if (!isWithin) {
      await connection.rollback();
      return res.status(403).json({
        error: `Clock-in rejected. You are ${distanceMeters}m away from the designated area (Limit: ${allowedRadius}m).`,
        success: false,
      });
    }

    // 5. Insert daily time record
    const [result] = await connection.execute(
      `INSERT INTO daily_time_records 
       (internship_id, user_id, clock_in, lat_in, lon_in, status) 
       VALUES (?, ?, NOW(), ?, ?, 'present')`,
      [record.internship_id, userId, lat_in, lon_in],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      throw new Error("Insert failed");
    }

    await connection.commit();

    res.status(201).json({
      message: "Clock-in successful. Location verified.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Clock-in error:", error);
    res.status(500).json({
      error: "Server error during clock-in.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const clockOut = async (req, res) => {
  const MAX_SHIFT_HOURS = process.env.MAX_SHIFT_HOURS; // adjust to your school/DOLE policy
  let connection;

  try {
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;
    const { lat_out, lon_out } = req.body;

    if (!lat_out || !lon_out) {
      return res.status(400).json({
        error: "Location data is required to clock out.",
      });
    }

    await connection.beginTransaction();

    // 1. Find active clock-in, company coordinates, AND optional dtr_locations coordinates
    const [activeRecords] = await connection.execute(
      `SELECT 
         dtr.id AS dtr_id, 
         dtr.internship_id, 
         dtr.clock_in, 
         ir.lat AS company_lat, 
         ir.lon AS company_lon,
         dl.lat AS dtr_lat,
         dl.lon AS dtr_lon,
         dl.radius_meters
       FROM daily_time_records dtr
       INNER JOIN internship_records ir ON dtr.internship_id = ir.id
       LEFT JOIN dtr_locations dl ON ir.id = dl.internship_id
       WHERE dtr.user_id = ? AND dtr.clock_out IS NULL 
       LIMIT 1`,
      [userId],
    );

    if (activeRecords.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "No active clock-in found. You need to clock in first.",
      });
    }

    const record = activeRecords[0];

    // 2. Fallback Logic: Prefer dtr_locations, fallback to internship_records (radius default: 150m)
    const targetLat = record.dtr_lat ?? record.company_lat;
    const targetLon = record.dtr_lon ?? record.company_lon;
    const allowedRadius = record.radius_meters ?? 150;

    if (targetLat == null || targetLon == null) {
      await connection.rollback();
      return res.status(500).json({
        error:
          "No location configured for this internship. Contact your coordinator.",
      });
    }

    // 3. Geofence Check for Clock Out using isWithinRadius
    const { isWithin, distanceMeters } = isWithinRadius(
      lat_out,
      lon_out,
      targetLat,
      targetLon,
      allowedRadius,
    );

    if (!isWithin) {
      await connection.rollback();
      return res.status(403).json({
        error: `Clock-out rejected. You are ${distanceMeters}m away from the designated area (Limit: ${allowedRadius}m).`,
        success: false,
      });
    }

    // 4. Calculate Shift Hours
    const [timeResult] = await connection.execute(
      `SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) / 3600 AS hours`,
      [record.clock_in],
    );

    const rawHours = Number(timeResult[0]?.hours) || 0;

    // 5. Sanity check: cap and flag abnormally long shifts
    let finalHours = rawHours;
    let flagged = false;
    let flagReason = null;

    if (rawHours > MAX_SHIFT_HOURS) {
      flagged = true;
      flagReason = `Shift exceeded ${MAX_SHIFT_HOURS}h cap (raw: ${rawHours.toFixed(2)}h). Possible forgotten clock-out.`;
      finalHours = MAX_SHIFT_HOURS;
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
      [lat_out, lon_out, finalHours, flagged, flagReason, record.dtr_id],
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
    console.error("Clock-out Error:", error);
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
