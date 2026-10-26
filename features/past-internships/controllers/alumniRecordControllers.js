import { activityLogRoleName } from "../../../config/activityLogMessages.js";
import { reportError } from "../../../config/errorTracking.js";
import { invalidateAlumniCache } from "../../../config/cache/alumniCache.js";
import { invalidateActivityLogsCache } from "../../../config/cache/activityLogsCache.js";
import { db } from "../../../config/db.js";
import { newUUID } from "../../../config/helpers.js";

export const addAlumniInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { id: enteredBy, role } = req.verifiedUser;
    const {
      alumni_name,
      company_name,
      company_address,
      industry,
      internship_position,
      course_id,
      batch_year,
      academic_year,
      total_hours,
      accumulated_hours,
      supervisor_name,
      notes,
    } = req.body;

    // Require identity, company details, course, batch and academic year. Position,
    // hours, supervisor and notes remain optional and are stored as null when omitted.
    const required = {
      alumni_name,
      company_name,
      company_address,
      industry,
      course_id,
      batch_year,
      academic_year,
    };

    for (const [field, value] of Object.entries(required)) {
      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
      ) {
        return res
          .status(400)
          .json({ error: `${field.replace(/_/g, " ")} is required.` });
      }
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    let departmentId = null;
    if (role === "department_head") {
      const [deptHeadRow] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [enteredBy],
      );
      departmentId =
        deptHeadRow.length > 0 ? deptHeadRow[0].department_id : null;
    }

    const recordId = newUUID();
    await connection.execute(
      `INSERT INTO alumni_internship_records 
        (id, entered_by, alumni_name, company_name, company_address, industry, 
         internship_position, course_id, batch_year, academic_year, 
         total_hours, accumulated_hours, supervisor_name, notes, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recordId,
        enteredBy,
        alumni_name.trim(),
        company_name.trim(),
        company_address.trim(),
        industry.trim(),
        internship_position?.trim() || null,
        course_id,
        batch_year,
        academic_year,
        total_hours !== undefined && total_hours !== ""
          ? Number(total_hours)
          : null,
        accumulated_hours !== undefined && accumulated_hours !== ""
          ? Number(accumulated_hours)
          : null,
        supervisor_name?.trim() || null,
        notes?.trim() || null,
        departmentId,
      ],
    );

    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          enteredBy,
          role,
          "alumni_internship_record_created",
          "alumni_internship_records",
          recordId,
          `${role === "admin" ? "Admin" : "Department head"} manually added an alumni record for ${alumni_name.trim()} (${company_name.trim()}).`,
          JSON.stringify({
            alumni_name: alumni_name.trim(),
            company_name: company_name.trim(),
            course_id,
            batch_year,
            academic_year,
            department_id: departmentId,
            source: "manual",
          }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (alumni record created):",
        logError,
      );
    }

    await connection.commit();
    invalidateAlumniCache();

    invalidateActivityLogsCache();

    res.status(201).json({ success: true, id: recordId });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Add alumni internship record error:", error);
    res.status(500).json({ error: "Failed to save alumni record." });
  } finally {
    if (connection) connection.release();
  }
};

export const updateAlumniInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { id: userId, role } = req.verifiedUser;
    const { recordId } = req.params;
    const {
      alumni_name,
      company_name,
      company_address,
      industry,
      internship_position,
      course_id,
      batch_year,
      academic_year,
      total_hours,
      accumulated_hours,
      supervisor_name,
      notes,
    } = req.body;

    if (!["department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id, department_id FROM alumni_internship_records WHERE id = ? FOR UPDATE`,
      [recordId],
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Alumni record not found." });
    }

    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );

      const recordDeptId = existing[0].department_id;

      if (
        deptHeadRows.length === 0 ||
        recordDeptId === null ||
        deptHeadRows[0].department_id !== recordDeptId
      ) {
        await connection.rollback();
        return res.status(403).json({
          error: "You can only edit records within your own department.",
        });
      }
    }

    const fieldMap = {
      alumni_name,
      company_name,
      company_address,
      industry,
      internship_position,
      course_id,
      batch_year,
      academic_year,
      total_hours: total_hours !== undefined ? Number(total_hours) : undefined,
      accumulated_hours:
        accumulated_hours !== undefined ? Number(accumulated_hours) : undefined,
      supervisor_name,
      notes,
    };

    const setClauses = [];
    const setValues = [];

    for (const [column, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        setClauses.push(`${column} = ?`);
        setValues.push(value);
      }
    }

    if (setClauses.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: "No fields provided to update." });
    }

    await connection.execute(
      `UPDATE alumni_internship_records SET ${setClauses.join(", ")} WHERE id = ?`,
      [...setValues, recordId],
    );

    const [updated] = await connection.execute(
      `SELECT * FROM alumni_internship_records WHERE id = ?`,
      [recordId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual update. Only field names are
    // retained in metadata for the update-details view; the current row is the
    // source of truth for "what it is now."
    try {
      const changedFields = Object.keys(fieldMap).filter(
        (key) => fieldMap[key] !== undefined,
      );

      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "alumni_internship_record_updated",
          "alumni_internship_records",
          recordId,
          `${activityLogRoleName(role)} updated the alumni internship record for ${updated[0].alumni_name} at ${updated[0].company_name}.`,
          JSON.stringify({ changed_fields: changedFields, alumni_name: updated[0].alumni_name, company_name: updated[0].company_name }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (alumni record updated):",
        logError,
      );
    }

    await connection.commit();
    invalidateAlumniCache();

    invalidateActivityLogsCache();

    res.status(200).json({
      success: true,
      message: "Alumni record updated.",
      record: updated[0],
    });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Update alumni internship record error:", error);
    res.status(500).json({ error: "Failed to update alumni record." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteAlumniInternshipRecord = async (req, res) => {
  let connection;
  try {
    const { id: userId, role } = req.verifiedUser;
    const { recordId } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT department_id, alumni_name, company_name FROM alumni_internship_records WHERE id = ? FOR UPDATE`,
      [recordId],
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Alumni record not found." });
    }

    if (role === "department_head") {
      const [deptHeadRows] = await connection.execute(
        `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
        [userId],
      );

      const recordDeptId = existing[0].department_id;

      if (
        deptHeadRows.length === 0 ||
        recordDeptId === null ||
        deptHeadRows[0].department_id !== recordDeptId
      ) {
        await connection.rollback();
        return res.status(403).json({
          error: "You can only delete records within your own department.",
        });
      }
    }

    const [result] = await connection.execute(
      `DELETE FROM alumni_internship_records WHERE id = ?`,
      [recordId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Alumni record not found." });
    }

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual deletion. This is the most
    // destructive action available on this table, so worth capturing
    // the department scope at time of deletion.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "alumni_internship_record_deleted",
          "alumni_internship_records",
          recordId,
          `${role === "admin" ? "Admin" : "Department head"} deleted the alumni record for ${existing[0].alumni_name} at ${existing[0].company_name}.`,
          JSON.stringify({ department_id: existing[0].department_id }),
        ],
      );
    } catch (logError) {
      reportError(
        "Activity log insert failed (alumni record deleted):",
        logError,
      );
    }

    await connection.commit();
    invalidateAlumniCache();

    invalidateActivityLogsCache();

    res.status(200).json({ success: true, message: "Alumni record deleted." });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Delete alumni internship record error:", error);
    res.status(500).json({ error: "Failed to delete alumni record." });
  } finally {
    if (connection) connection.release();
  }
};

