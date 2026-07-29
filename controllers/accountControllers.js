import { db } from "../config/db.js";
import bcrypt from "bcryptjs";
import { newUUID } from "../config/helpers.js";

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
    console.log("Get user profile error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
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
