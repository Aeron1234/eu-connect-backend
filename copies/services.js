import { db } from "@/lib/db";
import { auth } from "./auth";
import { cache } from "react";

export const getUserSession = cache(async () => {
  const session = await auth();

  return session;
});

// DONE
export const getOngoingInternshipRecord = cache(async () => {
  try {
    const session = await getUserSession();
    if (!session?.user || !["student", "admin"].includes(session.user.role)) {
      throw new Error("Unauthorized");
    }
    const user = session.user;

    const [rows] = await db.execute(
      `SELECT * FROM internship_records
       WHERE user_id = ? AND status = "ongoing"
       LIMIT 1`,
      [user.id],
    );

    return rows[0] || null;
  } catch (err) {
    return null;
  }
});

// For the Map Page, we need to fetch all ongoing internships for the department head
// DONE
export const getActiveInternships = cache(async () => {
  try {
    const session = await getUserSession();
    if (
      !session?.user ||
      !["department_head", "admin"].includes(session.user.role)
    ) {
      throw new Error("Unauthorized");
    }

    const [rows] = await db.execute(
      `SELECT ir.id, ir.user_id, ir.company_name, ir.company_address, ir.lon, ir.lat, ir.state_or_province, up.first_name, up.last_name, c.course_name
        FROM internship_records AS ir
       INNER JOIN user_profiles AS up ON ir.user_id = up.user_id
       INNER JOIN student_academic_info AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses AS c ON sai.course_id = c.id
       WHERE ir.status = "ongoing"
       `,
    );

    return rows || null;
  } catch (err) {
    return null;
  }
});

// For user account page
// DONE
export const getUserProfile = cache(async () => {
  try {
    const session = await getUserSession();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const userId = session.user.id;
    const userRole = session.user.role;

    const [rows] = await db.execute(
      `SELECT up.*, u.email 
       FROM user_profiles AS up
       INNER JOIN users AS u on up.user_id = u.id
       WHERE user_id = ?
       LIMIT 1`,
      [userId],
    );

    return rows[0] || null;
  } catch (err) {
    return null;
  }
});

// NEW: Optimized for checking status without downloading the whole history
// DONE
export async function getTodayDtr() {
  try {
    const session = await getUserSession();
    if (!session?.user || !["student", "admin"].includes(session.user.role)) {
      throw new Error("Unauthorized");
    }
    const user = session.user;

    const internshipData = await getOngoingInternshipRecord();
    if (!internshipData) throw new Error("No ongoing internship found.");

    const [rows] = await db.execute(
      `SELECT * FROM daily_time_records 
       WHERE user_id = ? AND DATE(created_at) = CURDATE() AND internship_id = ?
       LIMIT 1`,
      [user.id, internshipData.id],
    );
    return rows[0] || null;
  } catch (err) {
    return null;
  }
}

export async function checkDtrStatus() {
  // Use the new optimized query instead of fetching all DTRs
  const dtrRecordToday = await getTodayDtr();

  if (!dtrRecordToday) return { status: "clocked-out" };

  if (dtrRecordToday.clock_in && !dtrRecordToday.clock_out) {
    return { status: "clocked-in" };
  }

  return { status: "clocked-out" };
}

//DONE
export const getInternshipFiles = cache(async () => {
  try {
    const session = await getUserSession();
    if (
      !session?.user ||
      !["student", "department_head", "admin"].includes(session.user.role)
    ) {
      throw new Error("Unauthorized");
    }
    const userId = session.user.id;

    const [rows] = await db.execute(
      `SELECT * FROM internship_documents
       WHERE user_id = ?
       `,
      [userId],
    );

    return rows || null;
  } catch (err) {
    return null;
  }
});

// DONE
export const getRoles = cache(async () => {
  try {
    const session = await getUserSession();
    if (!session?.user || !["admin"].includes(session.user.role)) {
      throw new Error("Unauthorized");
    }

    const [rows] = await db.execute(`SELECT * FROM roles`);

    return rows || null;
  } catch (err) {
    return null;
  }
});

// DONE
export const getCourses = cache(async () => {
  try {
    const session = await getUserSession();
    if (
      !session?.user ||
      !["department_head", "student", "admin"].includes(session.user.role)
    ) {
      throw new Error("Unauthorized");
    }

    const [rows] = await db.execute(`SELECT * FROM courses`);

    return rows || null;
  } catch (err) {
    return null;
  }
});

// DONE
export const getAllAccounts = cache(async () => {
  try {
    const session = await getUserSession();
    if (!session?.user || !["admin"].includes(session.user.role)) {
      throw new Error("Unauthorized");
    }

    // ROLES : 1 = Student, 2 = Employer, 3 = Department Head, 4 = Admin

    //For students and dep. heads
    const [school] = await db.execute(
      `
      SELECT u.id, u.email, u.created_at, u.status, up.first_name, up.last_name, r.role, c.course_name
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      INNER JOIN student_academic_info AS sai ON u.id = sai.user_id
      INNER JOIN courses AS c ON c.id = sai.course_id
      WHERE u.role_id IN(1,3)
      `,
    );

    //For employers
    const [employers] = await db.execute(
      `
      SELECT u.id, u.email, u.created_at, u.status, up.first_name, up.last_name, r.role
      FROM users AS u
      INNER JOIN user_profiles AS up ON u.id = up.user_id
      INNER JOIN roles AS r ON u.role_id = r.id
      WHERE u.role_id = 2
      `,
    );

    const allUserAccounts = [...school, ...employers]
      .sort((a, b) => a.last_name.localeCompare(b.last_name))
      .sort((a, b) => a.status.localeCompare(b.status));

    return allUserAccounts || null;
  } catch (err) {
    return null;
  }
});

// Keep this for the History Table, but add a LIMIT or Sort
