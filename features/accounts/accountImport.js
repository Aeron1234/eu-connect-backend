import { db } from "../../config/db.js";
import { createUser } from "./controllers/accountControllers.js";
import { validateStudentIdentity } from "./studentIdentity.mjs";

import { parseAccountCsv } from "./accountCsv.mjs";
export { parseAccountCsv } from "./accountCsv.mjs";

export async function previewAccounts(csv, role) {
  const rows = parseAccountCsv(csv, role);
  const connection = await db.getConnection();
  try {
    const [roles] = await connection.execute("SELECT id FROM roles WHERE role = ?", [role]);
    if (!roles.length) throw new Error("The selected account role is unavailable.");
    const [courses] = role === "student"
      ? await connection.execute("SELECT id, short_name FROM courses WHERE is_active = 1")
      : [[]];
    const [departments] = role === "department_head"
      ? await connection.execute("SELECT id, code FROM departments WHERE is_active = 1")
      : [[]];
    const seenEmails = new Set(), seenIds = new Set(), reservedNames = new Set();
    for (const row of rows) {
      if (row.error) continue;
      try {
        const data = row.data;
        if (!data.first_name || !data.last_name || [...data.first_name].length > 50 || [...data.last_name].length > 50) throw new Error("First and last names are required and must be at most 50 characters.");
        if (/[\r\n\t]/.test(data.first_name + data.last_name)) throw new Error("Names must be on one line.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 50) throw new Error("Enter a valid email address of at most 50 characters.");
        if (data.middle_initial && !/^[A-Za-z]\.?$/.test(data.middle_initial)) throw new Error("Middle initial must be one letter.");
        const account = { ...data, role: String(roles[0].id) };
        let base = data.username;
        let schoolId = "";
        if (role === "student") {
          if (!["male", "female"].includes(data.gender)) throw new Error("Gender must be male or female.");
          const matches = courses.filter(course => course.short_name?.toLowerCase() === data.course_code.toLowerCase());
          if (matches.length !== 1) throw new Error("Course code must match exactly one active course.");
          ({ username: base, schoolId } = validateStudentIdentity(data));
          account.course = String(matches[0].id);
          account.school_id = schoolId;
        } else if (!base || [...base].length > 50 || /[\r\n\t]/.test(base)) {
          throw new Error("Enter a username on one line with at most 50 characters.");
        }
        if (role === "department_head") {
          const matches = departments.filter(department => department.code?.toLowerCase() === data.department_code.toLowerCase());
          if (matches.length !== 1) throw new Error("Department code must match exactly one active department.");
          account.department = String(matches[0].id);
        }
        const emailKey = data.email.toLowerCase();
        if (seenEmails.has(emailKey)) throw new Error("Duplicate email within this file.");
        if (schoolId && seenIds.has(schoolId)) throw new Error("Duplicate school ID within this file.");
        seenEmails.add(emailKey);
        if (schoolId) seenIds.add(schoolId);
        const [existing] = await connection.execute("SELECT id FROM users WHERE email = ?", [data.email]);
        if (existing.length) throw new Error("Email already belongs to an account.");
        if (schoolId) {
          const [legacy] = await connection.execute("SELECT user_id FROM student_academic_info WHERE UPPER(TRIM(student_number)) = ? LIMIT 1", [schoolId]);
          if (legacy.length) throw new Error("School ID already belongs to an account.");
          const [ids] = await connection.execute("SELECT user_id FROM user_profiles WHERE school_id = ?", [schoolId]);
          if (ids.length) throw new Error("School ID already belongs to an account.");
        }
        let username = base, suffix = 1;
        let taken;
        do {
          const [names] = await connection.execute("SELECT id FROM users WHERE username = ?", [username]);
          taken = names.length || reservedNames.has(username.toLowerCase());
          if (taken) {
            if (role !== "student") throw new Error("Username is already taken.");
            if (schoolId) throw new Error("Generated username is already taken.");
            suffix++;
            const ending = "." + suffix;
            username = [...base].slice(0, 50 - ending.length).join("") + ending;
          }
          if (suffix > 1000) throw new Error("Add a school ID to allocate a unique username.");
        } while (taken);
        reservedNames.add(username.toLowerCase());
        row.username = username;
        row.account = { ...account, username };
      } catch (error) { row.error = error.message; }
    }
    return rows;
  } finally { connection.release(); }
}

export async function previewAccountImport(req, res) {
  try {
    const rows = await previewAccounts(req.body?.csv, req.body?.role);
    return res.json({ success: true, rows: rows.map(({ account, ...row }) => row) });
  } catch (error) {
    const validation = error instanceof Error && !error.code;
    return res.status(validation ? 400 : 500).json({ success: false,
      error: validation ? error.message : "Could not validate the file. Verify the account import migration." });
  }
}

export async function importAccounts(req, res) {
  try {
    const rows = await previewAccounts(req.body?.csv, req.body?.role);
    const results = [];
    for (const row of rows) {
      if (row.error) {
        results.push({ row: row.row, data: row.data, status: "skipped", message: row.error });
        continue;
      }
      let statusCode = 200, result;
      const response = {
        status(code) { statusCode = code; return this; },
        json(body) { result = body; return this; },
      };
      await createUser({ body: row.account, verifiedUser: req.verifiedUser, queueAccountInvitation: true }, response);
      results.push({
        row: row.row, data: row.data, status: result?.success ? "created" : "failed",
        username: result?.username ?? row.username, accountId: result?.accountId,
        invitation_status: result?.success ? "pending" : undefined,
        message: result?.message || result?.error || ("Creation failed (" + statusCode + ")."),
      });
    }
    return res.json({ success: true, results });
  } catch (error) {
    const validation = error instanceof Error && !error.code;
    return res.status(validation ? 400 : 500).json({ success: false,
      error: validation ? error.message : "Could not import the CSV. Refresh the preview and try again." });
  }
}

export async function accountImportInvitations(req, res) {
  const ids = typeof req.body?.ids === "object" && Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) {
    return res.status(400).json({ error: "Provide 1 to 100 account IDs." });
  }
  try {
    const [rows] = await db.execute(
      "SELECT user_id, status FROM account_invitation_jobs WHERE user_id IN (" + ids.map(() => "?").join(",") + ")", ids);
    return res.json({ success: true, invitations: rows });
  } catch { return res.status(500).json({ error: "Could not refresh invitation status." }); }
}

