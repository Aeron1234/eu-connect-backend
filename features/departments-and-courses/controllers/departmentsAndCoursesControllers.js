import { reportError } from "../../../config/errorTracking.js";
import { invalidateDashboardCache } from "../../../config/cache/dashboardCache.js";
import { db } from "../../../config/db.js";
import { invalidateRouteCache } from "../../../config/cache/cache.js";

// Use only the fixed table names supplied by this module. Clear every user's
// list variants and the account form after the database transaction commits.
function invalidateLookupCache(tableName) {
  invalidateDashboardCache();
  invalidateRouteCache(`/eu-connect/api/${tableName}`);
  invalidateRouteCache("/eu-connect/api/create-account-form-data");
}

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
    invalidateLookupCache("departments");

    const [rows] = await connection.execute(
      `SELECT * FROM departments WHERE id = ?`,
      [result.insertId],
    );

    res.status(201).json({ success: true, department: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Add department error:", error);
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
    invalidateLookupCache("courses");

    const [rows] = await connection.execute(
      `SELECT * FROM courses WHERE id = ?`,
      [result.insertId],
    );

    res.status(201).json({ success: true, course: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Add course error:", error);
    res.status(500).json({ error: "Failed to add course." });
  } finally {
    if (connection) connection.release();
  }
};

export const updateDepartment = async (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !code) {
    return res.status(400).json({ error: "A valid department, name, and code are required." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT id FROM departments WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Department not found." });
    }
    const [duplicates] = await connection.execute("SELECT id FROM departments WHERE code = ? AND id <> ?", [code, id]);
    if (duplicates.length) {
      await connection.rollback();
      return res.status(409).json({ error: `A department with code "${code}" already exists.` });
    }
    await connection.execute("UPDATE departments SET name = ?, code = ? WHERE id = ?", [name, code, id]);
    await connection.commit();
    invalidateLookupCache("departments");
    const [updated] = await connection.execute("SELECT * FROM departments WHERE id = ?", [id]);
    return res.json({ success: true, department: updated[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Update department error:", error);
    return res.status(500).json({ error: "Failed to update department." });
  } finally {
    connection?.release();
  }
};

export const updateCourse = async (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.course_name === "string" ? req.body.course_name.trim() : "";
  const code = typeof req.body?.short_name === "string" ? req.body.short_name.trim() : "";
  const departmentId = Number(req.body?.department_id);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !code || !Number.isSafeInteger(departmentId) || departmentId <= 0) {
    return res.status(400).json({ error: "A valid course, name, code, and department are required." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT id FROM courses WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Course not found." });
    }
    const [departments] = await connection.execute("SELECT id FROM departments WHERE id = ?", [departmentId]);
    if (!departments.length) {
      await connection.rollback();
      return res.status(400).json({ error: "Selected department does not exist." });
    }
    const [duplicates] = await connection.execute("SELECT id FROM courses WHERE short_name = ? AND id <> ?", [code, id]);
    if (duplicates.length) {
      await connection.rollback();
      return res.status(409).json({ error: `A course with code "${code}" already exists.` });
    }
    await connection.execute("UPDATE courses SET course_name = ?, short_name = ?, department_id = ? WHERE id = ?", [name, code, departmentId, id]);
    await connection.commit();
    invalidateLookupCache("courses");
    const [updated] = await connection.execute("SELECT * FROM courses WHERE id = ?", [id]);
    return res.json({ success: true, course: updated[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Update course error:", error);
    return res.status(500).json({ error: "Failed to update course." });
  } finally {
    connection?.release();
  }
};

function createLookupTableEndpoints(tableName, label) {
  const getActive = async (req, res) => {
    try {
      const includeInactive =
        req.verifiedUser?.role === "admin" &&
        req.query?.includeInactive === "true";
      const [rows] = await db.execute(
        `SELECT * FROM ${tableName}${includeInactive ? "" : " WHERE is_active = 1"}`,
      );
      res.status(200).json(rows);
    } catch (error) {
      reportError(`Get ${tableName} error:`, error);
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
      invalidateLookupCache(tableName);

      res.status(200).json({
        success: true,
        message: `${label} ${isActive ? "activated" : "deactivated"}.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Set ${tableName} active status error:`, error);
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
