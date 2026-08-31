import { db } from "../config/db.js";
import {
  getCurrentAcademicYear,
  isRegistrarHeadOrAdmin,
  newUUID,
  verifyRecordAccess,
} from "../config/helpers.js";

export const getAvailableAcademicYears = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const [rows] = await connection.execute(
      `SELECT DISTINCT academic_year
       FROM internship_records_with_ay
       WHERE deleted_at IS NULL AND date_started IS NOT NULL
       ORDER BY academic_year DESC`,
    );

    res.status(200).json(rows.map((r) => r.academic_year));
  } catch (error) {
    console.error("Get available academic years error:", error);
    res.status(500).json({ error: "Failed to load academic years." });
  } finally {
    if (connection) connection.release();
  }
};

export const getHteCompanyList = async (req, res) => {
  let connection;
  try {
    const {
      academicYear = getCurrentAcademicYear(),
      companyKey,
      search,
      page = 1,
      limit = 10,
    } = req.query;

    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return res.status(400).json({
        error: "academicYear must be formatted as YYYY-YYYY (e.g. 2026-2027).",
      });
    }

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can access this report.",
      });
    }

    // --- Single-company detail mode (still used by PDF export re-fetch, if kept) ---
    if (companyKey) {
      const [rows] = await connection.execute(
        `SELECT 
           ir.company_name, ir.company_address,
           ir.date_started, ir.date_ended,
           up.first_name, up.last_name, up.gender,
           c.course_name
         FROM internship_records_with_ay ir
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
         WHERE ir.deleted_at IS NULL
           AND ir.status IN ('ongoing', 'finished')
           AND ir.academic_year = ?
           AND MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) = ?
         ORDER BY up.last_name ASC`,
        [academicYear, companyKey],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: "No records found for this company and academic year.",
        });
      }

      return res.status(200).json({
        academicYear,
        company_name: rows[0].company_name,
        company_address: rows[0].company_address,
        interns: rows.map((r) => ({
          name: `${r.first_name} ${r.last_name}`,
          course: r.course_name,
          gender: r.gender || null,
          date_started: r.date_started,
          date_ended: r.date_ended,
        })),
      });
    }

    // --- Company list mode, with interns + academic_year embedded per company ---
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10));
    const offset = (pageNum - 1) * pageSize;

    const conditions = [
      "ir.deleted_at IS NULL",
      "ir.status IN ('ongoing', 'finished')",
      "ir.academic_year = ?",
    ];
    const params = [academicYear];

    if (search) {
      conditions.push(
        `(
          ir.company_name LIKE ?
          OR EXISTS (
            SELECT 1 FROM user_profiles up_search
            WHERE up_search.user_id = ir.user_id
              AND (
                CONCAT(up_search.first_name, ' ', up_search.last_name) LIKE ?
                OR up_search.first_name LIKE ?
                OR up_search.last_name LIKE ?
              )
          )
        )`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.join(" AND ");

    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM (
         SELECT MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) AS company_key
         FROM internship_records_with_ay ir
         WHERE ${whereClause}
         GROUP BY company_key
       ) AS company_counts`,
      params,
    );

    const [companies] = await connection.execute(
      `SELECT 
         MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) AS company_key,
         ir.company_name,
         ir.company_address,
         COUNT(*) AS intern_count
       FROM internship_records_with_ay ir
       WHERE ${whereClause}
       GROUP BY company_key, ir.company_name, ir.company_address
       ORDER BY ir.company_name ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    if (companies.length === 0) {
      return res.status(200).json({
        academicYear,
        companies: [],
        pagination: {
          page: pageNum,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    }

    // Fetch interns only for the companies on this page — not the whole academic year
    const companyKeys = companies.map((c) => c.company_key);
    const keyPlaceholders = companyKeys.map(() => "?").join(",");

    const [internRows] = await connection.execute(
      `SELECT 
         MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) AS company_key,
         up.first_name, up.last_name, up.gender,
         c.course_name, ir.date_started, ir.date_ended
       FROM internship_records_with_ay ir
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
       WHERE ir.deleted_at IS NULL
         AND ir.status IN ('ongoing', 'finished')
         AND ir.academic_year = ?
         AND MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) IN (${keyPlaceholders})
       ORDER BY up.last_name ASC`,
      [academicYear, ...companyKeys],
    );

    const internsByCompany = {};
    internRows.forEach((r) => {
      if (!internsByCompany[r.company_key])
        internsByCompany[r.company_key] = [];
      internsByCompany[r.company_key].push({
        name: `${r.first_name} ${r.last_name}`,
        course: r.course_name,
        gender: r.gender || null,
        date_started: r.date_started,
        date_ended: r.date_ended,
      });
    });

    const companiesWithInterns = companies.map((c) => ({
      ...c,
      academic_year: academicYear,
      interns: internsByCompany[c.company_key] || [],
    }));

    res.status(200).json({
      academicYear,
      companies: companiesWithInterns,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get HTE company list error:", error);
    res.status(500).json({ error: "Failed to load company list." });
  } finally {
    if (connection) connection.release();
  }
};

export const getHteCompanyReport = async (req, res) => {
  let connection;
  try {
    const { academicYear, companyKey } = req.query;

    if (!academicYear || !/^\d{4}-\d{4}$/.test(academicYear)) {
      return res.status(400).json({
        error:
          "academicYear is required, formatted as YYYY-YYYY (e.g. 2026-2027).",
      });
    }
    if (!companyKey) {
      return res.status(400).json({ error: "companyKey is required." });
    }

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can access this report.",
      });
    }

    const [rows] = await connection.execute(
      `SELECT 
         ir.company_name, ir.company_address,
         ir.date_started, ir.date_ended,
         up.first_name, up.last_name, up.gender,
         c.course_name
       FROM internship_records_with_ay ir
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
       WHERE ir.deleted_at IS NULL
         AND ir.status IN ('ongoing', 'finished')
         AND ir.academic_year = ?
         AND MD5(CONCAT(ROUND(ir.lat, 5), '_', ROUND(ir.lon, 5), '_', LOWER(TRIM(ir.company_name)))) = ?
       ORDER BY up.last_name ASC`,
      [academicYear, companyKey],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No records found for this company and academic year.",
      });
    }

    res.status(200).json({
      academicYear,
      company_name: rows[0].company_name,
      company_address: rows[0].company_address,
      interns: rows.map((r) => ({
        name: `${r.first_name} ${r.last_name}`,
        course: r.course_name,
        gender: r.gender || null,
        date_started: r.date_started,
        date_ended: r.date_ended,
      })),
    });
  } catch (error) {
    console.error("Get HTE company report error:", error);
    res.status(500).json({ error: "Failed to generate company report." });
  } finally {
    if (connection) connection.release();
  }
};

