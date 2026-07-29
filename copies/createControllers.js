import { db } from "../config/db.js";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../config/supabase.js";
import bcrypt from "bcryptjs";

///////////////////
// INTERNSHIPS
///////////////////
export const createInternshipRecord = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const data = req.body;

    const requiredFields = [
      "company_name",
      "company_address",
      "date_started",
      "total_hours",
      "lon",
      "lat",
    ];

    for (const field of requiredFields) {
      if (!data[field] || data[field].trim() === "") {
        return res.status(400).json({
          error: `${field.replace(/_/g, " ")} is required for the map.`,
        });
      }
    }

    // 2. Atomic Check & Insert
    const [result] = await db.execute(
      `
      INSERT INTO internship_records (user_id, company_name, company_address, lon, lat, date_started, total_hours, city_or_town, state_or_province)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM internship_records WHERE user_id = ? AND status = 'ongoing'
      )
      `,
      [
        userId,
        data.company_name,
        data.company_address,
        data.lon,
        data.lat,
        data.date_started,
        Number(data.total_hours),
        data.city_or_town,
        data.state_or_province,
        userId,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "You already have an ongoing internship record.",
      });
    }

    res.status(201).json({
      message: "Good luck in your internship!",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// DAILY TIME RECORDS
///////////////////
export const clockIn = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { location_in } = req.body;
    const internshipId = req.query.internshipId;

    if (!internshipId) {
      return res.status(400).json({
        error: "No ongoing internship.",
      });
    }

    if (!location_in) {
      return res.status(400).json({ error: "Can't get your location." });
    }

    const [result] = await db.execute(
      `INSERT INTO daily_time_records (internship_id, user_id, clock_in, location_in) VALUES (?, ?, CURRENT_TIME(), ?)`,
      [internshipId, userId, location_in],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Clocked-in failed.",
      });
    }

    res.status(201).json({
      message: "Clock-in successful.",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// DAILY NARRATIVES
///////////////////
export const createNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { day_number, title, narrative } = req.body;
    const internshipId = req.query.internshipId;

    if (!Number(day_number) || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (!internshipId) {
      return res.status(400).json({
        error: "No ongoing internship.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO daily_narratives (user_id, internship_id, day_number, title, narrative)
        VALUES (?, ?, ?, ?, ?)`,
      [userId, internshipId, Number(day_number), title, narrative.trim()],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Posting Narrative failed.",
      });
    }

    res.status(201).json({
      message: "Narrative added!",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// INTERNSHIP FILES
///////////////////
export const uploadInternshipFile = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;

    // 1. Text fields come from req.body
    const { file_name, company_name, category } = req.body;
    const catLower = category?.toLowerCase();

    // 2. The file comes from req.file (thanks to Multer)
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // 3. Validation using Multer's property names
    const ALLOWED_TYPES = [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ];

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "File is too large (Max 10MB)." });
    }

    if (catLower !== "before" && catLower !== "after") {
      return res.status(400).json({
        error: 'Category must be "Before" or "After".',
      });
    }

    // 4. Prepare Supabase Upload
    const fileExt = file.originalname.split(".").pop();
    const uploadFilePath = `requirements/${userId}/${Date.now()}.${fileExt}`;

    // IMPORTANT: In Express, the file is a Buffer. Use file.buffer
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("eu-connect_storage")
      .upload(uploadFilePath, file.buffer, {
        contentType: file.mimetype, // Crucial so the browser knows how to open it
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("eu-connect_storage")
      .getPublicUrl(uploadFilePath);

    // 5. Save to Database
    const [result] = await db.execute(
      `INSERT INTO internship_documents (user_id, file_name, company_name, category, file_type, url, path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        file_name,
        company_name,
        catLower,
        file.mimetype,
        publicUrl,
        uploadFilePath,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Uploading file failed.",
      });
    }

    res.status(201).json({
      message: "Document uploaded successfully!",
      success: true,
    });
  } catch (error) {
    console.error("Upload Error:", error.message);
    res.status(500).json({ error: "Server failed to process upload." });
  }
};

///////////////////
// ANNOUNCEMENT
///////////////////
export const createAnnouncement = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const data = req.body;

    //Categories
    // const GENERAL = 1;
    // const REQUIREMENTS = 2;
    // const EVENTS = 3;
    // const EVALUATIONS = 4;

    const { category_id, title, content } = data;

    if (!category_id || !title || !content) {
      return res.status(400).json({
        error: "All fields are required.",
      });
    }

    // 2. Atomic Check & Insert
    const [result] = await db.execute(
      `
      INSERT INTO announcements (author_id, category_id, title, content)
      VALUES (?, ?, ?, ?)
      `,
      [userId, category_id, title, content],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Posting annoucement failed.",
      });
    }

    const [newAnnouncement] = await db.execute(
      `SELECT a.*, ac.name AS category, ac.color AS category_bg, ac.text_color AS category_fg, up.first_name, up.last_name, r.role
       FROM announcements AS a
       JOIN announcement_categories AS ac ON a.category_id = ac.id
       JOIN user_profiles AS up ON a.author_id = up.user_id
       JOIN users u ON a.author_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE a.id = ?`,
      [result.insertId],
    );

    console.log(newAnnouncement[0]);
    res.status(201).json({
      message: "Announcement posted successfully!",
      success: true,
      data: newAnnouncement[0],
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// ACCOUNT
///////////////////
export const createUser = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;
    const userData = req.body;

    const { email, password, first_name, last_name, course, role } = userData;

    // ROLES : 1 = Student, 2 = Employer, 3 = Department Head, 4 = Admin
    // id of each role in roles table in db
    const roleId = Number(role);
    const STUDENT = 1;
    const EMPLOYER = 2;
    const DEPARTMENT_HEAD = 3;
    const ADMIN = 4;

    const requiredFields = [
      "email",
      "first_name",
      "last_name",
      "password",
      "role",
    ];
    for (const field of requiredFields) {
      if (!userData[field] || userData[field].trim() === "") {
        return res.status(400).json({
          message: `${field.replace(/_/g, " ")} is required.`,
        });
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Invalid email format.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters.",
      });
    }

    if (roleId === STUDENT || roleId === DEPARTMENT_HEAD) {
      if (!course) {
        return res.status(400).json({
          message: "Course is required for this role.",
        });
      }
    }

    await connection.beginTransaction();

    // Check if exists
    const [userExists] = await connection.execute(
      `SELECT id FROM users WHERE email = ?`,
      [email],
    );
    if (userExists.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "User already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newId = uuidv4();

    const [result] = await connection.execute(
      `INSERT INTO users (id, email, password_hash, role_id) VALUES (?, ?, ?, ?)`,
      [newId, email, hashedPassword, roleId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({
        error: "Creating account failed.",
      });
    }

    await connection.execute(
      `INSERT INTO user_profiles (user_id, first_name, last_name) VALUES (?, ?, ?)`,
      [newId, first_name, last_name],
    );

    if (roleId === STUDENT || roleId === DEPARTMENT_HEAD) {
      await connection.execute(
        `INSERT INTO student_academic_info (user_id, course_id) VALUES (?, ?)`,
        [newId, Number(course)],
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
