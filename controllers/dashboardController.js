import { reportError } from "../config/errorTracking.js";
import { db } from "../config/db.js";

///////////////////
//STUDENT
//////////////////
export const getStudentDashboardStats = async (req, res) => {
  let connection;
  try {
    // 1. Acquire a dedicated connection from the pool
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;

    // Independent scalar counts keep each table's original filter while using
    // one database statement instead of four queued commands.
    const [[counts]] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM internship_favorites
          WHERE student_id = ? AND favorited_at IS NOT NULL) AS favorite_count,
         (SELECT COUNT(*) FROM notifications
          WHERE user_id = ? AND type = 'announcement' AND is_read = 0) AS announcement_count,
         (SELECT COUNT(*)
          FROM student_evaluation_masters AS sem
          INNER JOIN internship_records AS ir ON sem.internship_record_id = ir.id
          WHERE ir.user_id = ? AND sem.status = 'pending') AS evaluation_count,
         (SELECT COUNT(*) FROM internship_documents
          WHERE user_id = ?) AS document_count`,
      [userId, userId, userId, userId],
    );

    // 3. Send back the aggregated metrics
    res.status(200).json({
      success: true,
      stats: {
        favoriteInternships: counts.favorite_count || 0,
        unreadAnnouncements: counts.announcement_count || 0,
        pendingEvaluations: counts.evaluation_count || 0,
        documentsStored: counts.document_count || 0,
      },
    });
  } catch (error) {
    reportError("Failed to retrieve student dashboard statistics:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    // 4. Always release the connection back to the pool, even if a query throws an error
    if (connection) connection.release();
  }
};

export const getStudentDashboardData = async (req, res) => {
  let connection;
  try {
    const { id: userId } = req.verifiedUser;
    connection = await db.getConnection();

    let internshipData = null;
    try {
      const [rows] = await connection.execute(
        `SELECT * FROM internship_records
         WHERE user_id = ? AND deleted_at IS NULL
           AND (status = 'ongoing' OR status = 'pending')
         ORDER BY (status = 'ongoing') DESC, created_at DESC
         LIMIT 1`,
        [userId],
      );
      internshipData = rows.length > 0 ? rows[0] : null;
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getStudentDashboardData: active internship query failed:",
        err,
      );
    }

    const internshipId = internshipData?.id || null;
    const isOngoing = internshipData?.status === "ongoing";

    let dtrToday = null;
    let dtrStatus = { status: "CLOCKED_OUT", record: null };
    let location = {};

    if (internshipId && isOngoing) {
      // Today's DTR
      try {
        const [todayRows] = await connection.execute(
          `SELECT id, clock_in, clock_out, created_at, status 
           FROM daily_time_records 
           WHERE user_id = ? AND created_at >= CURDATE()
             AND created_at < CURDATE() + INTERVAL 1 DAY AND internship_id = ?
           LIMIT 1`,
          [userId, internshipId],
        );
        dtrToday = todayRows.length > 0 ? todayRows[0] : null;
      } catch (err) {
      res.locals.skipCache = true;
        reportError(
          "getStudentDashboardData: today's DTR query failed:",
          err,
        );
      }

      // Latest clock-in/out status
      try {
        const [statusRows] = await connection.execute(
          `SELECT id, clock_in, clock_out, status
           FROM daily_time_records 
           WHERE user_id = ? AND internship_id = ? 
           ORDER BY id DESC 
           LIMIT 1`,
          [userId, internshipId],
        );
        if (statusRows.length === 0) {
          dtrStatus = { status: "CLOCKED_OUT", record: null };
        } else {
          const lastRecord = statusRows[0];
          dtrStatus =
            lastRecord.clock_in != null && lastRecord.clock_out === null
              ? {
                  status: lastRecord.status === "on-break" ? "ON_BREAK" : "CLOCKED_IN",
                  record: lastRecord,
                }
              : { status: "CLOCKED_OUT", record: lastRecord };
        }
      } catch (err) {
      res.locals.skipCache = true;
        reportError(
          "getStudentDashboardData: latest DTR status query failed:",
          err,
        );
      }

      // DTR location
      try {
        const [locRows] = await connection.execute(
          `SELECT 
             ir.id AS internship_id,
             ir.lat AS company_lat,
             ir.lon AS company_lon,
             dl.id AS dtr_location_id,
             dl.set_by,
             dl.lat AS dtr_lat,
             dl.lon AS dtr_lon,
             dl.radius_meters,
             dl.address,
             dl.label,
             dl.created_at AS dtr_created_at,
             dl.updated_at AS dtr_updated_at
           FROM internship_records AS ir
           LEFT JOIN dtr_locations AS dl ON ir.id = dl.internship_id
           WHERE ir.user_id = ? AND ir.status = 'ongoing' AND ir.id = ?
           LIMIT 1`,
          [userId, internshipId],
        );

        if (locRows.length > 0) {
          const record = locRows[0];
          const isCustom = record.dtr_location_id !== null;

          location = {
            lat: isCustom ? record.dtr_lat : record.company_lat,
            lon: isCustom ? record.dtr_lon : record.company_lon,
            radius_meters: isCustom ? record.radius_meters : 150,
            label: isCustom ? record.label : "Company address (default)",
            address: isCustom ? record.address : null,
            set_by: isCustom ? record.set_by : null,
            created_at: isCustom ? record.dtr_created_at : null,
            updated_at: isCustom ? record.dtr_updated_at : null,
          };
        }
      } catch (err) {
      res.locals.skipCache = true;
        reportError(
          "getStudentDashboardData: DTR location query failed:",
          err,
        );
      }
    }

    return res.status(200).json({
      success: true,
      internshipData,
      dtrToday,
      dtrStatus,
      location,
    });
  } catch (error) {
    reportError("Failed to retrieve student dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};
///////////////////
//EMPLOYER
//////////////////
async function loadEmployerDashboardStats(connection, employerId) {

    // Count both intern states in one employer-scoped scan. The other counters
    // are independent scalar subqueries in the same statement.
    const [[counts]] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM internship_postings
          WHERE employer_id = ? AND deleted_at IS NULL) AS posting_count,
         (SELECT COUNT(*) FROM notifications
          WHERE user_id = ? AND type = 'announcement' AND is_read = 0) AS announcement_count,
         intern_counts.ongoing_count,
         intern_counts.finished_count,
         (SELECT COUNT(*) FROM internship_documents
          WHERE uploaded_by_id = ? AND uploaded_by_role = 'employer') AS document_count
       FROM (
         SELECT COUNT(CASE WHEN status = 'ongoing' THEN 1 END) AS ongoing_count,
                COUNT(CASE WHEN status = 'finished' THEN 1 END) AS finished_count
         FROM internship_records
         WHERE employer_id = ? AND status IN ('ongoing', 'finished')
       ) AS intern_counts`,
      [employerId, employerId, employerId, employerId],
    );

    return {
      internshipPosts: counts.posting_count || 0,
      unreadAnnouncements: counts.announcement_count || 0,
      internsHandled: {
        current: counts.ongoing_count || 0,
        past: counts.finished_count || 0,
      },
      documentsUploaded: counts.document_count || 0,
    };
}

