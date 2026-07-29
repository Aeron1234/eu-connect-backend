import { db } from "../config/db.js";

export const verifyUser = async (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const userId = req.query.userId || req.body.userId;

  try {
    if (apiKey !== process.env.BACKEND_SECRET_KEY) {
      return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }

    const [rows] = await db.execute(
      `SELECT u.id, r.role 
       FROM users AS u 
       JOIN roles AS r ON u.role_id = r.id 
       WHERE u.id = ?`,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User does not exist" });
    }

    const user = rows[0];

    if (user.role === "student") {
      const [courseRows] = await db.execute(
        `
          SELECT 
            c.id AS course_id, 
            d.id AS department_id
          FROM student_academic_info AS sai
          LEFT JOIN courses AS c ON c.id = sai.course_id
          LEFT JOIN departments AS d ON d.id = sai.department_id
          WHERE sai.user_id = ?
        `,
        [user.id], // Fixed: changed user.user_uuid -> user.id
      );

      if (courseRows.length > 0) {
        user.course_id = courseRows[0].course_id;
        user.department_id = courseRows[0].department_id;
      }
    }

    if (user.role === "department_head") {
      const [deptRows] = await db.execute(
        `
          SELECT
            d.id AS department_id
          FROM dept_heads_background_info AS dhbi
          LEFT JOIN departments AS d ON d.id = dhbi.department_id
          WHERE dhbi.user_id = ?
        `,
        [user.id], // Fixed: changed user.user_uuid -> user.id
      );

      if (deptRows.length > 0) {
        user.department_id = deptRows[0].department_id;
      }
    }

    req.verifiedUser = {
      id: user.id,
      role: user.role,
      course_id: user.course_id || null,
      department_id: user.department_id || null, // Fixed: user.department_code reference
    };

    next();
  } catch (err) {
    console.error("Auth Middleware Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
