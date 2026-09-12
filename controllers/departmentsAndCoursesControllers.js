import { db } from "../config/db.js";

export const addDepartment = async (req, res) => {
  let connection;
  try {
    const { name, code } = req.body ?? {};

    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({ error: "name and code are required." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id FROM departments WHERE code = ? FOR UPDATE`,
      [code.trim()],
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: `A department with code "${code.trim()}" already exists.`,
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO departments (code, name, is_active) VALUES (?, ?, 1)`,
      [code.trim(), name.trim()],
    );

    await connection.commit();

    const [rows] = await connection.execute(
      `SELECT * FROM departments WHERE id = ?`,
      [result.insertId],
    );

    res.status(201).json({ success: true, department: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Add department error:", error);
    res.status(500).json({ error: "Failed to add department." });
  } finally {
    if (connection) connection.release();
  }
};

export const addCourse = async (req, res) => {
  let connection;
  try {
    const { course_name, short_name, department_id } = req.body ?? {};

    if (!course_name?.trim() || !short_name?.trim() || !department_id) {
      return res.status(400).json({
        error: "course_name, short_name, and department_id are required.",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [deptRows] = await connection.execute(
      `SELECT id FROM departments WHERE id = ?`,
      [department_id],
    );
    if (deptRows.length === 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "Selected department does not exist." });
    }

    const [existing] = await connection.execute(
      `SELECT id FROM courses WHERE short_name = ? FOR UPDATE`,
      [short_name.trim()],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: `A course with code "${short_name.trim()}" already exists.`,
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO courses (course_name, short_name, department_id, is_active) VALUES (?, ?, ?, 1)`,
      [course_name.trim(), short_name.trim(), department_id],
    );

    await connection.commit();

    const [rows] = await connection.execute(
      `SELECT * FROM courses WHERE id = ?`,
      [result.insertId],
    );

    res.status(201).json({ success: true, course: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Add course error:", error);
    res.status(500).json({ error: "Failed to add course." });
  } finally {
    if (connection) connection.release();
  }
};

function createLookupTableEndpoints(tableName, label) {
  const getActive = async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT * FROM ${tableName} WHERE is_active = 1`,
      );
      res.status(200).json(rows);
    } catch (error) {
      console.error(`Get ${tableName} error:`, error);
      res.status(500).json({ error: "Database query failed", success: false });
    }
  };

  const setActiveStatus = (isActive) => async (req, res) => {
    let connection;
    try {
      const { id } = req.params;

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id, is_active FROM ${tableName} WHERE id = ? FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: `${label} not found.` });
      }

      if (rows[0].is_active === isActive) {
        await connection.rollback();
        return res.status(400).json({
          error: `${label} is already ${isActive ? "active" : "inactive"}.`,
        });
      }

      await connection.execute(
        `UPDATE ${tableName} SET is_active = ? WHERE id = ?`,
        [isActive, id],
      );

      await connection.commit();

      res.status(200).json({
        success: true,
        message: `${label} ${isActive ? "activated" : "deactivated"}.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Set ${tableName} active status error:`, error);
      res.status(500).json({ error: "Database query failed", success: false });
    } finally {
      if (connection) connection.release();
    }
  };

  return {
    getActive,
    deactivate: setActiveStatus(0),
    activate: setActiveStatus(1),
  };
}

export const {
  getActive: getCourses,
  deactivate: deactivateCourse,
  activate: activateCourse,
} = createLookupTableEndpoints("courses", "Course");

export const {
  getActive: getDepartments,
  deactivate: deactivateDepartment,
  activate: activateDepartment,
} = createLookupTableEndpoints("departments", "Department");
