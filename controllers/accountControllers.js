import { db } from "../config/db.js";
import bcrypt from "bcryptjs";
import { newUUID } from "../config/helpers.js";

export const getUserProfile = async (req, res) => {
  try {
    const { id, role } = req.verifiedUser;

    let query;
    switch (role) {
      case "admin":
        query = `
          SELECT 
            u.id, u.email, u.username, r.role, u.status, u.created_at,
            up.first_name, up.last_name, up.contact_number, up.full_address, up.gender
          FROM users u
          INNER JOIN roles r ON r.id = u.role_id
          INNER JOIN user_profiles up ON up.user_id = u.id
          WHERE u.id = ?
          LIMIT 1`;
        break;

      case "student":
        query = `
          SELECT 
            u.id, u.email, u.username, r.role, u.status, u.created_at,
            up.first_name, up.last_name, up.contact_number, up.full_address, up.gender,
            c.course_name AS course, d.code AS department_code, d.name AS department_name,
            sai.student_number, sai.year_level
          FROM users u
          INNER JOIN roles r ON r.id = u.role_id
          INNER JOIN user_profiles up ON up.user_id = u.id
          INNER JOIN (
            SELECT sai1.*
            FROM student_academic_info sai1
            INNER JOIN (
              SELECT user_id, MAX(id) AS max_id
              FROM student_academic_info
              GROUP BY user_id
            ) latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
          ) sai ON sai.user_id = u.id
          INNER JOIN departments d ON d.id = sai.department_id
          INNER JOIN courses c ON c.id = sai.course_id
          WHERE u.id = ?
          LIMIT 1`;
        break;

      case "employer":
        query = `
          SELECT 
            u.id, u.email, u.username, r.role, u.status, u.created_at,
            up.first_name, up.last_name, up.contact_number, up.full_address, up.gender,
            ebi.company_name, ebi.company_address, ebi.position,
            ebi.contact_number AS company_contact_number
          FROM users u
          INNER JOIN roles r ON r.id = u.role_id
          INNER JOIN user_profiles up ON up.user_id = u.id
          INNER JOIN employer_background_info ebi ON ebi.user_id = u.id
          WHERE u.id = ?
          LIMIT 1`;
        break;

      case "department_head":
        query = `
          SELECT 
            u.id, u.email, u.username, r.role, u.status, u.created_at,
            up.first_name, up.last_name, up.contact_number, up.full_address, up.gender,
            d.code AS department_code, d.name AS department_name, dhbi.employee_number
          FROM users u
          INNER JOIN roles r ON r.id = u.role_id
          INNER JOIN user_profiles up ON up.user_id = u.id
          INNER JOIN dept_heads_background_info dhbi ON dhbi.user_id = u.id
          INNER JOIN departments d ON d.id = dhbi.department_id
          WHERE u.id = ?
          LIMIT 1`;
        break;

      default:
        return res.status(403).json({ error: "Unrecognized role." });
    }

    const [rows] = await db.execute(query, [id]);
    const record = rows.length > 0 ? rows[0] : null;

    if (!record) {
      return res.status(404).json({ error: "Profile not found." });
    }

    res.status(200).json(record);
  } catch (error) {
    console.log("Get user profile error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const updateUserInfo = async (req, res) => {
  let connection;
  try {
    const { id, role } = req.verifiedUser;
    const {
      email,
      username,
      first_name,
      last_name,
      contact_number,
      full_address,
      gender,
      // employer-only
      company_name,
      company_address,
      position,
      company_contact_number,
      // department_head-only
      employee_number,
    } = req.body;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the user row so concurrent edits (e.g. password change) don't race
    const [userRows] = await connection.execute(
      `SELECT id, email, username FROM users WHERE id = ? FOR UPDATE`,
      [id],
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "User not found." });
    }

    // --- users table: email / username uniqueness checks ---
    if (email && email !== userRows[0].email) {
      const [dupe] = await connection.execute(
        `SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1`,
        [email, id],
      );
      if (dupe.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: "Email is already in use." });
      }
    }

    if (username && username !== userRows[0].username) {
      const [dupe] = await connection.execute(
        `SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1`,
        [username, id],
      );
      if (dupe.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: "Username is already in use." });
      }
    }

    await connection.execute(
      `UPDATE users 
       SET email = COALESCE(?, email), username = COALESCE(?, username) 
       WHERE id = ?`,
      [email ?? null, username ?? null, id],
    );

    // --- user_profiles table ---
    // Students keep their name locked server-side regardless of payload,
    // mirroring the frontend rule (retain professionalism / prevent impersonation)
    const [firstNameParam, lastNameParam] =
      role === "student"
        ? [null, null]
        : [first_name ?? null, last_name ?? null];

    await connection.execute(
      `UPDATE user_profiles 
       SET first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name),
           contact_number = COALESCE(?, contact_number),
           full_address = COALESCE(?, full_address),
           gender = COALESCE(?, gender)
       WHERE user_id = ?`,
      [
        firstNameParam,
        lastNameParam,
        contact_number ?? null,
        full_address ?? null,
        gender ?? null,
        id,
      ],
    );

    // --- role-specific background info ---
    if (role === "employer") {
      await connection.execute(
        `UPDATE employer_background_info
         SET company_name = COALESCE(?, company_name),
             company_address = COALESCE(?, company_address),
             position = COALESCE(?, position),
             contact_number = COALESCE(?, contact_number)
         WHERE user_id = ?`,
        [
          company_name ?? null,
          company_address ?? null,
          position ?? null,
          company_contact_number ?? null,
          id,
        ],
      );
    } else if (role === "department_head") {
      // department_id intentionally excluded — treat as admin-assigned, not self-editable
      await connection.execute(
        `UPDATE dept_heads_background_info
         SET employee_number = COALESCE(?, employee_number)
         WHERE user_id = ?`,
        [employee_number ?? null, id],
      );
    }
    // student & admin: nothing further here — academic info has its own endpoint

    await connection.commit();

    res.status(200).json({ success: true, message: "Profile updated." });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update user info error: ", error);
    res.status(500).json({ error: "Failed to update profile." });
  } finally {
    if (connection) connection.release();
  }
};