export const getProgramAnnualReports = async (req, res) => {
  let connection;
  try {
    const {
      academicYear = getCurrentAcademicYear(),
      search,
      page = 1,
      limit = 10,
    } = req.query;

    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return res.status(400).json({
        error: "academicYear must be formatted as YYYY-YYYY (e.g. 2026-2027).",
      });
    }

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can access this report.",
      });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10));
    const offset = (pageNum - 1) * pageSize;

    const conditions = ["academic_year = ?"];
    const params = [academicYear];

    if (search) {
      conditions.push("degree_program LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = conditions.join(" AND ");

    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM program_annual_reports WHERE ${whereClause}`,
      params,
    );

    if (total === 0) {
      return res.status(200).json({
        academicYear,
        reports: [],
        pagination: { page: pageNum, limit: pageSize, total: 0, totalPages: 0 },
      });
    }

    const [reports] = await connection.execute(
      `SELECT id, academic_year, degree_program, status, prepared_by, certified_by, submitted_at, updated_at
       FROM program_annual_reports
       WHERE ${whereClause}
       ORDER BY degree_program ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const reportIds = reports.map((r) => r.id);
    const placeholders = reportIds.map(() => "?").join(",");

    const [entryRows] = await connection.execute(
      `SELECT report_id, issue, solution, recommendation
       FROM program_annual_report_entries
       WHERE report_id IN (${placeholders})
       ORDER BY sort_order ASC`,
      reportIds,
    );

    const entriesByReport = {};
    entryRows.forEach((e) => {
      if (!entriesByReport[e.report_id]) entriesByReport[e.report_id] = [];
      entriesByReport[e.report_id].push({
        issue: e.issue,
        solution: e.solution,
        recommendation: e.recommendation,
      });
    });

    const reportsWithEntries = reports.map((r) => ({
      ...r,
      entries: entriesByReport[r.id] || [],
    }));

    res.status(200).json({
      academicYear,
      reports: reportsWithEntries,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get program annual reports error:", error);
    res.status(500).json({ error: "Failed to load program annual reports." });
  } finally {
    if (connection) connection.release();
  }
};

export const getProgramAnnualReportById = async (req, res) => {
  let connection;
  try {
    const { reportId } = req.params;

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can access this report.",
      });
    }

    const [reportRows] = await connection.execute(
      `SELECT * FROM program_annual_reports WHERE id = ?`,
      [reportId],
    );

    if (reportRows.length === 0) {
      return res.status(404).json({ error: "Report not found." });
    }

    const [entries] = await connection.execute(
      `SELECT issue, solution, recommendation FROM program_annual_report_entries 
       WHERE report_id = ? ORDER BY sort_order ASC`,
      [reportId],
    );

    res.status(200).json({ ...reportRows[0], entries });
  } catch (error) {
    console.error("Get program annual report error:", error);
    res.status(500).json({ error: "Failed to load report." });
  } finally {
    if (connection) connection.release();
  }
};