const EMPLOYER_INTERNS_PAGE_SIZE = 5;

function parseDashboardPage(value) {
  const raw = value ?? "1";
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page <= 1000000 ? page : null;
}

async function loadEmployerInternsPage(connection, employerId, { page = 1, status = "all" } = {}) {
  const statusFilter = status === "all" ? "" : " AND ir.status = ?";
  const params = status === "all" ? [employerId] : [employerId, status];
  const [[countRow]] = await connection.execute(
    `SELECT COUNT(*) AS total FROM internship_records ir
     WHERE ir.employer_id = ?${statusFilter}`,
    params,
  );
  const total = Number(countRow?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / EMPLOYER_INTERNS_PAGE_SIZE));
  let interns = [];
  if (total && page <= totalPages) {
    const [rows] = await connection.execute(
      `SELECT ir.id AS internship_id, ir.user_id AS student_id,
              ir.status, ir.internship_position, ir.date_started, ir.date_ended,
              ir.total_hours, ir.accumulated_hours, u.email,
              up.first_name, up.last_name, c.course_name, c.short_name
       FROM internship_records ir
       JOIN users u ON u.id = ir.user_id
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       LEFT JOIN student_academic_info sai ON sai.id = (
         SELECT MAX(sai_latest.id)
         FROM student_academic_info sai_latest
         WHERE sai_latest.user_id = ir.user_id
       )
       LEFT JOIN courses c ON c.id = sai.course_id
       WHERE ir.employer_id = ?${statusFilter}
       ORDER BY ir.date_started DESC, ir.id DESC
       LIMIT ? OFFSET ?`,
      [...params, EMPLOYER_INTERNS_PAGE_SIZE, (page - 1) * EMPLOYER_INTERNS_PAGE_SIZE],
    );
    interns = rows;
  }
  return { interns, page, pageSize: EMPLOYER_INTERNS_PAGE_SIZE, total, totalPages };
}

