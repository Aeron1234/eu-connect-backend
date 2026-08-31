import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { ALLOWED_TYPES, UPLOAD_ROOT } from "../config/helpers.js";

const BUCKET = process.env.SUPABASE_BUCKET;

export const getSearchedUser = async (req, res) => {
  const { searchedUserId } = req.params;

  if (!searchedUserId) {
    return res.status(400).json({
      success: false,
      error: "User ID parameter is required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const query = `
      SELECT 
        u.id AS user_id, 
        up.first_name, 
        up.last_name, 
        r.role AS role_name,
        c.course_name AS course, 
        d.name AS department_name,
        CASE 
          WHEN r.role = 'student' THEN ir.company_name
          WHEN r.role = 'employer' THEN ebi.company_name
          ELSE NULL
        END AS company_name,
        IFNULL(ir.accumulated_hours, 0) AS hours_rendered,
        IFNULL(ir.total_hours, 0) AS total_hours
      FROM users u
      INNER JOIN user_profiles up ON u.id = up.user_id 
      INNER JOIN roles r ON u.role_id = r.id
      LEFT JOIN student_academic_info sai ON u.id = sai.user_id
      LEFT JOIN courses c ON sai.course_id = c.id
      LEFT JOIN departments d ON sai.department_id = d.id
      LEFT JOIN internship_records ir ON u.id = ir.user_id AND ir.status = 'ongoing'
      LEFT JOIN employer_background_info ebi ON u.id = ebi.user_id
      WHERE u.id = ? AND u.deleted_at IS NULL
      LIMIT 1;
    `;

    const [rows] = await connection.execute(query, [searchedUserId]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Target profile does not exist",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role_name.toLowerCase(),
        course: user.course,
        department: user.department_name,
        company_name: user.company_name,
        hours_rendered: Number(user.hours_rendered),
        total_hours: Number(user.total_hours),
      },
    });
  } catch (error) {
    console.error("Database failure inside getSearchedUser endpoint:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server registry failure",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getSearchedStudentDTRs = async (req, res) => {
  // 🛡️ GUARD CLAUSE: Validate searched user route parameter
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  // Parse pagination limits safely
  const limit = parseInt(req.query.limit) || 5;
  const offset = parseInt(req.query.offset) || 0;

  let connection;
  try {
    // 🌟 Acquire explicit pool connection
    connection = await db.getConnection();

    // Query 1: Fetch only the specific columns needed for the UI layout (excluding lats/lons)
    const dtrQuery = `
      SELECT 
        dtr.id,
        dtr.created_at,
        dtr.internship_id,
        dtr.total_hours,
        dtr.clock_in,
        dtr.clock_out,
        dtr.user_id,
        dtr.status
      FROM daily_time_records dtr
      INNER JOIN internship_records ir 
         ON dtr.internship_id = ir.id
      WHERE dtr.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
      ORDER BY dtr.created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Query 2: Fetch total row counts for dynamic pagination calculations
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM daily_time_records dtr
      INNER JOIN internship_records ir 
         ON dtr.internship_id = ir.id
      WHERE dtr.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
    `;

    // Execute queries using the allocated connection thread
    const [rows] = await connection.execute(dtrQuery, [
      searchedUserId,
      limit,
      offset,
    ]);
    const [countResult] = await connection.execute(countQuery, [
      searchedUserId,
    ]);

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      dtrs: rows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
    });
  } catch (error) {
    console.error("Get searched user DTRs query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get DTR logs.",
    });
  } finally {
    // 🌟 Ensure pool connection thread is always released back to pool safely
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
         dl.label,
         dl.created_at AS dtr_created_at,
         dl.updated_at AS dtr_updated_at
       FROM internship_records AS ir
       LEFT JOIN dtr_locations AS dl ON ir.id = dl.internship_id
       WHERE ir.user_id = ? AND ir.status = 'ongoing'
       LIMIT 1`,
      [studentId],
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
        set_by: isCustom ? record.set_by : null,
        created_at: isCustom ? record.dtr_created_at : null,
        updated_at: isCustom ? record.dtr_updated_at : null,
      },
    });
  } catch (error) {
    console.error("Get DTR location error:", error);
    res.status(500).json({ error: "Database query failed.", success: false });
  }
};