export const saveProgramAnnualReport = async (req, res) => {
  let connection;
  try {
    const { id: userId, role } = req.verifiedUser;
    const {
      academicYear,
      degreeProgram,
      courseId,
      entries,
      preparedBy,
      certifiedBy,
      status,
    } = req.body;

    if (!academicYear || !/^\d{4}-\d{4}$/.test(academicYear)) {
      return res.status(400).json({
        error:
          "academicYear is required, formatted as YYYY-YYYY (e.g. 2026-2027).",
      });
    }
    if (!degreeProgram || !degreeProgram.trim()) {
      return res.status(400).json({ error: "degreeProgram is required." });
    }
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "entries must be an array." });
    }
    if (!["draft", "submitted"].includes(status)) {
      return res
        .status(400)
        .json({ error: "status must be 'draft' or 'submitted'." });
    }
    if (status === "submitted" && (!preparedBy || !preparedBy.trim())) {
      return res
        .status(400)
        .json({ error: "preparedBy is required to submit." });
    }

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can manage this report.",
      });
    }

    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id FROM program_annual_reports 
       WHERE academic_year = ? AND degree_program = ? FOR UPDATE`,
      [academicYear, degreeProgram.trim()],
    );

    const isNewReport = existing.length === 0;
    let reportId;

    if (!isNewReport) {
      reportId = existing[0].id;
      await connection.execute(
        `UPDATE program_annual_reports 
         SET course_id = ?, prepared_by = ?, certified_by = ?, status = ?, 
             submitted_at = IF(? = 'submitted', NOW(), submitted_at)
         WHERE id = ?`,
        [
          courseId || null,
          preparedBy?.trim() || null,
          certifiedBy?.trim() || null,
          status,
          status,
          reportId,
        ],
      );
      await connection.execute(
        `DELETE FROM program_annual_report_entries WHERE report_id = ?`,
        [reportId],
      );
    } else {
      reportId = newUUID();
      await connection.execute(
        `INSERT INTO program_annual_reports 
          (id, academic_year, course_id, degree_program, prepared_by, certified_by, status, created_by, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'submitted', NOW(), NULL))`,
        [
          reportId,
          academicYear,
          courseId || null,
          degreeProgram.trim(),
          preparedBy?.trim() || null,
          certifiedBy?.trim() || null,
          status,
          userId,
          status,
        ],
      );
    }

    const meaningfulEntries = entries.filter(
      (e) => e.issue || e.solution || e.recommendation,
    );
    if (meaningfulEntries.length > 0) {
      const values = meaningfulEntries.map((e, i) => [
        reportId,
        e.issue || null,
        e.solution || null,
        e.recommendation || null,
        i,
      ]);
      await connection.query(
        `INSERT INTO program_annual_report_entries 
          (report_id, issue, solution, recommendation, sort_order) VALUES ?`,
        [values],
      );
    }

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual save. Action name distinguishes
    // a brand-new report from an edit to an existing one; status (draft vs
    // submitted) is carried in the description/metadata either way, since
    // "submitted" is the meaningful registrar-facing event either way.
    try {
      const action = isNewReport
        ? "program_annual_report_created"
        : "program_annual_report_updated";

      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          action,
          "program_annual_reports",
          reportId,
          `${isNewReport ? "Created" : "Updated"} the ${degreeProgram.trim()} annual report for ${academicYear} (status: ${status}).`,
          JSON.stringify({
            academic_year: academicYear,
            degree_program: degreeProgram.trim(),
            status,
            entry_count: meaningfulEntries.length,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (program annual report saved):",
        logError,
      );
    }

    await connection.commit();

    const [report] = await connection.execute(
      `SELECT * FROM program_annual_reports WHERE id = ?`,
      [reportId],
    );
    const [savedEntries] = await connection.execute(
      `SELECT issue, solution, recommendation FROM program_annual_report_entries 
       WHERE report_id = ? ORDER BY sort_order ASC`,
      [reportId],
    );

    res.status(200).json({
      success: true,
      message: status === "submitted" ? "Report submitted." : "Draft saved.",
      report: { ...report[0], entries: savedEntries },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Save program annual report error:", error);
    res.status(500).json({ error: "Failed to save program annual report." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteProgramAnnualReport = async (req, res) => {
  let connection;
  try {
    const { reportId } = req.params;

    connection = await db.getConnection();

    const authorized = await isRegistrarHeadOrAdmin(
      connection,
      req.verifiedUser,
    );
    if (!authorized) {
      return res.status(403).json({
        error:
          "Only the Registrar department head or admin can manage this report.",
      });
    }

    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id, academic_year, degree_program FROM program_annual_reports WHERE id = ? FOR UPDATE`,
      [reportId],
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Report not found." });
    }

    // entries cascade-delete automatically via ON DELETE CASCADE
    await connection.execute(
      `DELETE FROM program_annual_reports WHERE id = ?`,
      [reportId],
    );

    // Activity log is supplementary — isolated so a logging failure can
    // never roll back or fail the actual deletion.
    try {
      const { id: userId, role } = req.verifiedUser;
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "program_annual_report_deleted",
          "program_annual_reports",
          reportId,
          `Deleted the ${existing[0].degree_program} annual report for ${existing[0].academic_year}.`,
          JSON.stringify({
            academic_year: existing[0].academic_year,
            degree_program: existing[0].degree_program,
          }),
        ],
      );
    } catch (logError) {
      console.error(
        "Activity log insert failed (program annual report deleted):",
        logError,
      );
    }

    await connection.commit();

    res.status(200).json({ success: true, message: "Report deleted." });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete program annual report error:", error);
    res.status(500).json({ error: "Failed to delete report." });
  } finally {
    if (connection) connection.release();
  }
};