export const getEmployerDashboardData = async (req, res) => {
  const jobPage = parseDashboardPage(req.query?.jobPage);
  if (jobPage === null) {
    return res.status(400).json({ error: "Invalid jobs page." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    const { id: employerId } = req.verifiedUser;
    const stats = await loadEmployerDashboardStats(connection, employerId);

    let internsPage = {
      interns: [], page: 1, pageSize: EMPLOYER_INTERNS_PAGE_SIZE,
      total: 0, totalPages: 1,
    };
    try {
      internsPage = await loadEmployerInternsPage(connection, employerId);
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getEmployerDashboardData: interns query failed:", err);
    }

    // Include the requested jobs page so dashboard navigation does not fetch
    // and discard page 1 before requesting a later page.
    let postedJobs = [];
    let postedJobsTotalPages = 1;
    try {
      const limit = 5;
      const [jobRows] = await connection.execute(
        `SELECT id, position, location, work_type, vacancies, status, created_at,
                (SELECT COUNT(*) FROM internship_postings
                 WHERE employer_id = ? AND deleted_at IS NULL) AS total_postings
         FROM internship_postings
         WHERE employer_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [employerId, employerId, limit, (jobPage - 1) * limit],
      );
      let totalPostings = Number(jobRows[0]?.total_postings) || 0;
      if (jobRows.length === 0 && jobPage > 1) {
        const [[countRow]] = await connection.execute(
          `SELECT COUNT(*) AS total FROM internship_postings
           WHERE employer_id = ? AND deleted_at IS NULL`,
          [employerId],
        );
        totalPostings = Number(countRow?.total) || 0;
      }
      postedJobsTotalPages = Math.ceil(totalPostings / limit);
      postedJobs = jobRows.map(({ total_postings, ...job }) => job);
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getEmployerDashboardData: posted jobs query failed:", err);
    }

    return res.status(200).json({
      success: true,
      stats,
      interns: internsPage.interns,
      internsPagination: {
        page: internsPage.page,
        pageSize: internsPage.pageSize,
        total: internsPage.total,
        totalPages: internsPage.totalPages,
      },
      postedJobs: {
        jobs: postedJobs,
        totalPages: postedJobsTotalPages,
        currentPage: jobPage,
      },
    });
  } catch (error) {
    reportError("Failed to retrieve employer dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getEmployerInternsPage = async (req, res) => {
  const page = parseDashboardPage(req.query?.page);
  const status = req.query?.status ?? "all";
  if (page === null || !["all", "ongoing", "finished"].includes(status)) {
    return res.status(400).json({ error: "Invalid intern filters." });
  }

  let connection;
  try {
    connection = await db.getConnection();
    const data = await loadEmployerInternsPage(connection, req.verifiedUser.id, { page, status });
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    reportError("Failed to retrieve employer interns page:", error);
    return res.status(500).json({ success: false, error: "Intern lookup failed." });
  } finally {
    if (connection) connection.release();
  }
};

// Retained for clients that request only a jobs page.
export const getPostedJobs = async (req, res) => {
  let connection;
  try {
    const { id: employerId } = req.verifiedUser;
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;

    connection = await db.getConnection();

    const [jobs] = await connection.execute(
      `SELECT
         id,
         position,
         location,
         work_type,
         vacancies,
         status,
         created_at,
         (SELECT COUNT(*) FROM internship_postings
          WHERE employer_id = ? AND deleted_at IS NULL) AS total_records
       FROM internship_postings
       WHERE employer_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [employerId, employerId, limit, offset],
    );

    let totalRecords = jobs[0]?.total_records ?? 0;
    if (jobs.length === 0 && page > 1) {
      const [[{ total }]] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM internship_postings
         WHERE employer_id = ? AND deleted_at IS NULL`,
        [employerId],
      );
      totalRecords = total;
    }
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      jobs: jobs.map(({ total_records, ...job }) => job),
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    reportError("Get posted jobs error:", error);
    return res.status(500).json({ error: "Failed to get posted jobs." });
  } finally {
    if (connection) connection.release();
  }
};
///////////////////
//DEPARTMENT HEAD
//////////////////
async function loadDepartmentHeadDashboardStats(connection, departmentId, userId) {
    const [
      [internshipCountsResult],
      [manualAlumniResult],
      [announcementResult],
    ] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS total_count,
                COUNT(CASE WHEN ir.status = 'ongoing' THEN 1 END) AS ongoing_count,
                COUNT(CASE WHEN ir.status = 'pending' THEN 1 END) AS pending_count
         FROM internship_records ir
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON ir.user_id = sai.user_id
         WHERE sai.department_id = ? AND ir.deleted_at IS NULL`,
        [departmentId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count
         FROM alumni_internship_records
         WHERE department_id = ? AND internship_record_id IS NULL`,
        [departmentId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM notifications 
         WHERE user_id = ? AND type = 'announcement' AND is_read = 0`,
        [userId],
      ),
    ]);

    const internshipRecordsCount =
      (internshipCountsResult[0].total_count || 0) +
      (manualAlumniResult[0].count || 0);

    return {
      ongoingInternships: internshipCountsResult[0].ongoing_count || 0,
      internshipRecords: internshipRecordsCount,
      pendingResponses: internshipCountsResult[0].pending_count || 0,
      unreadAnnouncements: announcementResult[0].count || 0,
    };
}

const HOURS_TRACKER_PAGE_SIZE = 10;
// Remaining duty hours exceed what fits before the end date at 40 hours/week.
// Use the same database-time rule for each row and the all-student chart.
const hoursAtRiskCondition = `(
  COALESCE(ir.total_hours, 0) - COALESCE(ir.accumulated_hours, 0) >
  GREATEST(COALESCE(TIMESTAMPDIFF(MICROSECOND, CURRENT_TIMESTAMP(6), ir.date_ended), 0), 0)
  * 40 / 604800000000
)`;
const hoursTrackerFrom = `FROM internship_records ir
  INNER JOIN (
    SELECT sai1.user_id, sai1.department_id, sai1.course_id
    FROM student_academic_info AS sai1
    INNER JOIN (
      SELECT user_id, MAX(id) AS max_id
      FROM student_academic_info
      GROUP BY user_id
    ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
  ) AS sai ON ir.user_id = sai.user_id
  INNER JOIN courses c ON c.id = sai.course_id
  LEFT JOIN user_profiles up ON up.user_id = ir.user_id`;

function mapHoursStudent(row) {
  return {
    id: row.internship_id,
    student_id: row.student_id,
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unknown",
    course: row.course,
    company: row.company_name,
    accumulated_hours: Number(row.accumulated_hours) || 0,
    total_hours: Number(row.total_hours) || 0,
    atRisk: Number(row.at_risk) === 1,
    date_started: row.date_started,
    date_ended: row.date_ended,
  };
}

async function loadStudentHoursPage(connection, departmentId, { page = 1, courseId, search = "" } = {}) {
  const filters = ["sai.department_id = ?", "ir.status = 'ongoing'"];
  const params = [departmentId];
  if (courseId) {
    filters.push("sai.course_id = ?");
    params.push(courseId);
  }
  if (search) {
    filters.push("LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', up.first_name, up.last_name))) > 0");
    params.push(search);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const [[countRow]] = await connection.execute(
    `SELECT COUNT(*) AS total ${hoursTrackerFrom} ${where}`,
    params,
  );
  const total = Number(countRow?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / HOURS_TRACKER_PAGE_SIZE));
  let students = [];
  if (total && page <= totalPages) {
    const [rows] = await connection.execute(
      `SELECT ir.id AS internship_id, ir.user_id AS student_id,
              ir.company_name, ir.accumulated_hours, ir.total_hours,
              ir.date_started, ir.date_ended, up.first_name, up.last_name,
              c.short_name AS course,
              CASE WHEN ${hoursAtRiskCondition} THEN 1 ELSE 0 END AS at_risk
       ${hoursTrackerFrom} ${where}
       ORDER BY ir.date_started DESC, ir.id DESC
       LIMIT ? OFFSET ?`,
      [...params, HOURS_TRACKER_PAGE_SIZE, (page - 1) * HOURS_TRACKER_PAGE_SIZE],
    );
    students = rows.map(mapHoursStudent);
  }
  return { students, page, pageSize: HOURS_TRACKER_PAGE_SIZE, total, totalPages };
}

async function loadHoursDistribution(connection, departmentId) {
  const [rows] = await connection.execute(
    `SELECT c.short_name AS course,
            COUNT(ir.id) AS student_count,
            SUM(CASE WHEN ir.total_hours > 0
                     THEN ir.accumulated_hours / ir.total_hours * 100
                     ELSE 0 END) AS completion_sum,
            SUM(CASE WHEN ${hoursAtRiskCondition} THEN 1 ELSE 0 END) AS at_risk_count
     FROM internship_records ir
     INNER JOIN (
       SELECT sai1.user_id, sai1.department_id, sai1.course_id
       FROM student_academic_info AS sai1
       INNER JOIN (
         SELECT user_id, MAX(id) AS max_id
         FROM student_academic_info GROUP BY user_id
       ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
     ) AS sai ON ir.user_id = sai.user_id
     INNER JOIN courses c ON c.id = sai.course_id
     WHERE sai.department_id = ? AND ir.status = 'ongoing'
     GROUP BY c.short_name
     ORDER BY c.short_name ASC`,
    [departmentId],
  );
  return rows.map((row) => ({
    course: row.course,
    studentCount: Number(row.student_count) || 0,
    avgCompletion: Math.round((Number(row.completion_sum) || 0) / Number(row.student_count || 1)),
    atRiskCount: Number(row.at_risk_count) || 0,
  }));
}

// Fetch stats and dashboard sections through one pooled connection. Optional
// sections retain their independent fallbacks and opt out of response caching.
export const getDepartmentHeadDashboardData = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }
    const stats = await loadDepartmentHeadDashboardStats(
      connection,
      departmentId,
      req.verifiedUser.id,
    );

    let ongoingPerCourse = [];
    try {
      const [rows] = await connection.execute(
        `SELECT
           c.id AS course_id,
           c.course_name,
           c.short_name,
           COUNT(ir.id) AS interns
         FROM internship_records ir
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id, sai1.course_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON ir.user_id = sai.user_id
         INNER JOIN courses c ON c.id = sai.course_id
         WHERE sai.department_id = ? AND ir.status = 'ongoing'
         GROUP BY c.id, c.course_name, c.short_name
         ORDER BY interns DESC`,
        [departmentId],
      );
      ongoingPerCourse = rows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getDepartmentHeadDashboardData: per-course query failed:",
        err,
      );
    }

    let studentEvaluationAverages = [];
    try {
      const [rows] = await connection.execute(
        `SELECT
           sec.category,
           AVG(ses.score) AS avg_score
         FROM student_evaluation_scores ses
         INNER JOIN student_evaluation_criteria sec ON sec.id = ses.criterion_id
         INNER JOIN student_evaluation_masters sem ON sem.id = ses.evaluation_master_id
         INNER JOIN internship_records ir ON ir.id = sem.internship_record_id
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id, sai1.course_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON ir.user_id = sai.user_id
         WHERE sai.department_id = ? AND sem.status = 'completed'
         GROUP BY sec.category
         ORDER BY sec.category ASC`,
        [departmentId],
      );
      studentEvaluationAverages = rows.map((r) => ({
        category: r.category,
        score: Number(Number(r.avg_score).toFixed(2)),
      }));
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getDepartmentHeadDashboardData: student evaluation averages query failed:",
        err,
      );
    }

    let employerEvaluationAverages = [];
    try {
      const [rows] = await connection.execute(
        `SELECT
           eec.category,
           AVG(ees.score) AS avg_score
         FROM employer_evaluation_scores ees
         INNER JOIN employer_evaluation_criteria eec ON eec.id = ees.criterion_id
         INNER JOIN employer_evaluation_masters eem ON eem.id = ees.evaluation_master_id
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id, sai1.course_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON eem.student_id = sai.user_id
         WHERE sai.department_id = ?
         GROUP BY eec.category
         ORDER BY eec.category ASC`,
        [departmentId],
      );
      employerEvaluationAverages = rows.map((r) => ({
        category: r.category,
        score: Number(Number(r.avg_score).toFixed(2)),
      }));
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getDepartmentHeadDashboardData: employer evaluation averages query failed:",
        err,
      );
    }

    let hoursTracker = {
      students: [], courses: [], page: 1, pageSize: HOURS_TRACKER_PAGE_SIZE,
      total: 0, totalPages: 1,
    };
    try {
      hoursTracker = {
        ...hoursTracker,
        ...(await loadStudentHoursPage(connection, departmentId)),
      };
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getDepartmentHeadDashboardData: hours page query failed:", err);
    }
    try {
      const [courseRows] = await connection.execute(
        `SELECT id, course_name, short_name
         FROM courses
         WHERE department_id = ? AND is_active = 1
         ORDER BY short_name ASC`,
        [departmentId],
      );
      hoursTracker.courses = courseRows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getDepartmentHeadDashboardData: hours courses query failed:", err);
    }

    let hoursDistribution = [];
    try {
      hoursDistribution = await loadHoursDistribution(connection, departmentId);
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getDepartmentHeadDashboardData: hours distribution query failed:", err);
    }

    let availableShiftHoursMonths = [];
    try {
      const [rows] = await connection.execute(
        `SELECT DISTINCT YEAR(dtr.clock_in) AS year, MONTH(dtr.clock_in) AS month
         FROM daily_time_records dtr
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id, sai1.course_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON dtr.user_id = sai.user_id
         WHERE sai.department_id = ?
           AND dtr.status IN ('present', 'invalid')
           AND dtr.clock_out IS NOT NULL
         ORDER BY year DESC, month DESC
         LIMIT 12`,
        [departmentId],
      );
      availableShiftHoursMonths = rows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getDepartmentHeadDashboardData: available months query failed:",
        err,
      );
    }

    res.status(200).json({
      success: true,
      stats,
      ongoingPerCourse,
      studentEvaluationAverages,
      employerEvaluationAverages,
      hoursTracker,
      hoursDistribution,
      availableShiftHoursMonths,
    });
  } catch (error) {
    reportError("Failed to retrieve department head dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getDepartmentStudentHoursPage = async (req, res) => {
  const { department_id: departmentId } = req.verifiedUser;
  if (!departmentId) {
    return res.status(400).json({ error: "No department associated with this account." });
  }

  const rawPage = req.query.page ?? "1";
  const rawCourseId = req.query.courseId;
  const rawSearch = req.query.search ?? "";
  if (
    typeof rawPage !== "string" || !/^[1-9]\d*$/.test(rawPage) ||
    !Number.isSafeInteger(Number(rawPage)) || Number(rawPage) > 1000000 ||
    (rawCourseId !== undefined &&
      (typeof rawCourseId !== "string" || !/^[1-9]\d*$/.test(rawCourseId) ||
        !Number.isSafeInteger(Number(rawCourseId)))) ||
    typeof rawSearch !== "string" || rawSearch.trim().length > 100
  ) {
    return res.status(400).json({ error: "Invalid hours tracker filters." });
  }

  let connection;
  try {
    connection = await db.getConnection();
    const page = await loadStudentHoursPage(connection, departmentId, {
      page: Number(rawPage),
      courseId: rawCourseId ? Number(rawCourseId) : undefined,
      search: rawSearch.trim(),
    });
    return res.status(200).json({ success: true, ...page });
  } catch (error) {
    reportError("Failed to retrieve department student hours page:", error);
    return res.status(500).json({ success: false, error: "Student hours lookup failed" });
  } finally {
    if (connection) connection.release();
  }
};

// Keep separate — interactive, refetched every time the month picker changes
export const getAverageShiftHoursByWeek = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;
    const now = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year = parseInt(req.query.year) || now.getFullYear();

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }

    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const lastOfMonth = new Date(Date.UTC(year, month, 0));

    const isoDay = (d) => ((d.getUTCDay() + 6) % 7) + 1;

    const rangeStart = new Date(firstOfMonth);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (isoDay(firstOfMonth) - 1));

    const rangeEnd = new Date(lastOfMonth);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + (7 - isoDay(lastOfMonth)));

    const rangeEndExclusive = new Date(rangeEnd);
    rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

    const [rows] = await connection.execute(
      `SELECT dtr.clock_in, dtr.total_hours
       FROM daily_time_records dtr
       INNER JOIN (
         SELECT sai1.user_id, sai1.department_id
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON dtr.user_id = sai.user_id
       WHERE sai.department_id = ?
         AND dtr.status IN ('present', 'invalid')
         AND dtr.clock_out IS NOT NULL
         AND dtr.total_hours IS NOT NULL
         AND dtr.clock_in >= ?
         AND dtr.clock_in < ?`,
      [departmentId, rangeStart, rangeEndExclusive],
    );

    const weeks = [];
    let cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      weeks.push({ start: weekStart, end: weekEnd, hoursSum: 0, count: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }

    const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;
    const rangeStartMilliseconds = rangeStart.getTime();
    for (const row of rows) {
      const clockIn = new Date(row.clock_in);
      const weekIndex = Math.floor(
        (clockIn.getTime() - rangeStartMilliseconds) / weekMilliseconds,
      );
      const bucket = weeks[weekIndex];
      if (bucket) {
        bucket.hoursSum += Number(row.total_hours) || 0;
        bucket.count += 1;
      }
    }

    const result = weeks.map((w, i) => ({
      week: `Week ${i + 1}`,
      startDate: w.start.toISOString().slice(0, 10),
      endDate: w.end.toISOString().slice(0, 10),
      hours: w.count > 0 ? Number((w.hoursSum / w.count).toFixed(2)) : 0,
    }));

    return res.status(200).json({ weeks: result, month, year });
  } catch (error) {
    reportError("Get average shift hours by week error:", error);
    return res
      .status(500)
      .json({ error: "Failed to get average shift hours." });
  } finally {
    if (connection) connection.release();
  }
};

