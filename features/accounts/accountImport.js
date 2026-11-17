import { db } from "../../config/db.js";
import { createUser } from "./controllers/accountControllers.js";
import { validateStudentIdentity } from "./studentIdentity.mjs";

const columns = ["first_name", "middle_initial", "last_name", "email", "school_id", "course_code", "gender"];
const requiredColumns = ["first_name", "last_name", "email", "course_code", "gender"];

export function parseAccountCsv(csv) {
  if (typeof csv !== "string" || Buffer.byteLength(csv, "utf8") > 256 * 1024) throw new Error("Upload a CSV of at most 256 KB.");
  const records = [];
  let record = [], value = "", quoted = false, closed = false;
  const pushValue = () => { record.push(value.trim()); value = ""; closed = false; };
  const pushRecord = () => {
    pushValue();
    if (record.some(Boolean)) records.push(record);
    record = [];
    if (records.length > 101) throw new Error("Import at most 100 students at a time.");
  };
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      if (char === ",") pushValue();
      else { pushRecord(); if (char === "\r" && text[i + 1] === "\n") i++; }
    } else if (char === '"' && !value && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting. Export the file as CSV UTF-8.");
      value += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (value || record.length || closed) pushRecord();
  const headers = records.shift()?.map(s => s.toLowerCase()) ?? [];
  if (!records.length) throw new Error("Include a header and at least one student.");
  if (new Set(headers).size !== headers.length || headers.some(s => !columns.includes(s)) || requiredColumns.some(s => !headers.includes(s))) {
    throw new Error("Use the provided CSV template with its original column names.");
  }
  return records.map((values, index) => ({
    row: index + 2,
    data: Object.fromEntries(headers.map((key, n) => [key, values[n] ?? ""])),
    error: values.length !== headers.length ? "Column count does not match the header." : null,
  }));
}

export async function previewStudents(csv) {
  const rows = parseAccountCsv(csv);
  const connection = await db.getConnection();
  try {
    const [courses] = await connection.execute("SELECT id, short_name FROM courses WHERE is_active = 1");
    const [roles] = await connection.execute("SELECT id FROM roles WHERE role = 'student'");
    if (!roles.length) throw new Error("The student role is unavailable.");
    const seenEmails = new Set(), seenIds = new Set(), reservedNames = new Set();
    for (const row of rows) {
      if (row.error) continue;
      try {
        const data = row.data;
        if (!data.first_name || !data.last_name || [...data.first_name].length > 50 || [...data.last_name].length > 50) throw new Error("First and last names are required and must be at most 50 characters.");
        if (/[\r\n\t]/.test(data.first_name + data.last_name)) throw new Error("Names must be on one line.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 50) throw new Error("Enter a valid email address of at most 50 characters.");
        if (data.middle_initial && !/^[A-Za-z]\.?$/.test(data.middle_initial)) throw new Error("Middle initial must be one letter.");
        if (!["male", "female"].includes(data.gender)) throw new Error("Gender must be male or female.");
        const matchedCourses = courses.filter(c => c.short_name?.toLowerCase() === data.course_code.toLowerCase());
        if (matchedCourses.length !== 1) throw new Error("Course code must match exactly one active course.");
        const { username: base, schoolId } = validateStudentIdentity(data);
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
            if (schoolId) throw new Error("Generated username is already taken.");
            suffix++;
            const ending = "." + suffix;
            username = [...base].slice(0, 50 - ending.length).join("") + ending;
          }
          if (suffix > 1000) throw new Error("Add a school ID to allocate a unique username.");
        } while (taken);
        reservedNames.add(username.toLowerCase());
        row.username = username;
        row.account = { ...data, school_id: schoolId, course: String(matchedCourses[0].id), role: String(roles[0].id) };
      } catch (error) { row.error = error.message; }
    }
    return rows;
  } finally { connection.release(); }
}

export async function previewAccountImport(req, res) {
  try {
    const rows = await previewStudents(req.body?.csv);
    return res.json({ success: true, rows: rows.map(({ account, ...row }) => row) });
  } catch (error) {
    const validation = error instanceof Error && !error.code;
    return res.status(validation ? 400 : 500).json({ success: false,
      error: validation ? error.message : "Could not validate the file. Verify the account import migration." });
  }
}

export async function importStudentAccounts(req, res) {
  try {
    const rows = await previewStudents(req.body?.csv);
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
  } catch {
    return res.status(400).json({ success: false, error: "Could not import the CSV. Refresh the preview and try again." });
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

