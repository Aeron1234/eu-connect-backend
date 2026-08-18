import { db } from "../config/db.js";
import { newUUID } from "../config/helpers.js";

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

    const required = {
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

    // Department is derived from whoever is submitting the record.
    // department_heads get their own department; admins (who have no
    // dept_heads_background_info row) leave it NULL — a department-less
    // record that only an admin can later manage.
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
        internship_position.trim(),
        course_id,
        batch_year,
        academic_year,
        Number(total_hours),
        Number(accumulated_hours),
        supervisor_name?.trim() || null,
        notes?.trim() || null,
        departmentId,
      ],
    );

    res.status(201).json({ success: true, id: recordId });
  } catch (error) {
    console.error("Add alumni internship record error:", error);
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

    const [existing] = await connection.execute(
      `SELECT id, department_id FROM alumni_internship_records WHERE id = ?`,
      [recordId],
    );

    if (existing.length === 0) {
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
      return res.status(400).json({ error: "No fields provided to update." });
    }

    await connection.execute(
      `UPDATE alumni_internship_records SET ${setClauses.join(", ")} WHERE id = ?`,
      [...setValues, recordId],
    );

    res.status(200).json({ success: true, message: "Alumni record updated." });
  } catch (error) {
    console.error("Update alumni internship record error:", error);
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

    if (!["department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied." });
    }

    connection = await db.getConnection();

    const [existing] = await connection.execute(
      `SELECT department_id FROM alumni_internship_records WHERE id = ?`,
      [recordId],
    );

    if (existing.length === 0) {
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
      return res.status(404).json({ error: "Alumni record not found." });
    }

    res.status(200).json({ success: true, message: "Alumni record deleted." });
  } catch (error) {
    console.error("Delete alumni internship record error:", error);
    res.status(500).json({ error: "Failed to delete alumni record." });
  } finally {
    if (connection) connection.release();
  }
};

export const getAlumniInternships = async (req, res) => {
  let connection;
  try {
    const { academicYear, search, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10)); // cap to avoid abuse
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (academicYear && academicYear !== "all") {
      conditions.push("air.academic_year = ?");
      params.push(academicYear);
    }

    if (search) {
      conditions.push("(air.company_name LIKE ? OR air.alumni_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    connection = await db.getConnection();

    // Distinct academic years available across ALL records — used to render
    // filter tabs. Deliberately ignores the current academicYear/search
    // filters so the tab list itself stays stable while the user filters.
    const [yearRows] = await connection.execute(
      `SELECT DISTINCT academic_year
       FROM alumni_internship_records
       WHERE academic_year IS NOT NULL
       ORDER BY academic_year DESC`,
    );
    const academicYears = yearRows.map((r) => r.academic_year);

    // Total distinct companies (case/whitespace-insensitive) for pagination metadata
    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(DISTINCT LOWER(TRIM(air.company_name))) AS total
       FROM alumni_internship_records air
       ${whereClause}`,
      params,
    );

    if (total === 0) {
      return res.status(200).json({
        data: [],
        academicYears,
        pagination: { page: pageNum, limit: pageSize, total: 0, totalPages: 0 },
      });
    }

    // Page of distinct companies, ordered by display name.
    // Note: this SELECTs companies matching the WHERE clause (which now
    // includes alumni_name), so a company page can include a company where
    // ONLY one alumnus (not the company name) matched the search term.
    const [companyPage] = await connection.execute(
      `SELECT LOWER(TRIM(air.company_name)) AS normalized_name,
              MIN(air.company_name) AS company_name
       FROM alumni_internship_records air
       ${whereClause}
       GROUP BY LOWER(TRIM(air.company_name))
       ORDER BY company_name ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const normalizedNames = companyPage.map((c) => c.normalized_name);
    const placeholders = normalizedNames.map(() => "?").join(",");

    // All alumni rows belonging to just this page's companies.
    // Deliberately NOT re-applying the search filter here — once a company
    // matches (by name or by having a matching alumnus), we want to show
    // ALL of its alumni, not just the one(s) that matched the search term.
    const [rows] = await connection.execute(
      `SELECT air.*, c.course_name
       FROM alumni_internship_records air
       LEFT JOIN courses c ON air.course_id = c.id
       WHERE LOWER(TRIM(air.company_name)) IN (${placeholders})
       ORDER BY air.company_name ASC, air.alumni_name ASC`,
      normalizedNames,
    );

    const groups = {};

    rows.forEach((row) => {
      const normalized = row.company_name.trim().toLowerCase();
      if (!groups[normalized]) {
        groups[normalized] = {
          company_name: row.company_name, // first-seen casing wins for display
          company_address: row.company_address,
          industry: row.industry,
          alumni: [],
        };
      }

      groups[normalized].alumni.push({
        id: row.id,
        alumni_name: row.alumni_name,
        course_name: row.course_name,
        batch_year: row.batch_year,
        internship_position: row.internship_position,
        supervisor_name: row.supervisor_name,
        total_hours: row.total_hours,
        accumulated_hours: row.accumulated_hours,
        academic_year: row.academic_year,
        notes: row.notes,
        source: row.source,
      });
    });

    // Preserve companyPage's ORDER BY — object key order from `groups`
    // isn't guaranteed to match once you're mixing two separate queries
    const companies = companyPage.map((c) => {
      const group = groups[c.normalized_name];
      return { ...group, alumni_count: group.alumni.length };
    });

    return res.status(200).json({
      data: companies,
      academicYears,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get alumni internships error:", error);
    res.status(500).json({ error: "Failed to load alumni internships." });
  } finally {
    if (connection) connection.release();
  }
};

export const getCompanyDirectory = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    // 1. Real students — current and past, any branch/location
    const [realRows] = await connection.execute(
      `SELECT ir.company_name, c.course_name
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
       INNER JOIN courses c ON sai.course_id = c.id
       WHERE ir.deleted_at IS NULL AND ir.status IN ('ongoing', 'finished')`,
    );

    // 2. Manually-entered alumni
    const [alumniRows] = await connection.execute(
      `SELECT air.company_name, c.course_name
       FROM alumni_internship_records air
       LEFT JOIN courses c ON air.course_id = c.id`,
    );

    // Merge both sources under one normalized company key
    const directory = {};

    function addEntry(companyName, courseName) {
      const normalized = companyName.trim().toLowerCase();
      if (!directory[normalized]) {
        directory[normalized] = {
          company_name: companyName, // first-seen casing wins for display
          intern_count: 0,
          courses: new Set(),
        };
      }
      directory[normalized].intern_count += 1;
      if (courseName) directory[normalized].courses.add(courseName);
    }

    realRows.forEach((r) => addEntry(r.company_name, r.course_name));
    alumniRows.forEach((r) => addEntry(r.company_name, r.course_name));

    const companies = Object.values(directory)
      .map((c) => ({
        company_name: c.company_name,
        intern_count: c.intern_count,
        courses: Array.from(c.courses),
      }))
      .sort((a, b) => b.intern_count - a.intern_count); // popularity order

    res.status(200).json(companies);
  } catch (error) {
    console.error("Get company directory error:", error);
    res.status(500).json({ error: "Failed to load company directory." });
  } finally {
    if (connection) connection.release();
  }
};