///////////////////
//ADMIN
//////////////////

async function loadAdminDashboardStats(connection) {
    // The left join keeps inactive/suspended users in the count even if their
    // role row is absent; the role counters still require a matching role.
    const [[counts]] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM internship_records
          WHERE status = 'ongoing') AS ongoing_count,
         COUNT(CASE WHEN r.role = 'employer' THEN 1 END) AS employer_count,
         COUNT(CASE WHEN r.role = 'student' THEN 1 END) AS student_count,
         COUNT(CASE WHEN u.status IN ('inactive', 'suspended') THEN 1 END) AS inactive_count
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id`,
    );

    return {
      ongoingInternships: counts.ongoing_count || 0,
      employers: counts.employer_count || 0,
      students: counts.student_count || 0,
      inactiveOrSuspended: counts.inactive_count || 0,
    };
}

// Admin dashboard sections stay independent so one failed query does not
// discard the others.
export const getAdminDashboardData = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const stats = await loadAdminDashboardStats(connection);

    let userGrowth = [];
    try {
      const monthsBack = 7;
      const rangeStart = new Date();
      rangeStart.setDate(1);
      rangeStart.setMonth(rangeStart.getMonth() - monthsBack);
      rangeStart.setHours(0, 0, 0, 0);

      const [rows] = await connection.execute(
        `SELECT
           DATE_FORMAT(u.created_at, '%Y-%m') AS month_key,
           r.role,
           COUNT(*) AS count
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.created_at >= ?
         GROUP BY month_key, r.role
         ORDER BY month_key ASC`,
        [rangeStart],
      );

      const months = [];
      const cursor = new Date(rangeStart);
      const now = new Date();
      while (
        cursor.getFullYear() < now.getFullYear() ||
        (cursor.getFullYear() === now.getFullYear() &&
          cursor.getMonth() <= now.getMonth())
      ) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        months.push({
          key,
          label: cursor.toLocaleString("en-US", { month: "short" }),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      const dataByMonth = new Map(
        months.map((m) => [
          m.key,
          { month: m.label, students: 0, employers: 0, deptHeads: 0 },
        ]),
      );

      for (const row of rows) {
        const entry = dataByMonth.get(row.month_key);
        if (!entry) continue;
        if (row.role === "student") entry.students = row.count;
        if (row.role === "employer") entry.employers = row.count;
        if (row.role === "department_head") entry.deptHeads = row.count;
      }

      userGrowth = Array.from(dataByMonth.values());
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getAdminDashboardData: user growth query failed:", err);
    }

    let usersByRole = [];
    try {
      const [rows] = await connection.execute(
        `SELECT r.role, COUNT(*) AS count
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         GROUP BY r.role`,
      );
      usersByRole = rows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError("getAdminDashboardData: users by role query failed:", err);
    }

    let ongoingByDepartment = [];
    try {
      const [rows] = await connection.execute(
        `SELECT
           d.id AS department_id,
           d.name AS department_name,
           d.code AS department_code,
           COUNT(ir.id) AS interns
         FROM internship_records ir
         INNER JOIN (
           SELECT sai1.user_id, sai1.department_id
           FROM student_academic_info AS sai1
           INNER JOIN (
             SELECT user_id, MAX(id) AS max_id
             FROM student_academic_info
             GROUP BY user_id
           ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
         ) AS sai ON ir.user_id = sai.user_id
         INNER JOIN departments d ON d.id = sai.department_id
         WHERE ir.status = 'ongoing'
         GROUP BY d.id, d.name, d.code
         ORDER BY interns DESC`,
      );
      ongoingByDepartment = rows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getAdminDashboardData: ongoing by department query failed:",
        err,
      );
    }

    let recentActivity = [];
    try {
      const [rows] = await connection.execute(
        `SELECT id, actor_id, actor_role, action, target_type, target_id, description, created_at
         FROM activity_logs
         ORDER BY created_at DESC
         LIMIT 10`,
      );
      recentActivity = rows;
    } catch (err) {
      res.locals.skipCache = true;
      reportError(
        "getAdminDashboardData: recent activity query failed:",
        err,
      );
    }

    res.status(200).json({
      success: true,
      stats,
      userGrowth,
      usersByRole,
      ongoingByDepartment,
      recentActivity,
    });
  } catch (error) {
    reportError("Failed to retrieve admin dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};