export const updatePassword = async (req, res) => {
  let connection;
  try {
    const { id } = req.verifiedUser;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "All password fields are required." });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT password_hash FROM users WHERE id = ? FOR UPDATE`,
      [id],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "User not found." });
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      rows[0].password_hash,
    );
    if (!isMatch) {
      await connection.rollback();
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await connection.execute(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
      [newHash, id],
    );

    await connection.commit();

    res.status(200).json({ success: true, message: "Password updated." });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update password error: ", error);
    res.status(500).json({ error: "Failed to update password." });
  } finally {
    if (connection) connection.release();
  }
};

export const getAllAccounts = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    // 1. Students (role_id = 1) - fetches course and department details
    const [students] = await connection.execute(
      `
      SELECT 
        u.id, u.email, u.created_at, u.status, 
        up.first_name, up.last_name, 
        r.role, 
        c.course_name, 
        d.code AS department_code, 
        d.name AS department_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      LEFT JOIN student_academic_info AS sai ON u.id = sai.user_id
      LEFT JOIN courses AS c ON c.id = sai.course_id
      LEFT JOIN departments AS d ON d.id = sai.department_id
      WHERE u.role_id = 1
      `,
    );

    // 2. Department Heads (role_id = 3) - fetches department details & employee_number
    const [deptHeads] = await connection.execute(
      `
      SELECT 
        u.id, u.email, u.created_at, u.status, 
        up.first_name, up.last_name, 
        r.role, 
        NULL AS course_name, 
        d.code AS department_code, 
        d.name AS department_name,
        dhbi.employee_number
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      LEFT JOIN dept_heads_background_info AS dhbi ON u.id = dhbi.user_id
      LEFT JOIN departments AS d ON d.id = dhbi.department_id
      WHERE u.role_id = 3
      `,
    );

    // 3. Employers (role_id = 2)
    const [employers] = await connection.execute(
      `
      SELECT 
        u.id, u.email, u.created_at, u.status, 
        up.first_name, up.last_name, 
        r.role,
        NULL AS course_name,
        NULL AS department_code,
        NULL AS department_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      WHERE u.role_id = 2
      `,
    );

    const allUserAccounts = [
      ...(students || []),
      ...(deptHeads || []),
      ...(employers || []),
    ].sort((a, b) => {
      // Primary sort by status, secondary sort by last_name
      const statusCompare = a.status.localeCompare(b.status);
      if (statusCompare !== 0) return statusCompare;
      return a.last_name.localeCompare(b.last_name);
    });

    const records = allUserAccounts.length > 0 ? allUserAccounts : null;

    res.status(200).json(records);
  } catch (error) {
    console.error("Get all accounts error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const getRoles = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM roles`);

    const records = rows.length > 0 ? rows : null;
    return res.status(200).json(records);
  } catch (error) {
    console.log("Get roles error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getCourses = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM courses`);

    const records = rows.length > 0 ? rows : [];
    return res.status(200).json(records);
  } catch (error) {
    console.log("Get courses error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getDepartments = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM departments`);

    const records = rows.length > 0 ? rows : [];
    return res.status(200).json(records);
  } catch (error) {
    console.log("Get departments error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const createUser = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;
    const userData = req.body;

    const { email, password, first_name, last_name, course, department, role } =
      userData;

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
      if (!department) {
        return res.status(400).json({
          message: "Department is required for this role.",
        });
      }
    }

    if (roleId === STUDENT) {
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
    const newId = newUUID();

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

    if (roleId === STUDENT) {
      await connection.execute(
        `INSERT INTO student_academic_info (user_id, course_id, department_id) VALUES (?, ?, ?)`,
        [newId, Number(course), Number(department)],
      );
    }

    if (roleId === DEPARTMENT_HEAD) {
      await connection.execute(
        `INSERT INTO dept_heads_background_info (user_id, department_id) VALUES (?, ?)`,
        [newId, Number(department)],
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Create account error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const deactivateAccount = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "Failed to deactivate account or can't find the account.",
      });
    }

    await connection.commit();

    res.status(200).json({
      message: "Account deactivated successfully!",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Deactivate account error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const reactivateAccount = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'active', deleted_at = null WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "Failed to reactivate account or can't find the account.",
      });
    }

    await connection.commit();

    res.status(200).json({
      message: "Account reactivated successfully!", // 👈 Fixed message
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Reactivate account error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
