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

///////////////////
//EMPLOYER
//////////////////
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
      // Internship Posts Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_postings 
         WHERE employer_id = ? AND deleted_at IS NULL`,
        [employerId],
      ),

      // Unread Announcements Count
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM notifications 
         WHERE user_id = ? AND type = 'announcement' AND is_read = 0`,
        [employerId],
      ),

      // Interns Handled — current (ongoing)
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_records 
         WHERE employer_id = ? AND status = 'ongoing'`,
        [employerId],
      ),

      // Interns Handled — past (finished)
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM internship_records 
         WHERE employer_id = ? AND status = 'finished'`,
        [employerId],
      ),

      // Documents Uploaded — only ones this employer uploaded themselves
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

export const getSupervisedInterns = async (req, res) => {
  let connection;
  try {
    const { id: employerId } = req.verifiedUser;

    connection = await db.getConnection();

    const [interns] = await connection.execute(
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

    return res.status(200).json({ interns });
  } catch (error) {
    console.error("Get supervised interns error:", error);
    return res.status(500).json({ error: "Failed to get supervised interns." });
  } finally {
    if (connection) connection.release();
  }
};

// wherever your employer controllers live, e.g. controllers/employerController.js

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
      // Ongoing Internships — dept-scoped via each student's latest
      // student_academic_info row
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

      // Pending Responses — same scoping, status = 'pending'
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

      // Internship Records, part 1 — every internship_records row for this
      // department, regardless of status
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

      // Internship Records, part 2 — alumni rows with NO internship_record_id,
      // meaning they were never counted in internship_records at all
      // (manually posted, not derived from a finished record)
      connection.execute(
        `SELECT COUNT(*) AS count
         FROM alumni_internship_records
         WHERE department_id = ? AND internship_record_id IS NULL`,
        [departmentId],
      ),

      // Unread Announcements
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

export const getOngoingInternshipsPerCourse = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }

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

    return res.status(200).json({ courses: rows });
  } catch (error) {
    console.error("Get ongoing internships per course error:", error);
    return res
      .status(500)
      .json({ error: "Failed to get internships per course." });
  } finally {
    if (connection) connection.release();
  }
};

export const getAverageShiftHoursByWeek = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;
    const now = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1; // 1-12
    const year = parseInt(req.query.year) || now.getFullYear();

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }

    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const lastOfMonth = new Date(Date.UTC(year, month, 0));

    const isoDay = (d) => ((d.getUTCDay() + 6) % 7) + 1; // Mon=1 ... Sun=7

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

export const getAvailableShiftHoursMonths = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { department_id: departmentId } = req.verifiedUser;

    if (!departmentId) {
      return res
        .status(400)
        .json({ error: "No department associated with this account." });
    }

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

    return res.status(200).json({ months: rows });
  } catch (error) {
    console.error("Get available shift hours months error:", error);
    return res.status(500).json({ error: "Failed to get available months." });
  } finally {
    if (connection) connection.release();
  }
};

///////////////////
//ADMIN
//////////////////

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
      // Ongoing Internships — system-wide, no department scoping
      connection.execute(
        `SELECT COUNT(*) AS count FROM internship_records WHERE status = 'ongoing'`,
      ),

      // Employers
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.role = 'employer'`,
      ),

      // Students
      connection.execute(
        `SELECT COUNT(*) AS count 
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.role = 'student'`,
      ),

      // Inactive / Suspended accounts, any role
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

export const getUserGrowthOverTime = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const monthsBack = 7; // 7 + current month = 8 months total, matches mockup

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

    // Build the full list of months in range so empty months still show as 0
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

    return res.status(200).json({ growth: Array.from(dataByMonth.values()) });
  } catch (error) {
    console.error("Get user growth over time error:", error);
    return res.status(500).json({ error: "Failed to get user growth data." });
  } finally {
    if (connection) connection.release();
  }
};

export const getUsersByRole = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const [rows] = await connection.execute(
      `SELECT r.role, COUNT(*) AS count
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       GROUP BY r.role`,
    );

    return res.status(200).json({ roles: rows });
  } catch (error) {
    console.error("Get users by role error:", error);
    return res.status(500).json({ error: "Failed to get users by role." });
  } finally {
    if (connection) connection.release();
  }
};

export const getOngoingInternshipsByDepartment = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

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

    return res.status(200).json({ departments: rows });
  } catch (error) {
    console.error("Get ongoing internships by department error:", error);
    return res
      .status(500)
      .json({ error: "Failed to get internships by department." });
  } finally {
    if (connection) connection.release();
  }
};

export const getRecentSystemActivity = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const limit = 10;

    const [rows] = await connection.execute(
      `SELECT id, actor_id, actor_role, action, target_type, target_id, description, created_at
       FROM activity_logs
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );

    return res.status(200).json({ data: rows });
  } catch (error) {
    console.error("Get recent system activity error:", error);
    return res.status(500).json({ error: "Failed to get recent activity." });
  } finally {
    if (connection) connection.release();
  }
};
