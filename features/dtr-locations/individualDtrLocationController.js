import { db } from '../../config/db.js';
import { reportError } from '../../config/errorTracking.js';
import { invalidateNotificationsCache } from '../../config/cache/notificationsCache.js';
import { validateDtrLocation } from './locationRules.js';

// Existing individual and student reads retain their API contracts and attendance rules.
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
        radius_meters: isCustom ? record.radius_meters : 150, // Default company geofence radius in meters.
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

export const getSearchedStudentDtrLocation = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(400).json({ error: "studentId is required." });
    }

    const [rows] = await db.execute(
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
       WHERE ir.user_id = ? AND ir.status = 'ongoing' AND ir.deleted_at IS NULL
       LIMIT 1`,
      [studentId],
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        internship_id: null,
        is_custom_location: false,
        location: null,
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
  }
};

export const setSearchedStudentDtrLocation = async (req, res) => {
  const { searchedUserId } = req.params;
  const { internshipId } = req.query;
  const { id: setterId, role } = req.verifiedUser;

  let connection;
  try {
    if (!searchedUserId || !internshipId) return res.status(400).json({ error: "Student and internship record are required." });
    let validated;
    try { validated = validateDtrLocation(req.body); }
    catch (error) { return res.status(error.status || 400).json({ success: false, error: error.message }); }
    const { lat: latNum, lon: lonNum, radius_meters: radiusMeters, label, address } = validated;
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 2. Verify the internship exists AND actually belongs to the searched student
    const [internships] = await connection.execute(
      `SELECT ir.id, ir.user_id, ir.employer_id,
              student.first_name AS student_first_name,
              student.last_name AS student_last_name
       FROM internship_records ir
       LEFT JOIN user_profiles student ON student.user_id = ir.user_id
       WHERE ir.id = ? AND ir.user_id = ?
       LIMIT 1`,
      [internshipId, searchedUserId],
    );

    if (internships.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "No matching internship found for this student.",
      });
    }

    const internship = internships[0];

    // Employers must be this internship's current accepted supervisor.
    // Staff bypass this employer check; the mounted route separately enforces
    // current department access for department heads.
    if (role === "employer" && internship.employer_id !== setterId) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "Only this student's accepted supervisor can set the DTR location.",
      });
    }

    // 3. Check whether a DTR location already exists for this internship (1:1 relation)
    const [existingLocations] = await connection.execute(
      `SELECT id FROM dtr_locations WHERE internship_id = ? LIMIT 1`,
      [internshipId],
    );

    let dtrLocationId;

    if (existingLocations.length > 0) {
      // 4a. Update existing custom location
      dtrLocationId = existingLocations[0].id;

      const [updateResult] = await connection.execute(
        `UPDATE dtr_locations 
         SET set_by = ?, lat = ?, lon = ?, radius_meters = ?, label = ?, address = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          setterId,
          latNum,
          lonNum,
          radiusMeters,
          label ?? null,
          address ?? null,
          dtrLocationId,
        ],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        throw new Error("Failed to update DTR location.");
      }
    } else {
      // 4b. Insert new custom location
      const [insertResult] = await connection.execute(
        `INSERT INTO dtr_locations 
         (internship_id, set_by, lat, lon, radius_meters, label, address, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          internshipId,
          setterId,
          latNum,
          lonNum,
          radiusMeters,
          label ?? null,
          address ?? null,
        ],
      );

      if (insertResult.affectedRows === 0) {
        await connection.rollback();
        throw new Error("Failed to insert DTR location.");
      }

      dtrLocationId = insertResult.insertId;
    }

    // Notify the student — the label they see this as is the same "note"
    // the setter attached, folded straight into the notification message.
    const [setterProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [setterId],
    );
    const setterName =
      setterProfile.length > 0
        ? `${setterProfile[0].first_name} ${setterProfile[0].last_name}`
        : "Your supervisor";

    const locationDescription = address ? ` at ${address}` : "";

    const notifMessage = label
      ? `${setterName} has set your DTR check-in location${locationDescription} with a ${radiusMeters}m radius.\nNote: "${label}"`
      : `${setterName} has set your DTR check-in location${locationDescription} with a ${radiusMeters}m radius.`;

    // This DTR-location notification stores the internship UUID in link_uuid.
    // Other notification types may retain different legacy link contracts.
    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        internship.user_id,
        setterId,
        "dtr_location_set",
        "DTR Location Set",
        notifMessage,
        internshipId,
      ],
    );

    // The accepted supervisor also needs to know when school staff changes
    // the location used to validate their intern's attendance.
    const supervisorId =
      (role === "admin" || role === "department_head") &&
      internship.employer_id &&
      internship.employer_id !== setterId
        ? internship.employer_id
        : null;
    let supervisorMessage;
    if (supervisorId) {
      const studentName =
        [internship.student_first_name, internship.student_last_name]
          .filter(Boolean)
          .join(" ") || "your intern";
      supervisorMessage = label
        ? `${setterName} has set ${studentName}'s DTR check-in location${locationDescription} with a ${radiusMeters}m radius.\nNote: "${label}"`
        : `${setterName} has set ${studentName}'s DTR check-in location${locationDescription} with a ${radiusMeters}m radius.`;

      await connection.execute(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          supervisorId,
          setterId,
          "dtr_location_set",
          "Intern DTR Location Set",
          supervisorMessage,
          internshipId,
        ],
      );
    }

    await connection.commit();
    invalidateNotificationsCache();

    const io = req.app.get("socketio");
    io.to(`user-${internship.user_id}`).emit("new_notification", {
      title: "DTR Location Set",
      message: notifMessage,
      type: "dtr_location_set",
      link_uuid: internshipId,
    });
    if (supervisorId) {
      io.to(`user-${supervisorId}`).emit("new_notification", {
        title: "Intern DTR Location Set",
        message: supervisorMessage,
        type: "dtr_location_set",
        link_uuid: internshipId,
      });
    }

    res.status(200).json({
      message: "DTR location set successfully.",
      success: true,
      dtrLocation: {
        id: dtrLocationId,
        internship_id: internshipId,
        set_by: setterId,
        lat: latNum,
        lon: lonNum,
        radius_meters: radiusMeters,
        label: label ?? null,
        address: address ?? null,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Set DTR location error:", error);
    res.status(500).json({
      error: "Server error while setting DTR location.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Remove the saved override from a locked, owned live ongoing internship.
// Employer assignment is checked here; department-head scope is enforced
// by route middleware. Return company coordinates and 150 m without altering the company site.
export const removeSearchedStudentDtrLocation = async (req, res) => {
  const { searchedUserId } = req.params;
  const { internshipId } = req.query;
  const { id: setterId, role } = req.verifiedUser;
  if (!searchedUserId || !internshipId) {
    return res
      .status(400)
      .json({ error: "Student and internship are required." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [records] = await connection.execute(
      "SELECT id, employer_id, lat, lon FROM internship_records WHERE id = ? AND user_id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [internshipId, searchedUserId],
    );
    if (!records.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "No ongoing internship found for this student." });
    }
    if (role === "employer" && records[0].employer_id !== setterId) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "Only this student's accepted supervisor can remove the DTR location.",
      });
    }
    await connection.execute(
      "DELETE FROM dtr_locations WHERE internship_id = ?",
      [internshipId],
    );
    await connection.commit();
    return res.json({
      success: true,
      dtrLocation: {
        internship_id: internshipId,
        lat: records[0].lat,
        lon: records[0].lon,
        radius_meters: 150,
        label: "Company address (default)",
        address: null,
        updated_at: null,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Remove DTR location error:", error);
    return res.status(500).json({ error: "Failed to remove DTR location." });
  } finally {
    connection?.release();
  }
};

