import { db } from "../config/db.js";
import { newUUID, verifyRecordAccess } from "../config/helpers.js";
import { supabase } from "../config/supabase.js";

export const getRegions = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM regions`);

    const record = rows.length > 0 ? rows : [];

    res.status(200).json(record);
  } catch (error) {
    console.error("Get all regions error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getActiveInternship = async (req, res) => {
  try {
    const { id } = req.verifiedUser;

    const [rows] = await db.execute(
      `SELECT * FROM internship_records
       WHERE user_id = ? AND (status = "ongoing" OR status = "pending")
       LIMIT 1`,
      [id],
    );

    const record = rows.length > 0 ? rows[0] : null;

    res.status(200).json(record);
  } catch (error) {
    console.error("Get active internship error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllActiveInternships = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT ir.id, ir.user_id, ir.company_name, ir.company_address, ir.lon, ir.lat, up.first_name, up.last_name, c.course_name, r.short_name
        FROM internship_records AS ir
       INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
       INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses AS c ON sai.course_id = c.id
       INNER JOIN regions AS r ON ir.region_id = r.id
       WHERE ir.status = "ongoing"
       `,
    );

    const records = rows.length > 0 ? rows : [];

    res.status(200).json(records);
  } catch (error) {
    console.error("Get all active internships error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllUserInternships = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { role } = req.verifiedUser;

    if (role === "student") {
      const [rows] = await db.execute(
        `SELECT ir.id, ir.created_at, ir.company_name, ir.company_address, ir.internship_position, ir.company_website, ir.description, ir.status, ir.internship_position, ir.description, ir.date_started, ir.date_ended, ir.total_hours, up.first_name, up.last_name, c.course_name, r.short_name
        FROM internship_records AS ir
       INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
       INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses AS c ON sai.course_id = c.id
       INNER JOIN regions AS r ON ir.region_id = r.id
       WHERE ir.user_id = ?
       ORDER BY ir.created_at DESC
       `,
        [userId],
      );

      const records = rows.length > 0 ? rows : [];

      res.status(200).json(records);
    }

    if (role === "department_head" || role === "admin") {
      const [rows] = await db.execute(
        `SELECT ir.id, ir.user_id, ir.created_at, ir.company_name, ir.company_address, ir.internship_position, ir.company_website, ir.description, ir.status, ir.internship_position, ir.description, ir.date_started, ir.date_ended, ir.total_hours, ir.lat, ir.lon, up.first_name, up.last_name, c.course_name, r.short_name AS region_name
        FROM internship_records AS ir
       INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
       INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses AS c ON sai.course_id = c.id
       INNER JOIN regions AS r ON ir.region_id = r.id
       ORDER BY ir.created_at DESC
       `,
      );

      const records = rows.length > 0 ? rows : [];

      res.status(200).json(records);
    }
  } catch (error) {
    console.error("Get all user internships error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const createInternshipRecord = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id: userId, role, department_id } = req.verifiedUser;
    const data = req.body;

    if (role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can create internship records." });
    }

    if (!department_id) {
      return res.status(400).json({
        error: "Academic profile incomplete. Please set your department first.",
      });
    }

    const requiredFields = [
      "company_name",
      "company_address",
      "internship_position",
      "description",
      "date_started",
      "total_hours",
      "lon",
      "lat",
      "region_id",
      "semester",
    ];

    for (const field of requiredFields) {
      const value = data[field];
      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
      ) {
        return res.status(400).json({
          error: `${field.replace(/_/g, " ")} is required for the map.`,
        });
      }
    }

    if (!["1st", "2nd", "summer"].includes(data.semester)) {
      return res
        .status(400)
        .json({ error: "semester must be '1st', '2nd', or 'summer'." });
    }

    const [studentProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [userId],
    );

    const studentName =
      studentProfile.length > 0
        ? `${studentProfile[0].first_name} ${studentProfile[0].last_name}`
        : "A Student";

    await connection.beginTransaction();

    const DEPARTMENT_HEAD = 3;
    const ADMIN = 4;
    const newId = newUUID();

    const [recipients] = await connection.execute(
      `
      SELECT DISTINCT u.id, up.first_name, up.last_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      LEFT JOIN dept_heads_background_info AS dhbi ON u.id = dhbi.user_id
      WHERE 
        (u.role_id = ? AND dhbi.department_id = ?)
        OR 
        (u.role_id = ?)
      `,
      [DEPARTMENT_HEAD, department_id, ADMIN],
    );

    const [result] = await connection.execute(
      `
      INSERT INTO internship_records (id, user_id, company_name, company_address, internship_position, description, lon, lat, date_started, total_hours, region_id, company_website, semester)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM internship_records WHERE user_id = ? AND status = 'ongoing'
      )
      `,
      [
        newId,
        userId,
        data.company_name,
        data.company_address,
        data.internship_position,
        data.description,
        data.lon,
        data.lat,
        data.date_started,
        Number(data.total_hours),
        data.region_id,
        data.company_website || null,
        data.semester,
        userId,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({
        error: "You already have an ongoing internship record.",
      });
    }

    const values = recipients.map((recipient) => [
      recipient.id,
      userId,
      "submission",
      "New Internship Request",
      `New request from ${studentName}`,
      newId,
    ]);

    if (values.length > 0) {
      await connection.query(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES ?`,
        [values],
      );
    }

    await connection.commit();

    const io = req.app.get("socketio");

    recipients.forEach((admin) => {
      io.to(`user-${admin.id}`).emit("new_notification", {
        title: "New Internship Request",
        message: "A new record is pending for your approval.",
        type: "submission",
        link: newId,
      });
    });

    res.status(201).json({
      message: "Success! Wait for the approval from your Department Head.",
      success: true,
    });
  } catch (error) {
    console.error(error);
    if (connection) await connection.rollback();
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const approveInternshipRecord = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id: userId, role } = req.verifiedUser;
    const { internshipId } = req.params;
    const { status } = req.body;

    if (!internshipId || !status) {
      return res.status(400).json({
        error: "Internship ID and status are required",
      });
    }

    if (!["ongoing", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value." });
    }

    if (!["department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied." });
    }

    await connection.beginTransaction();

    const [personInCharge] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [userId],
    );

    if (personInCharge.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Unauthorized user." });
    }

    const personInChargeName = `${personInCharge[0].first_name} ${personInCharge[0].last_name}`;

    // Combine the recipient + status + department lookups into one locked read
    const [recordRows] = await connection.execute(
      `SELECT ir.user_id, ir.company_name, ir.status, sai.department_id
       FROM internship_records ir
       INNER JOIN (
         SELECT sai1.*
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       WHERE ir.id = ? FOR UPDATE`,
      [internshipId],
    );

    if (recordRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const {
      user_id: studentId,
      company_name,
      status: currentStatus,
      department_id: recordDeptId,
    } = recordRows[0];

    // Department heads can only act on records within their own department
    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      if (
        deptHeadRows.length === 0 ||
        deptHeadRows[0].department_id !== recordDeptId
      ) {
        await connection.rollback();
        return res.status(403).json({
          error: "You can only manage records within your own department.",
        });
      }
    }

    if (currentStatus !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        error: "This record has already been processed.",
      });
    }

    const [result] = await connection.execute(
      `UPDATE internship_records SET updated_at = NOW(), status = ? WHERE id = ?`,
      [status, internshipId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "Failed to update or can't find the internship record. Please try again.",
      });
    }

    await connection.execute(
      `UPDATE notifications 
      SET is_read = 1 
      WHERE link = ? AND type = 'submission' AND user_id = ?`,
      [internshipId, userId],
    );

    const notifMessage =
      status === "ongoing"
        ? `Your internship at ${company_name} has been approved by ${personInChargeName}!`
        : `Your internship request for ${company_name} was rejected by ${personInChargeName}.`;
    const notifType = status === "ongoing" ? "approved" : "rejected";
    const notifTitle = `Internship Record ${notifType.charAt(0).toUpperCase() + notifType.slice(1)}`;

    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, message, title, link) VALUES (?, ?, ?, ?, ?, ?)`,
      [studentId, userId, notifType, notifMessage, notifTitle, internshipId],
    );

    await connection.commit();

    const io = req.app.get("socketio");
    io.to(`user-${studentId}`).emit("new_notification", {
      title: notifTitle,
      message: notifMessage,
      type: notifType,
      link: internshipId,
    });

    res.status(200).json({
      success: true,
      message: "Status updated and student notified!",
    });
  } catch (error) {
    console.error("Approve internship record error: ", error);
    if (connection) await connection.rollback();
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const markInternshipFinished = async (req, res) => {
  let connection;
  try {
    const { id: userId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    if (!["department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [recordRows] = await connection.execute(
      `SELECT ir.user_id, ir.company_name, ir.company_address, ir.industry, ir.internship_position, ir.status,
              ir.total_hours, ir.accumulated_hours, ir.date_started, ir.academic_year,
              sai.department_id, sai.course_id
       FROM internship_records_with_ay ir
       INNER JOIN (
         SELECT sai1.*
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       WHERE ir.id = ? FOR UPDATE`,
      [internshipId],
    );

    if (recordRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const {
      user_id: studentId,
      company_name,
      company_address: companyAddress,
      industry,
      internship_position: internshipPosition,
      status: currentStatus,
      department_id: recordDeptId,
      course_id: courseId,
      total_hours: totalHours,
      accumulated_hours: accumulatedHours,
      date_started: dateStarted,
      academic_year: academicYear,
    } = recordRows[0];

    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      if (
        deptHeadRows.length === 0 ||
        deptHeadRows[0].department_id !== recordDeptId
      ) {
        await connection.rollback();
        return res.status(403).json({
          error: "You can only manage records within your own department.",
        });
      }
    }

    if (currentStatus !== "ongoing") {
      await connection.rollback();
      return res.status(400).json({
        error: "Only an ongoing record can be marked as finished.",
      });
    }

    await connection.execute(
      `UPDATE internship_records 
       SET status = 'finished', date_ended = COALESCE(date_ended, CURDATE()), updated_at = NOW() 
       WHERE id = ?`,
      [internshipId],
    );

    const [personInCharge] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [userId],
    );
    const personInChargeName =
      personInCharge.length > 0
        ? `${personInCharge[0].first_name} ${personInCharge[0].last_name}`
        : "Your department head";

    const [studentProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [studentId],
    );
    const alumniName =
      studentProfile.length > 0
        ? `${studentProfile[0].first_name} ${studentProfile[0].last_name}`
        : null;

    // batch_year isn't a tracked field anywhere in the schema — derived from the
    // internship's start year as a stand-in. Confirm this matches what "batch year"
    // is meant to represent before relying on it downstream.
    const batchYear = dateStarted
      ? new Date(dateStarted).getFullYear().toString()
      : null;

    try {
      await connection.execute(
        `INSERT INTO alumni_internship_records
          (id, entered_by, alumni_name, company_name, company_address, industry,
           internship_position, course_id, batch_year, academic_year,
           total_hours, accumulated_hours, supervisor_name, notes,
           internship_record_id, source, department_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'system', ?)`,
        [
          newUUID(),
          userId,
          alumniName,
          company_name,
          companyAddress,
          industry,
          internshipPosition,
          courseId,
          batchYear,
          academicYear,
          totalHours,
          accumulatedHours,
          internshipId,
          recordDeptId,
        ],
      );
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }

    const notifMessage = `Your internship at ${company_name} has been marked finished by ${personInChargeName}. Congratulations!`;

    await connection.execute(
      `INSERT INTO notifications (user_id, sender_id, type, message, title, link) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        userId,
        "approved",
        notifMessage,
        "Internship Finished",
        internshipId,
      ],
    );

    await connection.commit();

    const io = req.app.get("socketio");
    io.to(`user-${studentId}`).emit("new_notification", {
      title: "Internship Finished",
      message: notifMessage,
      type: "approved",
      link: internshipId,
    });

    res
      .status(200)
      .json({ success: true, message: "Record marked as finished." });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Mark internship finished error:", error);
    res.status(500).json({ error: "Failed to mark record as finished." });
  } finally {
    if (connection) connection.release();
  }
};

export const finishInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { id: userId } = req.verifiedUser;
    const internshipId = req.params.internshipId;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `
      UPDATE internship_records
      SET 
        date_ended = CURRENT_DATE(),
        status = 'finished'
      WHERE user_id = ? 
        AND id = ? 
        AND accumulated_hours >= total_hours
        AND status = 'ongoing'
      `,
      [userId, internshipId],
    );

    if (result.affectedRows === 0) {
      const [record] = await connection.execute(
        `SELECT accumulated_hours, total_hours FROM internship_records WHERE id = ?`,
        [internshipId],
      );

      await connection.rollback();

      if (record.length > 0) {
        const { accumulated_hours, total_hours } = record[0];
        if (accumulated_hours < total_hours) {
          const remaining = (total_hours - accumulated_hours).toFixed(2);
          return res.status(400).json({
            error: `You cannot finish yet. You still need ${remaining} more hours!`,
          });
        }
      }

      return res.status(404).json({
        error: "Internship record not found or already finished.",
      });
    }

    const [recordRows] = await connection.execute(
      `SELECT company_name, company_address, industry, internship_position, total_hours, accumulated_hours, date_started, academic_year
       FROM internship_records_with_ay WHERE id = ?`,
      [internshipId],
    );
    const {
      company_name,
      company_address: companyAddress,
      industry,
      internship_position: internshipPosition,
      total_hours,
      accumulated_hours,
      date_started: dateStarted,
      academic_year: academicYear,
    } = recordRows[0];

    const [studentProfile] = await connection.execute(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = ?`,
      [userId],
    );
    const alumniName =
      studentProfile.length > 0
        ? `${studentProfile[0].first_name} ${studentProfile[0].last_name}`
        : null;

    const [studentSai] = await connection.execute(
      `SELECT course_id, department_id
       FROM student_academic_info
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    const courseId = studentSai.length > 0 ? studentSai[0].course_id : null;
    const departmentId =
      studentSai.length > 0 ? studentSai[0].department_id : null;

    // Same batch_year caveat as markInternshipFinished — derived, not tracked.
    const batchYear = dateStarted
      ? new Date(dateStarted).getFullYear().toString()
      : null;

    try {
      await connection.execute(
        `INSERT INTO alumni_internship_records
          (id, entered_by, alumni_name, company_name, company_address, industry,
           internship_position, course_id, batch_year, academic_year,
           total_hours, accumulated_hours, supervisor_name, notes,
           internship_record_id, source, department_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'system', ?)`,
        [
          newUUID(),
          userId,
          alumniName,
          company_name,
          companyAddress,
          industry,
          internshipPosition,
          courseId,
          batchYear,
          academicYear,
          total_hours,
          accumulated_hours,
          internshipId,
          departmentId,
        ],
      );
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }

    await connection.commit();

    res.status(200).json({
      message: "Congrats on finishing your current internship!",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Finish internship record error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getDepartmentInternshipRecords = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;

    const { status, search, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10));
    const offset = (pageNum - 1) * pageSize;

    connection = await db.getConnection();

    // Resolve the department head's own department — never trust a
    // client-supplied department_id, derive it server-side from who's asking
    let userDepartmentId = null;
    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [requesterId],
      );
      if (deptHeadRows.length === 0) {
        return res
          .status(403)
          .json({ error: "Department head profile not found." });
      }
      userDepartmentId = deptHeadRows[0].department_id;
    }

    const conditions = ["ir.deleted_at IS NULL"];
    const params = [];

    if (role === "department_head") {
      conditions.push("sai.department_id = ?");
      params.push(userDepartmentId);
    }

    if (status) {
      conditions.push("ir.status = ?");
      params.push(status);
    }

    if (search) {
      conditions.push(
        `(up.first_name LIKE ? OR up.last_name LIKE ? 
          OR sai.student_number LIKE ? 
          OR ir.company_name LIKE ? 
          OR c.course_name LIKE ?)`,
      );
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const baseFrom = `
      FROM internship_records ir
      INNER JOIN user_profiles up ON ir.user_id = up.user_id
      INNER JOIN (
        SELECT sai1.*
        FROM student_academic_info AS sai1
        INNER JOIN (
          SELECT user_id, MAX(id) AS max_id
          FROM student_academic_info
          GROUP BY user_id
        ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
      ) AS sai ON ir.user_id = sai.user_id
      INNER JOIN courses c ON sai.course_id = c.id
    `;

    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(*) AS total ${baseFrom} WHERE ${whereClause}`,
      params,
    );

    const [records] = await connection.execute(
      `SELECT 
         ir.id, ir.company_name, ir.internship_position, ir.status,
         ir.date_started, ir.date_ended, ir.total_hours, ir.accumulated_hours,
         ir.user_id,
         up.first_name, up.last_name,
         sai.student_number,
         c.course_name
       ${baseFrom}
       WHERE ${whereClause}
       ORDER BY ir.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    // Stats — scoped by department, independent of the current status/search
    // filter, so the count cards always reflect department-wide totals
    const statsConditions = ["ir.deleted_at IS NULL"];
    const statsParams = [];

    if (role === "department_head") {
      statsConditions.push("sai.department_id = ?");
      statsParams.push(userDepartmentId);
    }

    const [statsRows] = await connection.execute(
      `SELECT ir.status, COUNT(*) AS count
       ${baseFrom}
       WHERE ${statsConditions.join(" AND ")}
       GROUP BY ir.status`,
      statsParams,
    );

    const stats = { pending: 0, ongoing: 0, finished: 0, rejected: 0 };
    statsRows.forEach((row) => {
      if (stats[row.status] !== undefined) stats[row.status] = row.count;
    });

    const data = records.map((r) => ({
      id: r.id,
      student_name: `${r.first_name} ${r.last_name}`,
      student_id: r.user_id,
      student_number: r.student_number,
      company_name: r.company_name,
      internship_position: r.internship_position,
      course_name: r.course_name,
      status: r.status,
      date_started: r.date_started,
      date_ended: r.date_ended,
      total_hours: r.total_hours,
      accumulated_hours: r.accumulated_hours,
    }));

    res.status(200).json({
      data,
      stats,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get department internship records error:", error);
    res.status(500).json({ error: "Failed to load internship records." });
  } finally {
    if (connection) connection.release();
  }
};

export const restoreInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    let userDepartmentId = null;
    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [requesterId],
      );
      if (deptHeadRows.length === 0) {
        await connection.rollback();
        return res
          .status(403)
          .json({ error: "Department head profile not found." });
      }
      userDepartmentId = deptHeadRows[0].department_id;
    }

    const [rows] = await connection.execute(
      `SELECT ir.id, ir.status, sai.department_id
       FROM internship_records ir
       INNER JOIN (
         SELECT sai1.*
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       WHERE ir.id = ? FOR UPDATE`,
      [internshipId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const record = rows[0];

    if (
      role === "department_head" &&
      record.department_id !== userDepartmentId
    ) {
      await connection.rollback();
      return res.status(403).json({
        error: "You can only manage records within your own department.",
      });
    }

    if (record.status !== "rejected") {
      await connection.rollback();
      return res.status(400).json({
        error: "Only a rejected record can be restored.",
      });
    }

    await connection.execute(
      `UPDATE internship_records SET status = 'pending', updated_at = NOW() WHERE id = ?`,
      [internshipId],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message:
        "Record restored to pending. It will re-enter the approval queue.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Restore internship record error:", error);
    res.status(500).json({ error: "Failed to restore internship record." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { role } = req.verifiedUser;
    const { internshipId } = req.params;

    if (!internshipId) {
      return res.status(400).json({ error: "internshipId is required." });
    }

    // Restricted to admin only — unlike approve/reject/restore, a delete is
    // destructive and irreversible from the department head's own view, so
    // it's kept out of their hands even within their own department
    if (role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only an admin can delete an internship record." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, deleted_at FROM internship_records WHERE id = ? FOR UPDATE`,
      [internshipId],
    );

    if (rows.length === 0 || rows[0].deleted_at !== null) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const [result] = await connection.execute(
      `UPDATE internship_records SET deleted_at = NOW() WHERE id = ?`,
      [internshipId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Internship record deleted.",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete internship record error:", error);
    res.status(500).json({ error: "Failed to delete internship record." });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordOverview = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    const record = await verifyRecordAccess(
      connection,
      internshipId,
      requesterId,
      role,
    );

    const [rows] = await connection.execute(
      `SELECT 
         ir.company_name, ir.internship_position, ir.status,
         ir.date_started, ir.date_ended, ir.created_at,
         ir.total_hours, ir.accumulated_hours, ir.created_at,
         up.first_name, up.last_name,
         sai.student_number,
         c.course_name,
         supervisor.first_name AS supervisor_first_name,
         supervisor.last_name AS supervisor_last_name
       FROM internship_records ir
       INNER JOIN user_profiles up ON ir.user_id = up.user_id
       INNER JOIN (
         SELECT sai1.*
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses c ON sai.course_id = c.id
       LEFT JOIN user_profiles supervisor ON ir.employer_id = supervisor.user_id
       WHERE ir.id = ?`,
      [internshipId],
    );

    const data = rows[0];

    const [[dtrCount]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM daily_time_records WHERE internship_id = ?`,
      [internshipId],
    );
    const [[narrativeCount]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM daily_narratives WHERE internship_id = ?`,
      [internshipId],
    );
    const [[documentCount]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM internship_documents WHERE internship_id = ?`,
      [internshipId],
    );

    const totalHours = Number(data.total_hours) || 0;
    const accumulatedHours = Number(data.accumulated_hours) || 0;

    res.status(200).json({
      created_at: data.created_at,
      student_name: `${data.first_name} ${data.last_name}`,
      student_number: data.student_number,
      course_name: data.course_name,
      company_name: data.company_name,
      internship_position: data.internship_position,
      status: data.status,
      supervisor_name: data.supervisor_first_name
        ? `${data.supervisor_first_name} ${data.supervisor_last_name}`
        : null,
      date_started: data.date_started,
      date_ended: data.date_ended,
      submitted_at: data.created_at,
      total_hours: totalHours,
      accumulated_hours: accumulatedHours,
      percent_complete:
        totalHours > 0 ? Math.round((accumulatedHours / totalHours) * 100) : 0,
      dtr_count: dtrCount.count,
      narrative_count: narrativeCount.count,
      document_count: documentCount.count,
    });
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record overview error:", error);
    res.status(500).json({ error: "Failed to load overview." });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordDtr = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT id, total_hours, clock_in, clock_out, lat_in, lon_in, lat_out, lon_out,
          status, flagged, flag_reason, auto_closed, created_at
       FROM daily_time_records
       WHERE internship_id = ?
       ORDER BY clock_in DESC
       LIMIT 500`,
      [internshipId],
    );

    res.status(200).json(rows);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record DTR error:", error);
    res.status(500).json({ error: "Failed to load DTR entries." });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordNarratives = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT id, day_number, title, narrative, created_at, updated_at
       FROM daily_narratives
       WHERE internship_id = ?
       ORDER BY day_number ASC
       LIMIT 100`,
      [internshipId],
    );

    res.status(200).json(rows);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record narratives error:", error);
    res.status(500).json({ error: "Failed to load narratives." });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordEvaluations = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const POINTS_PER_CRITERION = 5;

    // 1. Evaluations ABOUT the student, from their employer — now fetched
    // regardless of status (pending, completed, or disputed)
    const receivedQuery = `
      SELECT 
        m.id AS evaluation_id,
        m.status AS status,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.evaluated_by AS actor_id,
        m.reviewed_by,
        m.reviewed_at,
        m.review_notes,
        ir.company_name AS company,
        CONCAT(up.first_name, ' ', up.last_name) AS actor_name,
        CONCAT(reviewer_up.first_name, ' ', reviewer_up.last_name) AS reviewer_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM student_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN student_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN student_evaluation_criteria AS c ON s.criterion_id = c.id
      JOIN user_profiles AS up ON m.evaluated_by = up.user_id
      LEFT JOIN user_profiles AS reviewer_up ON m.reviewed_by = reviewer_up.user_id
      WHERE ir.id = ?
      ORDER BY m.created_at DESC, c.category ASC
    `;

    // 2. Evaluations the student submitted ABOUT their supervisor —
    // this direction has no review step, so reviewer fields stay null
    const givenQuery = `
      SELECT 
        m.id AS evaluation_id,
        m.other_remarks AS comments,
        m.created_at AS submitted_date,
        m.employer_id AS actor_id,
        ir.company_name AS company,
        CONCAT(student_up.first_name, ' ', student_up.last_name) AS actor_name,
        c.category AS breakdown_label,
        s.score AS breakdown_score
      FROM employer_evaluation_masters AS m
      JOIN internship_records AS ir ON m.internship_record_id = ir.id
      JOIN employer_evaluation_scores AS s ON s.evaluation_master_id = m.id
      JOIN employer_evaluation_criteria AS c ON s.criterion_id = c.id
      LEFT JOIN user_profiles AS student_up ON ir.user_id = student_up.user_id
      WHERE ir.id = ?
      ORDER BY m.created_at DESC, c.category ASC
    `;

    const [receivedRows] = await connection.execute(receivedQuery, [
      internshipId,
    ]);
    const [givenRows] = await connection.execute(givenQuery, [internshipId]);

    // Maps the raw enum value to a display-friendly label
    function formatStatus(rawStatus) {
      switch (rawStatus) {
        case "completed":
          return "Confirmed";
        case "disputed":
          return "Disputed";
        case "pending":
        default:
          return "Pending";
      }
    }

    function groupRows(rows, type, actorLabel, { useRowStatus = false } = {}) {
      const group = {};

      rows.forEach((row) => {
        const evalId = row.evaluation_id;

        if (!group[evalId]) {
          const dateObj = new Date(row.submitted_date);

          const formattedDate = dateObj.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          const formattedPeriod = dateObj.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          });

          group[evalId] = {
            id: evalId,
            type,
            status: useRowStatus ? formatStatus(row.status) : "Confirmed",
            period: formattedPeriod,
            evaluator:
              actorLabel === "self"
                ? row.actor_name || "Unknown Student"
                : row.actor_name || "Your Supervisor",
            evaluator_id: row.actor_id,
            company: row.company,
            submittedDate: formattedDate,
            comments: row.comments || "",
            reviewed_by: row.reviewed_by || null,
            reviewer_name: row.reviewer_name || null,
            reviewed_at: row.reviewed_at || null,
            review_notes: row.review_notes || null,
            breakdown: [],
          };
        }

        let existingCategory = group[evalId].breakdown.find(
          (b) => b.label === row.breakdown_label,
        );

        const currentScore = Number(row.breakdown_score);

        if (existingCategory) {
          existingCategory.score += currentScore;
          existingCategory.max += POINTS_PER_CRITERION;
        } else {
          group[evalId].breakdown.push({
            label: row.breakdown_label,
            score: currentScore,
            max: POINTS_PER_CRITERION,
          });
        }
      });

      return Object.values(group);
    }

    const received = groupRows(
      receivedRows,
      "Performance Evaluation",
      "employer",
      { useRowStatus: true },
    );
    const given = groupRows(givenRows, "Supervisor Evaluation", "self");

    const combined = [...received, ...given].sort(
      (a, b) => new Date(b.submittedDate) - new Date(a.submittedDate),
    );

    return res.status(200).json(combined);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record evaluations error:", error);
    return res.status(500).json({ error: "Failed to load evaluations." });
  } finally {
    if (connection) connection.release();
  }
};

export const getInternshipRecordDocuments = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId } = req.params;

    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT 
         d.id, d.file_name, d.company_name, d.category, d.file_type,
         d.verification_status, d.uploaded_by_id, d.uploaded_by_role,
         d.created_at, d.requirement_type_id,
         rt.name AS requirement_name
       FROM internship_documents d
       LEFT JOIN requirement_types rt ON d.requirement_type_id = rt.id
       WHERE d.internship_id = ?
       ORDER BY d.created_at DESC`,
      [internshipId],
    );

    res.status(200).json(rows);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Get internship record documents error:", error);
    res.status(500).json({ error: "Failed to load documents." });
  } finally {
    if (connection) connection.release();
  }
};

export const downloadInternshipRecordFile = async (req, res) => {
  const BUCKET = process.env.SUPABASE_BUCKET;
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { internshipId, fileId } = req.params;

    if (!internshipId || !fileId) {
      return res
        .status(400)
        .json({ error: "internshipId and fileId are required." });
    }

    connection = await db.getConnection();

    // Same access check as the rest of the internship record detail view —
    // department heads only see records within their own department
    await verifyRecordAccess(connection, internshipId, requesterId, role);

    const [rows] = await connection.execute(
      `SELECT internship_id, path, file_name FROM internship_documents WHERE id = ?`,
      [fileId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "File not found." });
    }

    const doc = rows[0];

    // Confirm the file actually belongs to the internship record named in
    // the route — never trust fileId alone, or a caller could pull a file
    // by guessing/reusing an id that belongs to a different internship
    if (doc.internship_id !== internshipId) {
      // 404 rather than 403 — don't reveal that a file with this id
      // exists under a *different* internship record
      return res.status(404).json({ error: "File not found." });
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
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Download internship record file error:", error.message);
    res.status(500).json({ error: "Failed to retrieve file." });
  } finally {
    if (connection) connection.release();
  }
};
