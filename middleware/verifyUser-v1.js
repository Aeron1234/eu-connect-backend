import { db } from "../config/db.js"; // Added .js extension

export const verifyUser = async (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const userId = req.query.userId || req.body.userId;

  try {
    // 1. Handshake
    if (apiKey !== process.env.BACKEND_SECRET_KEY) {
      return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }

    // 2. Query the DB and JOIN the roles table to get the name (e.g., 'admin')
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

    if (user.role === "student" || user.role === "department_head") {
      // Determine which table to look in
      const tableName =
        user.role === "student"
          ? "student_academic_info"
          : "dept_heads_background_info";

      const [courseRows] = await db.execute(
        `
            SELECT course_id 
            FROM ${tableName}
            WHERE user_id = ?
            `,
        [user.id],
      );

      if (courseRows.length > 0) {
        user.course_id = courseRows[0].course_id;
      }
    }

    // 3. Attach the REAL data from the DB to the request
    // This ignores whatever 'role' they sent in the body and uses the DB truth
    req.verifiedUser = {
      id: user.id,
      role: user.role, // Now this is "admin" or "student"
      course_id: user.course_id || null, // Only for students and department heads
    };

    next();
  } catch (err) {
    console.error("Auth Middleware Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