export const setSearchedStudentDtrLocation = async (req, res) => {
  const { searchedUserId } = req.params;
  const { internshipId } = req.query;
  const { id: setterId, role } = req.verifiedUser;
  const { lat, lon, radius_meter, label, address } = req.body;

  let connection;
  try {
    // Fixed: this used to run before checking whether label was even
    // provided — label is optional everywhere else in this function
    // (label ?? null), so an omitted label crashed here with
    // "Cannot read properties of undefined (reading 'length')".
    if (label && label.length > 1000) {
      return res.status(400).json({ error: "Label is too long." });
    }

    if (address && address.length > 255) {
      return res.status(400).json({ error: "Address is too long." });
    }

    // 1. Validate required params/body
    if (!searchedUserId) {
      return res.status(400).json({ error: "searchedUserId is required." });
    }

    if (!internshipId) {
      return res
        .status(400)
        .json({ error: "internshipId is required as a query parameter." });
    }

    if (
      lat === undefined ||
      lat === null ||
      lon === undefined ||
      lon === null
    ) {
      return res
        .status(400)
        .json({ error: "lat and lon are required to set a DTR location." });
    }

    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return res
        .status(400)
        .json({ error: "lat and lon must be valid numbers." });
    }

    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return res
        .status(400)
        .json({ error: "lat/lon values are out of range." });
    }

    // radius_meter is optional; fall back to a sane default if not provided
    const radiusMeters =
      radius_meter === undefined || radius_meter === null
        ? 150
        : Number(radius_meter);

    if (Number.isNaN(radiusMeters) || radiusMeters <= 0) {
      return res
        .status(400)
        .json({ error: "radius_meter must be a positive number." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 2. Verify the internship exists AND actually belongs to the searched student
    const [internships] = await connection.execute(
      `SELECT id, user_id, employer_id 
       FROM internship_records 
       WHERE id = ? AND user_id = ? 
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

    // Only this internship's accepted supervisor can set its DTR location —
    // an employer who hasn't been accepted as supervisor is blocked here.
    // Staff (admin/department_head) are unaffected by this check.
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

    // internshipId is a char(36) UUID (internship_records.id) — goes under
    // link_uuid, matching the convention used for every other internship-
    // record-related notification (link is reserved for int/auto-increment
    // ids, like announcements).
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

    await connection.commit();

    const io = req.app.get("socketio");
    io.to(`user-${internship.user_id}`).emit("new_notification", {
      title: "DTR Location Set",
      message: notifMessage,
      type: "dtr_location_set",
      link_uuid: internshipId,
    });

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
    console.error("Set DTR location error:", error);
    res.status(500).json({
      error: "Server error while setting DTR location.",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getSearchedStudentNarratives = async (req, res) => {
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  // 🌟 PAGE-BASED PAGINATION (Matches getAllNarratives implementation)
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  let connection;
  try {
    connection = await db.getConnection();

    // Query 1: Fetch paginated narratives for the student's ongoing internship
    const narrativesQuery = `
      SELECT 
        dn.id,
        dn.user_id,
        dn.internship_id,
        dn.day_number,
        dn.title,
        dn.narrative,
        dn.created_at,
        dn.updated_at
      FROM daily_narratives dn
      INNER JOIN internship_records ir 
         ON dn.internship_id = ir.id
      WHERE dn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
      ORDER BY dn.day_number DESC, dn.created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Query 2: Total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM daily_narratives dn
      INNER JOIN internship_records ir 
         ON dn.internship_id = ir.id
      WHERE dn.user_id = ? 
        AND ir.status = 'ongoing'
        AND ir.deleted_at IS NULL
    `;

    // Execute queries in parallel using the allocated connection thread
    const [[narratives], [countResult]] = await Promise.all([
      connection.execute(narrativesQuery, [searchedUserId, limit, offset]),
      connection.execute(countQuery, [searchedUserId]),
    ]);

    const totalRecords = Number(countResult[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      narratives,
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    console.error("Get searched user narratives query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get daily narrative logs.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getSearchedStudentFiles = async (req, res) => {
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // 1. Get every internship record for this student — this is the
    // top-level grouping, since a student may have 1 or several.
    // Ongoing internship (if any) always sorts first; the rest fall
    // into "past records" ordered by most recently started.
    const [internships] = await connection.execute(
      `SELECT 
         ir.id, ir.company_name, ir.internship_position,
         ir.date_started, ir.date_ended, ir.status
       FROM internship_records ir
       INNER JOIN users u ON ir.user_id = u.id
       WHERE ir.user_id = ? AND u.deleted_at IS NULL AND ir.deleted_at IS NULL
       ORDER BY 
         (ir.status = 'ongoing') DESC,
         ir.date_started DESC`,
      [searchedUserId],
    );

    if (internships.length === 0) {
      return res.status(200).json([]);
    }

    // 2. Get every document belonging to this student, across all
    // their internships, in one query — cheaper than N queries per record.
    // Files uploaded directly by the student have no verification_status
    // (NULL) and always show. Files uploaded by an employer only show once
    // the student has accepted them — a 'pending' one shouldn't count
    // toward requirements or appear anywhere until confirmed.
    const [documents] = await connection.execute(
      `SELECT 
         doc.id, doc.internship_id, doc.file_name, doc.company_name,
         doc.category, doc.requirement_type_id, doc.file_type, doc.created_at,
         doc.uploaded_by_id, doc.uploaded_by_role, doc.verification_status,
         rt.name AS requirement_name, rt.requires_notarization, rt.copies_needed
       FROM internship_documents doc
       LEFT JOIN requirement_types rt ON doc.requirement_type_id = rt.id
       WHERE doc.user_id = ?
         AND (doc.verification_status IS NULL OR doc.verification_status = 'accepted')
       ORDER BY doc.created_at DESC`,
      [searchedUserId],
    );

    // 3. Total requirement count, for the completion percentage denominator
    const [[{ totalRequirements }]] = await connection.execute(
      `SELECT COUNT(*) AS totalRequirements FROM requirement_types`,
    );

    // 4. Attach each internship's own files + completion stats
    const records = internships.map((internship) => {
      const files = documents.filter(
        (doc) => doc.internship_id === internship.id,
      );

      const submittedCount = new Set(files.map((f) => f.requirement_type_id))
        .size;

      return {
        ...internship,
        totalRequirements,
        submittedCount,
        completionPercent:
          totalRequirements > 0
            ? Math.round((submittedCount / totalRequirements) * 100)
            : 0,
        files,
      };
    });

    return res.status(200).json(records);
  } catch (error) {
    console.error("Get searched student files query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get student files.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const downloadSearchedStudentInternshipFile = async (req, res) => {
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { searchedUserId, fileId } = req.params;

    if (!searchedUserId || !fileId) {
      return res
        .status(400)
        .json({ error: "searchedUserId and fileId are required." });
    }

    const [rows] = await db.execute(
      `SELECT user_id, path, file_name, file_type, uploaded_by_id FROM internship_documents WHERE id = ?`,
      [fileId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "File not found." });
    }

    const doc = rows[0];

    // Confirm the file actually belongs to the student named in the route —
    // never trust fileId alone, or an authorized staff member could pull
    // a file by guessing/reusing an id that belongs to a different student
    if (doc.user_id !== searchedUserId) {
      // 404 rather than 403 — don't reveal that a file with this id
      // exists under a *different* student
      return res.status(404).json({ error: "File not found." });
    }

    // Employers can only download files they personally uploaded —
    // admins/department heads are not restricted this way
    if (role === "employer" && doc.uploaded_by_id !== requesterId) {
      return res.status(403).json({
        error: "You can only download files you uploaded yourself.",
      });
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.path, 120);

    if (error) {
      console.error("Signed URL error:", error.message);
      return res.status(404).json({ error: "File not found on server." });
    }

    return res.status(200).json({
      url: data.signedUrl,
      fileName: doc.file_name,
    });
  } catch (error) {
    console.error("Download Error:", error.message);
    res.status(500).json({ error: "Failed to retrieve file." });
  }
};

export const getEmployerUploadedFiles = async (req, res) => {
  try {
    const { id: employerId } = req.verifiedUser;
    const { searchedUserId } = req.params;

    if (!searchedUserId) {
      return res
        .status(400)
        .json({ error: "Searched User ID parameter is required." });
    }

    const [rows] = await db.execute(
      `SELECT 
         doc.id, doc.internship_id, doc.file_name, doc.company_name,
         doc.category, doc.requirement_type_id, doc.file_type, doc.created_at,
         doc.uploaded_by_id, doc.uploaded_by_role, doc.verification_status,
         rt.name AS requirement_name
       FROM internship_documents doc
       LEFT JOIN requirement_types rt ON doc.requirement_type_id = rt.id
       WHERE doc.user_id = ? 
         AND doc.uploaded_by_id = ? 
         AND doc.uploaded_by_role = 'employer'
       ORDER BY doc.created_at DESC`,
      [searchedUserId, employerId],
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Get employer uploaded file error:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get uploaded files.",
    });
  }
};

export const uploadFileToSearchedStudent = async (req, res) => {
  const CERTIFICATE_OF_COMPLETION_NAME = "Certificate of Completion";

  let connection;
  let uploadedStoragePath;
  try {
    const { id: employerId, role } = req.verifiedUser;
    const { searchedUserId } = req.params;
    const { file_name, company_name } = req.body;
    const file = req.file;

    if (!searchedUserId) {
      return res.status(400).json({ error: "searchedUserId is required." });
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type." });
    }

    if (file.size > 50 * 1024 * 1024) {
      return res.status(400).json({ error: "File is too large (Max 50MB)." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Confirm the target student has an ONGOING internship
    const [internships] = await connection.execute(
      `SELECT id, employer_id FROM internship_records WHERE user_id = ? AND status = 'ongoing' LIMIT 1 FOR UPDATE`,
      [searchedUserId],
    );

    if (internships.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "This student does not have an ongoing internship.",
      });
    }

    const internship = internships[0];

    // Only the accepted supervisor for this internship can upload on the
    // student's behalf — a request must have been sent and accepted first
    if (internship.employer_id !== employerId) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "Only this student's accepted supervisor can upload files on their behalf.",
      });
    }

    // 2. This endpoint only ever files a Certificate of Completion — the
    // requirement type is looked up server-side, never trusted from the
    // client, so an employer can't submit a file against an arbitrary
    // requirement type via this route
    const [reqTypes] = await connection.execute(
      `SELECT id, category FROM requirement_types WHERE name = ? LIMIT 1`,
      [CERTIFICATE_OF_COMPLETION_NAME],
    );

    if (reqTypes.length === 0) {
      await connection.rollback();
      console.error(
        `"${CERTIFICATE_OF_COMPLETION_NAME}" requirement type not found in requirement_types table.`,
      );
      return res.status(500).json({
        error: "Certificate of Completion requirement type is not configured.",
      });
    }

    const { id: requirementTypeId, category: catLower } = reqTypes[0];

    // Sender name for the notification sent to the student
    const [employerProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [employerId],
    );

    if (employerProfile.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Employer profile not found." });
    }

    const employerName = `${employerProfile[0].first_name} ${employerProfile[0].last_name}`;

    // 3. Upload to Supabase Storage — stored under the STUDENT's folder,
    // not the employer's, so it lands in the same place student-uploaded
    // files do and is reachable by the existing download/delete routes
    const fileExt = file.originalname.split(".").pop();
    uploadedStoragePath = `requirements/${searchedUserId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedStoragePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) throw uploadError;

    // 4. Save to DB — file belongs to the student (user_id), but track who
    // actually submitted it (uploaded_by_id / uploaded_by_role). Starts as
    // 'pending' — it doesn't count toward requirements or appear in the
    // student's file list until they accept it via reviewEmployerCertificate.
    const [result] = await connection.execute(
      `INSERT INTO internship_documents 
        (user_id, internship_id, file_name, company_name, category, requirement_type_id, file_type, path, uploaded_by_id, uploaded_by_role, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        searchedUserId,
        internship.id,
        file_name || CERTIFICATE_OF_COMPLETION_NAME,
        company_name,
        catLower,
        requirementTypeId,
        file.mimetype,
        uploadedStoragePath,
        employerId,
        role,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      await supabase.storage.from(BUCKET).remove([uploadedStoragePath]);
      return res.status(400).json({ error: "Uploading file failed." });
    }

    // 5. Notify the student — this file is pending their review before it
    // counts toward requirements (see reviewEmployerCertificate)
    const notifTitle = "Certificate Uploaded";
    const notifMessage = `${employerName} uploaded a Certificate of Completion on your behalf. Please review it to confirm.`;

    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, link) VALUES (?, ?, 'certificate_uploaded', ?, ?, ?)`,
      [searchedUserId, employerId, notifTitle, notifMessage, result.insertId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual upload. This one has real audit
    // value: an employer is filing a document on a student's behalf, and
    // it's still pending the student's own confirmation.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          employerId,
          role,
          "internship_document_uploaded_on_behalf",
          "internship_documents",
          String(result.insertId),
          `${employerName} uploaded a Certificate of Completion on behalf of student ${searchedUserId}, pending their confirmation.`,
          JSON.stringify({
            student_id: searchedUserId,
            internship_id: internship.id,
            company_name,
            file_name: file_name || CERTIFICATE_OF_COMPLETION_NAME,
            verification_status: "pending",
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (document uploaded on behalf):",
        logError,
      );
    }

    await connection.commit();

    const io = req.app.get("socketio");
    if (io) {
      io.to(`user-${searchedUserId}`).emit("new_notification", {
        title: notifTitle,
        message: notifMessage,
        type: "certificate_uploaded",
        link: result.insertId,
      });
    }

    return res.status(201).json({
      message: "Document uploaded successfully on behalf of the student.",
      success: true,
      id: result.insertId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (uploadedStoragePath) {
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedStoragePath])
        .catch(() => {});
    }
    console.error("Upload to searched user error:", error.message);
    return res.status(500).json({ error: "Server failed to process upload." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteSearchedStudentFile = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { searchedUserId, fileId } = req.params;

    if (!searchedUserId || !fileId) {
      return res
        .status(400)
        .json({ error: "searchedUserId and fileId are required." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Look up the record, and confirm it actually belongs to the student
    // named in the route — never trust fileId alone, or a caller could
    // delete an arbitrary file by guessing/reusing an id from another student
    const [rows] = await connection.execute(
      `SELECT id, user_id, path, uploaded_by_id, verification_status FROM internship_documents WHERE id = ? FOR UPDATE`,
      [fileId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "File not found." });
    }

    const doc = rows[0];

    if (doc.user_id !== searchedUserId) {
      await connection.rollback();
      // 404 rather than 403 here — don't reveal that a file with this id
      // exists under a *different* student
      return res.status(404).json({ error: "File not found." });
    }

    // Employers can only delete files they personally uploaded on a
    // student's behalf — admins/department heads are not restricted this way
    if (role === "employer" && doc.uploaded_by_id !== requesterId) {
      await connection.rollback();
      return res.status(403).json({
        error: "You can only delete files you uploaded yourself.",
      });
    }

    if (role === "employer" && doc.verification_status === "accepted") {
      await connection.rollback();
      return res.status(403).json({
        error:
          "This certificate has already been confirmed by the student and can no longer be deleted.",
      });
    }

    const [result] = await connection.execute(
      `DELETE FROM internship_documents WHERE id = ?`,
      [fileId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "File not found." });
    }

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual deletion.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          requesterId,
          role,
          "internship_document_deleted",
          "internship_documents",
          String(fileId),
          `${role === "employer" ? "Employer" : role} deleted document ${fileId} belonging to student ${searchedUserId}.`,
          JSON.stringify({
            document_owner_id: searchedUserId,
            uploaded_by_id: doc.uploaded_by_id,
            verification_status: doc.verification_status,
            path: doc.path,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (searched student document deleted):",
        logError,
      );
    }

    await connection.commit();

    // Delete from storage AFTER commit succeeds — same reasoning as deleteFile:
    // DB is source of truth, an orphaned storage object is recoverable,
    // an orphaned DB row isn't
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([doc.path]);

    if (storageError) {
      console.error("Failed to delete from storage:", storageError.message);
    }

    res.status(200).json({
      message: "File deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete searched student file error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
