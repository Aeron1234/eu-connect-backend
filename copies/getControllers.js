import { db } from "../config/db.js"; // Added .js extension

///////////////////
//ACCOUNT
///////////////////
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.verifiedUser;

    const [rows] = await db.execute(
      `SELECT up.*, u.email 
       FROM user_profiles AS up
       INNER JOIN users AS u on up.user_id = u.id
       WHERE user_id = ?
       LIMIT 1`,
      [id],
    );

    const record = rows.length > 0 ? rows[0] : null;

    res.status(200).json(record);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllAccounts = async (req, res) => {
  try {
    // ROLES : 1 = Student, 2 = Employer, 3 = Department Head, 4 = Admin

    //For students and dep. heads
    const [school] = await db.execute(
      `
      SELECT u.id, u.email, u.created_at, u.status, up.first_name, up.last_name, r.role, c.course_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN student_academic_info AS sai ON u.id = sai.user_id
      INNER JOIN courses AS c ON c.id = sai.course_id
      WHERE u.role_id IN(1,3)
      `,
    );

    //For employers
    const [employers] = await db.execute(
      `
      SELECT u.id, u.email, u.created_at, u.status, up.first_name, up.last_name, r.role
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      WHERE u.role_id = 2
      `,
    );

    const schoolAccounts = school || [];
    const employerAccounts = employers || [];

    const allUserAccounts = [...schoolAccounts, ...employerAccounts]
      .sort((a, b) => a.last_name.localeCompare(b.last_name))
      .sort((a, b) => a.status.localeCompare(b.status));

    const records = allUserAccounts.length > 0 ? allUserAccounts : null;
    console.log("Data fetched:", allUserAccounts);

    res.status(200).json(records);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// ROLES
///////////////////
export const getRoles = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM roles`);

    const records = rows.length > 0 ? rows : null;
    return res.status(200).json(records);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// COURSES
///////////////////
export const getCourses = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM courses`);

    const records = rows.length > 0 ? rows : null;
    return res.status(200).json(records);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// INTERNSHIPS
///////////////////
export const getActiveInternship = async (req, res) => {
  try {
    const { id } = req.verifiedUser;

    const [rows] = await db.execute(
      `SELECT * FROM internship_records
       WHERE user_id = ? AND status = "ongoing"
       LIMIT 1`,
      [id],
    );

    const record = rows.length > 0 ? rows[0] : null;

    console.log("Data fetched:", rows);

    res.status(200).json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAllActiveInternships = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT ir.id, ir.user_id, ir.company_name, ir.company_address, ir.lon, ir.lat, ir.state_or_province, ir.city_or_town, up.first_name, up.last_name, c.course_name
        FROM internship_records AS ir
       INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
       INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses AS c ON sai.course_id = c.id
       WHERE ir.status = "ongoing"
       `,
    );

    const records = rows.length > 0 ? rows : [];

    console.log(`Map Data: Found ${records.length} active internships.`);

    res.status(200).json(records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
//Daily Time Records
///////////////////
export const getTodayDTR = async (req, res) => {
  try {
    const { id } = req.verifiedUser;
    const { internshipId } = req.query;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM daily_time_records 
       WHERE user_id = ? AND DATE(created_at) = CURDATE() AND internship_id = ?
       LIMIT 1`,
      [id, internshipId],
    );

    const record = rows.length > 0 ? rows[0] : null;

    console.log("Data fetched:", rows);

    res.status(200).json(record);
  } catch (error) {
    console.error(error);
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

    console.log(`Fetched ${rows.length} records for User ${id}`);
    console.log("Data fetched:", rows);

    res.status(200).json({
      dtrs: rows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
//Daily Narratives
///////////////////
export const getAllNarratives = async (req, res) => {
  try {
    const { id } = req.verifiedUser;
    const internshipId = req.query.internshipId;
    const limit = parseInt(req.query.limit) || 4;
    const offset = parseInt(req.query.offset) || 0;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM daily_narratives 
       WHERE user_id = ? AND internship_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?
       `,
      [id, internshipId, limit, offset],
    );

    const [countResult] = await db.execute(
      `SELECT COUNT(*) AS total FROM daily_narratives
        WHERE user_id = ? AND internship_id = ?`,
      [id, internshipId],
    );

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    console.log(`Fetched ${rows.length} records for User ${id}`);
    console.log("Data fetched:", rows);

    res.status(200).json({
      narratives: rows,
      totalPages,
      totalRecords,
      currentPage: Math.floor(offset / limit) + 1,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

//////////////////////////////////////
//Internship Related Files
//////////////////////////////////////
export const getInternshipFiles = async (req, res) => {
  try {
    const { id } = req.verifiedUser;

    const [rows] = await db.execute(
      `SELECT * FROM internship_documents
       WHERE user_id = ?
       `,
      [id],
    );

    const records = rows.length > 0 ? rows : null;

    res.status(200).json(records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

//////////////////////////////////////
//Announcements
//////////////////////////////////////
export const getAllAnnouncements = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT a.id, a.author_id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at, r.role, up.first_name, up.last_name, ac.name AS category, ac.color, ac.text_color
       FROM announcements AS a
       INNER JOIN users AS u ON a.author_id = u.id
       INNER JOIN roles AS r ON u.role_id = r.id
       INNER JOIN user_profiles AS up ON a.author_id = up.user_id
       INNER JOIN announcement_categories AS ac ON a.category_id = ac.id
       ORDER BY created_at DESC
       `,
    );

    const records = rows.length > 0 ? rows : null;

    console.log("Data fetched:", rows);

    res.status(200).json(records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getAnnouncementCategories = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM announcement_categories`);

    const records = rows.length > 0 ? rows : null;
    return res.status(200).json(records);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};
