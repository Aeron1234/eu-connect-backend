import { db } from "../config/db.js";

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
  // 🛡️ GUARD CLAUSE: Validate searched user route parameter
  const { searchedUserId } = req.params;
  if (!searchedUserId) {
    return res
      .status(400)
      .json({ error: "Searched User ID parameter is required." });
  }

  let connection;
  try {
    // 🌟 Acquire explicit pool connection
    connection = await db.getConnection();

    // Fetch the files while confirming the target user exists and isn't soft-deleted
    const query = `
      SELECT 
        id.id,
        id.user_id,
        id.file_name,
        id.company_name,
        id.category,
        id.url,
        id.path,
        id.file_type,
        id.created_at
      FROM internship_documents id
      INNER JOIN users u ON id.user_id = u.id
      WHERE id.user_id = ? AND u.deleted_at IS NULL
      ORDER BY id.created_at DESC
    `;

    const [rows] = await connection.execute(query, [searchedUserId]);

    // Format the response structure to match the frontend expectations
    const records = rows.length > 0 ? rows : null;

    return res.status(200).json(records);
  } catch (error) {
    console.error("Get searched student files query failure:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get student files.",
    });
  } finally {
    // 🌟 Ensure pool connection thread is safely released back to the pool
    if (connection) connection.release();
  }
};

export const getSearchedStudentDtrLocation = async (req, res) => {
  try {
    const { searchedUserId } = req.params;

    if (!searchedUserId) {
      return res.status(400).json({ error: "searchedUserId is required." });
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
      [searchedUserId],
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
  const { id: setterId } = req.verifiedUser;
  const { lat, lon, radius_meter, label } = req.body;

  let connection;
  try {
    if (label.length > 1000) {
      return res.status(400).json({ error: "Label is too long." });
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
      `SELECT id, user_id 
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
         SET set_by = ?, lat = ?, lon = ?, radius_meters = ?, label = ?, updated_at = NOW()
         WHERE id = ?`,
        [setterId, latNum, lonNum, radiusMeters, label ?? null, dtrLocationId],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        throw new Error("Failed to update DTR location.");
      }
    } else {
      // 4b. Insert new custom location
      const [insertResult] = await connection.execute(
        `INSERT INTO dtr_locations 
         (internship_id, set_by, lat, lon, radius_meters, label, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [internshipId, setterId, latNum, lonNum, radiusMeters, label ?? null],
      );

      if (insertResult.affectedRows === 0) {
        await connection.rollback();
        throw new Error("Failed to insert DTR location.");
      }

      dtrLocationId = insertResult.insertId;
    }

    await connection.commit();

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
