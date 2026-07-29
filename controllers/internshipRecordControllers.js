import { db } from "../config/db.js";
import { newUUID } from "../config/helpers.js";

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
    ];

    for (const field of requiredFields) {
      if (!data[field] || data[field].trim() === "") {
        return res.status(400).json({
          error: `${field.replace(/_/g, " ")} is required for the map.`,
        });
      }
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

    // 🌟 FIX: Added DISTINCT to prevent duplicate recipients when a user has
    // more than one row in dept_heads_background_info (or leftover/duplicate
    // rows from testing/truncation). Safe here since only u.id, up.first_name,
    // up.last_name are selected — no dhbi columns that could legitimately differ.
    const [recipients] = await connection.execute(
      `
      SELECT DISTINCT u.id, up.first_name, up.last_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      LEFT JOIN dept_heads_background_info AS dhbi ON u.id = dhbi.user_id
      WHERE 
        (u.role_id = ? AND dhbi.department_id = ?) -- Match Dept Head by Course
        OR 
        (u.role_id = ?) -- Include Admins (regardless of course)
      `,
      [DEPARTMENT_HEAD, department_id, ADMIN],
    );

    const [result] = await connection.execute(
      `
      INSERT INTO internship_records (id, user_id, company_name, company_address, internship_position, description, lon, lat, date_started, total_hours, region_id, company_website)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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

    // Notify each Admin/Dept Head in real-time
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
    console.log(error);
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

    const { id: userId } = req.verifiedUser;
    const { internshipId } = req.params;
    const { status } = req.body;

    if (!internshipId || !status) {
      return res.status(400).json({
        error: "Internship ID and status are required",
      });
    }

    // 🌟 FIX: Validate status against the only two values this endpoint should
    // ever accept. Without this, an unexpected value (e.g. 'pending', 'finished')
    // would still be written to internship_records and would generate a
    // misleading "rejected by ..." notification for anything other than 'ongoing'.
    if (!["ongoing", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value." });
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

    const [recipient] = await connection.execute(
      `SELECT user_id, company_name FROM internship_records WHERE id = ?`,
      [internshipId],
    );

    if (recipient.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const { user_id: studentId, company_name } = recipient[0];

    const [currentRecord] = await connection.execute(
      `SELECT status FROM internship_records WHERE id = ?`,
      [internshipId],
    );

    if (currentRecord[0].status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        error: "This record has already been processed.",
      });
    }

    const [result] = await connection.execute(
      `UPDATE internship_records SET updated_at = NOW(), status = ? WHERE id = ?`,
      [status, internshipId],
    );

    // 🌟 FIX: Scoped to the approving user_id. Without this, approving/rejecting
    // marked EVERY recipient's copy of the submission notification as read
    // (e.g. an admin approving would silently mark it read in the dept head's
    // inbox too, even though the dept head never opened it).
    await connection.execute(
      `UPDATE notifications 
      SET is_read = 1 
      WHERE link = ? AND type = 'submission' AND user_id = ?`,
      [internshipId, userId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "Failed to update or can't find the internship record. Please try again.",
      });
    }

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
      link: result.affectedRows > 0 ? internshipId : null,
    });

    res.status(200).json({
      success: true,
      message: "Status updated and student notified!",
    });
  } catch (error) {
    console.log("Approve internship record error: ", error);
    if (connection) await connection.rollback();
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const finishInternshipRecord = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const internshipId = req.params.internshipId;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    // 1. Run the update ONLY if they have enough hours
    const [result] = await db.execute(
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

    // 2. If 0 rows were affected, we need to know WHY
    if (result.affectedRows === 0) {
      // Check if the record exists but they just don't have enough hours
      const [record] = await db.execute(
        `SELECT accumulated_hours, total_hours FROM internship_records WHERE id = ?`,
        [internshipId],
      );

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

    res.status(200).json({
      message: "Congrats on finishing your current internship!",
      success: true,
    });
  } catch (error) {
    console.log("Finish internship record error:", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};