// Read the alumni archive table, not the student's live/personal record history.
// Paginate normalized company groups; totals count companies rather than alumni.
export const getAlumniInternships = async (req, res) => {
  let connection;
  try {
    const { academicYear, departmentId, search, page = 1, limit = 10 } = req.query;
    if (departmentId && departmentId !== "all" &&
        (typeof departmentId !== "string" || !/^[1-9]\d*$/.test(departmentId) || !Number.isSafeInteger(Number(departmentId)))) {
      return res.status(400).json({ error: "Invalid department filter." });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10));
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (academicYear && academicYear !== "all") {
      conditions.push("air.academic_year = ?");
      params.push(academicYear);
    }

    if (departmentId && departmentId !== "all") {
      conditions.push("air.department_id = ?");
      params.push(departmentId);
    }

    if (search) {
      conditions.push("(air.company_name LIKE ? OR air.alumni_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // Combine academic year, saved department and name/company search with AND.
    // Apply the same conditions to company selection and its returned alumni rows.
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    connection = await db.getConnection();

    const [yearRows] = await connection.execute(
      `SELECT DISTINCT academic_year
       FROM alumni_internship_records
       WHERE academic_year IS NOT NULL
       ORDER BY academic_year DESC`,
    );
    const academicYears = yearRows.map((r) => r.academic_year);
    // Keep choices available even when the current filters match no companies,
    // including departments that have historical records but are now inactive.
    const [departments] = await connection.execute(
      `SELECT DISTINCT d.id, d.name, d.code
       FROM alumni_internship_records air
       INNER JOIN departments d ON air.department_id = d.id
       ORDER BY d.name ASC`,
    );

    const [companyPage] = await connection.execute(
      `SELECT LOWER(TRIM(air.company_name)) AS normalized_name,
              MIN(air.company_name) AS company_name,
              COUNT(*) OVER() AS total
       FROM alumni_internship_records air
       ${whereClause}
       GROUP BY LOWER(TRIM(air.company_name))
       ORDER BY company_name ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    if (companyPage.length === 0) {
      // A page beyond the end has no window row to carry the total. Keep the
      // original distinct-company count for this uncommon case.
      const [[{ total }]] = await connection.execute(
        `SELECT COUNT(DISTINCT LOWER(TRIM(air.company_name))) AS total
         FROM alumni_internship_records air
         ${whereClause}`,
        params,
      );
      return res.status(200).json({
        data: [],
        academicYears,
        departments,
        pagination: {
          page: pageNum,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    }

    const total = companyPage[0].total;

    // Group by trimmed lowercase company name only. Addresses/branches with the same
    // normalized name share a group; this differs from Annex D's coordinate-based key.
    const normalizedNames = companyPage.map((c) => c.normalized_name);
    const placeholders = normalizedNames.map(() => "?").join(",");

    // This list returns only fields used by company/alumni rows. Optional position,
    // hours, supervisor and notes remain stored but are absent from this response.
    const [rows] = await connection.execute(
      `SELECT air.id, air.alumni_name, air.company_name, air.company_address,
              air.industry, air.course_id, air.batch_year, air.academic_year,
              c.course_name, d.id AS department_id, d.code AS department_code,
              d.name AS department_name
       FROM alumni_internship_records air
       LEFT JOIN courses c ON air.course_id = c.id
       LEFT JOIN departments d ON air.department_id = d.id
       WHERE LOWER(TRIM(air.company_name)) IN (${placeholders})${conditions.length ? " AND " + conditions.join(" AND ") : ""}
       ORDER BY air.company_name ASC, air.alumni_name ASC`,
      [...normalizedNames, ...params],
    );

    const groups = {};

    rows.forEach((row) => {
      const normalized = row.company_name.trim().toLowerCase();
      if (!groups[normalized]) {
        groups[normalized] = {
          company_name: row.company_name,
          company_address: row.company_address,
          industry: row.industry,
          alumni: [],
        };
      }

      groups[normalized].alumni.push({
        id: row.id,
        alumni_name: row.alumni_name,
        course_name: row.course_name,
        course_id: row.course_id,
        batch_year: row.batch_year,
        academic_year: row.academic_year,
        department_id: row.department_id,
        department_code: row.department_code,
        department_name: row.department_name,
      });
    });

    const companies = companyPage.map((c) => {
      const group = groups[c.normalized_name];
      return { ...group, alumni_count: group.alumni.length };
    });

    return res.status(200).json({
      data: companies,
      academicYears,
      departments,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    reportError("Get alumni internships error:", error);
    res.status(500).json({ error: "Failed to load alumni internships." });
  } finally {
    if (connection) connection.release();
  }
};

export const getCompanyDirectory = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    // Fold each source before loading the next one. First-seen spelling and
    // course insertion order are part of the existing response.
    const directory = {};
    function addEntry(companyName, courseName) {
      const normalized = companyName.trim().toLowerCase();
      if (!directory[normalized]) {
        directory[normalized] = {
          company_name: companyName,
          intern_count: 0,
          courses: new Set(),
        };
      }
      directory[normalized].intern_count += 1;
      if (courseName) directory[normalized].courses.add(courseName);
    }

    // 1. Real students — current and past, any branch/location
    let [realRows] = await connection.execute(
      `SELECT ir.company_name, c.course_name
       FROM internship_records ir
       INNER JOIN (
         SELECT sai1.user_id, sai1.course_id
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses c ON sai.course_id = c.id
       WHERE ir.deleted_at IS NULL AND ir.status IN ('ongoing', 'finished')`,
    );

    realRows.forEach((r) => addEntry(r.company_name, r.course_name));
    realRows = null;

    // 2. Manually-entered alumni
    let [alumniRows] = await connection.execute(
      `SELECT air.company_name, c.course_name
       FROM alumni_internship_records air
       LEFT JOIN courses c ON air.course_id = c.id`,
    );

    alumniRows.forEach((r) => addEntry(r.company_name, r.course_name));
    alumniRows = null;

    const companies = Object.values(directory)
      .map((c) => ({
        company_name: c.company_name,
        intern_count: c.intern_count,
        courses: Array.from(c.courses),
      }))
      .sort((a, b) => b.intern_count - a.intern_count); // popularity order

    res.status(200).json(companies);
  } catch (error) {
    reportError("Get company directory error:", error);
    res.status(500).json({ error: "Failed to load company directory." });
  } finally {
    if (connection) connection.release();
  }
};
