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

    // 2. Execute all count queries concurrently using the same connection instance
    const [
      [internshipResult],
      [announcementResult],
      [evaluationResult],
      [documentResult],
    ] = await Promise.all([
      // Unread Announcements Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_favorites 
         WHERE student_id = ? AND favorited_at IS NOT NULL`,
        [userId],
      ),
      // Unread Announcements Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM notifications 
         WHERE user_id = ? AND type = 'announcement' AND is_read = 0`,
        [userId],
      ),

      // Pending Evaluations Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM student_evaluation_masters AS sem
         INNER JOIN internship_records AS ir ON sem.internship_record_id = ir.id
         WHERE ir.user_id = ? AND sem.status = 'pending'`,
        [userId],
      ),

      // Total Stored Documents Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_documents 
         WHERE user_id = ?`,
        [userId],
      ),
    ]);

    // 3. Send back the aggregated metrics
    res.status(200).json({
      success: true,
      stats: {
        favoriteInternships: internshipResult[0].count || 0, // Placeholder for later implementation
        unreadAnnouncements: announcementResult[0].count || 0,
        pendingEvaluations: evaluationResult[0].count || 0,
        documentsStored: documentResult[0].count || 0,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve student dashboard statistics:", error);
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

    // Active internship — ongoing OR pending, matches getActiveInternship
    let internshipData = null;
    try {
      const [rows] = await connection.execute(
        `SELECT * FROM internship_records
         WHERE user_id = ? AND (status = 'ongoing' OR status = 'pending')
         LIMIT 1`,
        [userId],
      );
      internshipData = rows.length > 0 ? rows[0] : null;
    } catch (err) {
      console.error(
        "getStudentDashboardData: active internship query failed:",
        err,
      );
    }

    const internshipId = internshipData?.id || null;
    const isOngoing = internshipData?.status === "ongoing";

    let dtrToday = null;
    let dtrStatus = { status: "CLOCKED_OUT", record: null };
    let dtrData = { dtrs: [], totalPages: 1, totalRecords: 0, currentPage: 1 };
    let location = {};

    // DTR-specific pieces only make sense once the internship is actually
    // ongoing (not merely pending) — matches getMySettedDtrLocation's own
    // status = 'ongoing' restriction.
    if (internshipId && isOngoing) {
      // Today's DTR
      try {
        const [todayRows] = await connection.execute(
          `SELECT id, clock_in, clock_out, created_at, status 
           FROM daily_time_records 
           WHERE user_id = ? AND DATE(created_at) = CURDATE() AND internship_id = ?
           LIMIT 1`,
          [userId, internshipId],
        );
        dtrToday = todayRows.length > 0 ? todayRows[0] : null;
      } catch (err) {
        console.error(
          "getStudentDashboardData: today's DTR query failed:",
          err,
        );
      }

      // Latest clock-in/out status
      try {
        const [statusRows] = await connection.execute(
          `SELECT id, clock_in, clock_out 
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
            lastRecord.clock_out === null
              ? { status: "CLOCKED_IN", record: lastRecord }
              : { status: "CLOCKED_OUT", record: lastRecord };
        }
      } catch (err) {
        console.error(
          "getStudentDashboardData: latest DTR status query failed:",
          err,
        );
      }

      // First page of DTR history
      try {
        const limit = 5;
        const [dtrRows] = await connection.execute(
          `SELECT * FROM daily_time_records 
           WHERE user_id = ? AND internship_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          [userId, internshipId, limit],
        );
        const [[countRow]] = await connection.execute(
          `SELECT COUNT(*) AS total FROM daily_time_records
            WHERE user_id = ? AND internship_id = ?`,
          [userId, internshipId],
        );
        const totalRecords = countRow.total || 0;
        dtrData = {
          dtrs: dtrRows,
          totalPages: Math.ceil(totalRecords / limit) || 1,
          totalRecords,
          currentPage: 1,
        };
      } catch (err) {
        console.error(
          "getStudentDashboardData: DTR history query failed:",
          err,
        );
      }

      // DTR location — same company-address-fallback-to-custom-location
      // logic as getMySettedDtrLocation, reused here rather than
      // re-simplified.
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
            radius_meters: isCustom ? record.radius_meters : 150, // keep in sync with your default elsewhere
            label: isCustom ? record.label : "Company address (default)",
            address: isCustom ? record.address : null,
            set_by: isCustom ? record.set_by : null,
            created_at: isCustom ? record.dtr_created_at : null,
            updated_at: isCustom ? record.dtr_updated_at : null,
          };
        }
      } catch (err) {
        console.error(
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
      dtrData,
      location,
    });
  } catch (error) {
    console.error("Failed to retrieve student dashboard data:", error);
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
// Keep standalone — feeds @stats independently
export const getEmployerDashboardStats = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: employerId } = req.verifiedUser;

    const [
      [postingsResult],
      [announcementResult],
      [currentInternsResult],
      [pastInternsResult],
      [documentResult],
    ] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_postings 
         WHERE employer_id = ? AND deleted_at IS NULL`,
        [employerId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM notifications 
         WHERE user_id = ? AND type = 'announcement' AND is_read = 0`,
        [employerId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_records 
         WHERE employer_id = ? AND status = 'ongoing'`,
        [employerId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_records 
         WHERE employer_id = ? AND status = 'finished'`,
        [employerId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_documents 
         WHERE uploaded_by_id = ? AND uploaded_by_role = 'employer'`,
        [employerId],
      ),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        internshipPosts: postingsResult[0].count || 0,
        unreadAnnouncements: announcementResult[0].count || 0,
        internsHandled: {
          current: currentInternsResult[0].count || 0,
          past: pastInternsResult[0].count || 0,
        },
        documentsUploaded: documentResult[0].count || 0,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve employer dashboard statistics:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Consolidated — everything else for the employer dashboard's main page.js,
// in one round trip. Stats deliberately excluded (see getEmployerDashboardStats).
export const getEmployerDashboardData = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { id: employerId } = req.verifiedUser;

    // Interns list is the only remaining piece — wrapped defensively so a
    // bad join here doesn't 500 the whole dashboard.
    let interns = [];
    try {
      const [internRows] = await connection.execute(
        `SELECT
           ir.id AS internship_id,
           ir.user_id AS student_id,
           ir.status,
           ir.internship_position,
           ir.date_started,
           ir.date_ended,
           ir.total_hours,
           ir.accumulated_hours,
           u.email,
           up.first_name,
           up.last_name,
           c.course_name,
           c.short_name
         FROM internship_records ir
         JOIN users u ON u.id = ir.user_id
         LEFT JOIN user_profiles up ON up.user_id = ir.user_id
         LEFT JOIN student_academic_info sai ON sai.user_id = ir.user_id
         LEFT JOIN courses c ON c.id = sai.course_id
         WHERE ir.employer_id = ?
         ORDER BY ir.date_started DESC`,
        [employerId],
      );
      interns = internRows;
    } catch (err) {
      console.error("getEmployerDashboardData: interns query failed:", err);
    }

    // Posted jobs — first page only, matches getPostedJobs' original
    // defaults; pagination for subsequent pages stays on its own endpoint.
    let postedJobs = [];
    let postedJobsTotalPages = 1;
    try {
      const limit = 5;
      const [jobRows] = await connection.execute(
        `SELECT id, position, location, work_type, vacancies, status, created_at
         FROM internship_postings
         WHERE employer_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
        [employerId, limit],
      );
      const [[countRow]] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM internship_postings
         WHERE employer_id = ? AND deleted_at IS NULL`,
        [employerId],
      );
      postedJobs = jobRows;
      postedJobsTotalPages = Math.ceil((countRow.total || 0) / limit);
    } catch (err) {
      console.error("getEmployerDashboardData: posted jobs query failed:", err);
    }

    return res.status(200).json({
      success: true,
      interns,
      postedJobs: {
        jobs: postedJobs,
        totalPages: postedJobsTotalPages,
        currentPage: 1,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve employer dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Keep separate — paginated, refetched on "page 2, 3..." after initial load
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
         created_at
       FROM internship_postings
       WHERE employer_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [employerId, limit, offset],
    );

    const [countResult] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM internship_postings
       WHERE employer_id = ? AND deleted_at IS NULL`,
      [employerId],
    );

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      jobs,
      totalPages,
      totalRecords,
      currentPage: page,
    });
  } catch (error) {
    console.error("Get posted jobs error:", error);
    return res.status(500).json({ error: "Failed to get posted jobs." });
  } finally {
    if (connection) connection.release();
  }
};
///////////////////
//DEPARTMENT HEAD
//////////////////
// Keep standalone — feeds @stats independently
export const getDepartmentHeadDashboardStats = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }

    const [
      [ongoingResult],
      [pendingResult],
      [internshipRecordsResult],
      [manualAlumniResult],
      [announcementResult],
    ] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS count
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
         WHERE sai.department_id = ? AND ir.status = 'ongoing'`,
        [departmentId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count
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
         WHERE sai.department_id = ? AND ir.status = 'pending'`,
        [departmentId],
      ),
      connection.execute(
        `SELECT COUNT(*) AS count
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
         WHERE sai.department_id = ?`,
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
        [req.verifiedUser.id],
      ),
    ]);

    const internshipRecordsCount =
      (internshipRecordsResult[0].count || 0) +
      (manualAlumniResult[0].count || 0);

    res.status(200).json({
      success: true,
      stats: {
        ongoingInternships: ongoingResult[0].count || 0,
        internshipRecords: internshipRecordsCount,
        pendingResponses: pendingResult[0].count || 0,
        unreadAnnouncements: announcementResult[0].count || 0,
      },
    });
  } catch (error) {
    console.error(
      "Failed to retrieve department head dashboard statistics:",
      error,
    );
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Consolidated — everything except stats, in one round trip. Each section
// wrapped independently so one bad query doesn't take down the rest.
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
           SELECT sai1.*
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
      console.error(
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
           SELECT sai1.*
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
      console.error(
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
           SELECT sai1.*
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
      console.error(
        "getDepartmentHeadDashboardData: employer evaluation averages query failed:",
        err,
      );
    }

    let hoursTracker = { students: [], courses: [] };
    try {
      const [studentRows] = await connection.execute(
        `SELECT
           ir.id AS internship_id,
           ir.user_id AS student_id,
           ir.company_name,
           ir.accumulated_hours,
           ir.total_hours,
           ir.date_started,
           ir.date_ended,
           up.first_name,
           up.last_name,
           c.short_name AS course
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
         INNER JOIN courses c ON c.id = sai.course_id
         LEFT JOIN user_profiles up ON up.user_id = ir.user_id
         WHERE sai.department_id = ? AND ir.status = 'ongoing'
         ORDER BY ir.date_started DESC`,
        [departmentId],
      );
      const [courseRows] = await connection.execute(
        `SELECT id, course_name, short_name
         FROM courses
         WHERE department_id = ? AND is_active = 1
         ORDER BY short_name ASC`,
        [departmentId],
      );
      hoursTracker = {
        students: studentRows.map((r) => ({
          id: r.internship_id,
          name:
            `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Unknown",
          course: r.course,
          company: r.company_name,
          accumulated_hours: Number(r.accumulated_hours) || 0,
          total_hours: Number(r.total_hours) || 0,
          date_started: r.date_started,
          date_ended: r.date_ended,
        })),
        courses: courseRows.map((c) => ({
          id: c.id,
          course_name: c.course_name,
          short_name: c.short_name,
        })),
      };
    } catch (err) {
      console.error(
        "getDepartmentHeadDashboardData: hours tracker query failed:",
        err,
      );
    }

    let availableShiftHoursMonths = [];
    try {
      const [rows] = await connection.execute(
        `SELECT DISTINCT YEAR(dtr.clock_in) AS year, MONTH(dtr.clock_in) AS month
         FROM daily_time_records dtr
         INNER JOIN (
           SELECT sai1.*
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
      console.error(
        "getDepartmentHeadDashboardData: available months query failed:",
        err,
      );
    }

    res.status(200).json({
      success: true,
      ongoingPerCourse,
      studentEvaluationAverages,
      employerEvaluationAverages,
      hoursTracker,
      availableShiftHoursMonths,
    });
  } catch (error) {
    console.error("Failed to retrieve department head dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
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
         SELECT sai1.*
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

    for (const row of rows) {
      const clockIn = new Date(row.clock_in);
      const bucket = weeks.find(
        (w) =>
          clockIn >= w.start &&
          clockIn < new Date(w.end.getTime() + 24 * 60 * 60 * 1000),
      );
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
    console.error("Get average shift hours by week error:", error);
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

// Keep standalone — feeds @stats independently
export const getAdminDashboardStats = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const [
      [ongoingResult],
      [employersResult],
      [studentsResult],
      [inactiveSuspendedResult],
    ] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS count FROM internship_records WHERE status = 'ongoing'`,
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.role = 'employer'`,
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.role = 'student'`,
      ),
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM users 
         WHERE status IN ('inactive', 'suspended')`,
      ),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        ongoingInternships: ongoingResult[0].count || 0,
        employers: employersResult[0].count || 0,
        students: studentsResult[0].count || 0,
        inactiveOrSuspended: inactiveSuspendedResult[0].count || 0,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve admin dashboard statistics:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Consolidated — everything except stats, in one round trip. Each section
// wrapped independently so one bad query doesn't take down the rest.
export const getAdminDashboardData = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

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
      console.error("getAdminDashboardData: user growth query failed:", err);
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
      console.error("getAdminDashboardData: users by role query failed:", err);
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
           SELECT sai1.*
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
      console.error(
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
      console.error(
        "getAdminDashboardData: recent activity query failed:",
        err,
      );
    }

    res.status(200).json({
      success: true,
      userGrowth,
      usersByRole,
      ongoingByDepartment,
      recentActivity,
    });
  } catch (error) {
    console.error("Failed to retrieve admin dashboard data:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    if (connection) connection.release();
  }
};
