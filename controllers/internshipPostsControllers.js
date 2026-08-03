import { db } from "../config/db.js";
import { newUUID } from "../config/helpers.js";

const ALLOWED_WORK_TYPES = ["on-site", "hybrid", "remote"];

export const getInternshipPostings = async (req, res) => {
  let connection;
  try {
    const { id: requesterId } = req.verifiedUser;
    const {
      workType,
      courseId,
      search,
      mine,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit) || 10)); // cap to avoid abuse
    const offset = (pageNum - 1) * pageSize;

    const conditions = ["ip.deleted_at IS NULL"];
    const params = [];

    if (workType) {
      conditions.push("ip.work_type = ?");
      params.push(workType);
    }

    if (search) {
      conditions.push("(ip.company_name LIKE ? OR ip.position LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    if (mine === "true") {
      conditions.push("ip.employer_id = ?");
      params.push(requesterId);
    }

    if (courseId) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM internship_posting_courses ipc
           WHERE ipc.posting_id = ip.id AND ipc.course_id = ?
         )`,
      );
      params.push(courseId);
    }

    const whereClause = conditions.join(" AND ");

    connection = await db.getConnection();

    // Total count for pagination metadata — same filters, no LIMIT
    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM internship_postings ip WHERE ${whereClause}`,
      params,
    );

    const [postings] = await connection.execute(
      `SELECT 
         ip.id, ip.employer_id, ip.company_name, ip.position, ip.vacancies,
         ip.location, ip.work_type, ip.duration_hours, ip.description,
         ip.requirements, ip.contact_name, ip.contact_email, ip.contact_phone,
         ip.contact_website, ip.status, ip.created_at, ip.updated_at
       FROM internship_postings ip
       WHERE ${whereClause}
       ORDER BY ip.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    if (postings.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: {
          page: pageNum,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    }

    const postingIds = postings.map((p) => p.id);
    const placeholders = postingIds.map(() => "?").join(",");

    const [courseLinks] = await connection.execute(
      `SELECT ipc.posting_id, c.id AS course_id, c.course_name, c.short_name
       FROM internship_posting_courses ipc
       JOIN courses c ON ipc.course_id = c.id
       WHERE ipc.posting_id IN (${placeholders})`,
      postingIds,
    );

    // Applications for the current requester across these postings —
    // only meaningful for students, but harmless to compute regardless
    const [applications] = await connection.execute(
      `SELECT posting_id FROM internship_applications
       WHERE student_id = ? AND posting_id IN (${placeholders})`,
      [requesterId, ...postingIds],
    );
    const appliedPostingIds = new Set(applications.map((a) => a.posting_id));

    const records = postings.map((posting) => ({
      ...posting,
      isOwner: posting.employer_id === requesterId,
      isApplied: appliedPostingIds.has(posting.id),
      courses: courseLinks
        .filter((c) => c.posting_id === posting.id)
        .map((c) => ({
          id: c.course_id,
          name: c.course_name,
          shortName: c.short_name,
        })),
    }));

    return res.status(200).json({
      data: records,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get internship postings error:", error);
    return res.status(500).json({
      success: false,
      error: "Database query failed to get internship postings.",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const createInternshipPosting = async (req, res) => {
  let connection;
  try {
    const { id: employerId } = req.verifiedUser;
    const {
      company_name,
      position,
      vacancies,
      location,
      work_type,
      duration_hours,
      description,
      requirements,
      contact_name,
      contact_email,
      contact_phone,
      contact_website,
      course_ids, // expected: array of course ids
    } = req.body;

    // Required fields, matching the frontend form's marked-required fields
    if (
      !company_name ||
      !position ||
      !location ||
      !description ||
      !contact_email
    ) {
      return res.status(400).json({
        error:
          "company_name, position, location, description, and contact_email are required.",
      });
    }

    if (!work_type || !ALLOWED_WORK_TYPES.includes(work_type)) {
      return res.status(400).json({
        error: `work_type must be one of: ${ALLOWED_WORK_TYPES.join(", ")}.`,
      });
    }

    if (!Array.isArray(course_ids) || course_ids.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one eligible course is required." });
    }

    const vacancyCount = parseInt(vacancies);
    if (!Number.isInteger(vacancyCount) || vacancyCount < 1) {
      return res
        .status(400)
        .json({ error: "vacancies must be a positive integer." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Validate the submitted course ids actually exist — never trust
    // client-sent ids blindly into a FK insert
    const coursePlaceholders = course_ids.map(() => "?").join(",");
    const [validCourses] = await connection.execute(
      `SELECT id FROM courses WHERE id IN (${coursePlaceholders})`,
      course_ids,
    );

    if (validCourses.length !== course_ids.length) {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "One or more selected courses are invalid." });
    }

    const postingId = newUUID();

    const [result] = await connection.execute(
      `INSERT INTO internship_postings
        (id, employer_id, company_name, position, vacancies, location, work_type,
         duration_hours, description, requirements, contact_name, contact_email,
         contact_phone, contact_website)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postingId,
        employerId,
        company_name,
        position,
        vacancyCount,
        location,
        work_type,
        duration_hours || null,
        description,
        requirements || null,
        contact_name || null,
        contact_email,
        contact_phone || null,
        contact_website || null,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ error: "Failed to create posting." });
    }

    // Insert one row per eligible course into the join table
    const courseValues = course_ids.map((courseId) => [postingId, courseId]);
    await connection.query(
      `INSERT INTO internship_posting_courses (posting_id, course_id) VALUES ?`,
      [courseValues],
    );

    await connection.commit();

    return res.status(201).json({
      message: "Internship posting created successfully.",
      success: true,
      id: postingId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Create internship posting error:", error);
    return res.status(500).json({ error: "Server failed to create posting." });
  } finally {
    if (connection) connection.release();
  }
};
