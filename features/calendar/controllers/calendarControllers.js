import { targetedSchoolAccess } from '../../announcements/studentTags.js';
import { reportError } from "../../../config/errorTracking.js";
import { db } from "../../../config/db.js";
import { invalidateNotificationsCache } from "../../../config/cache/notificationsCache.js";

const ROLES = new Set(["student", "department_head", "admin"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Use a half-open month interval [first day, next month) for SQL overlap tests.
// Event end dates remain inclusive within that interval.
function monthBounds(month) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split("-").map(Number);
  if (year < 2000 || year > 2100) return null;
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  return [`${month}-01`, next];
}

function safeText(value, max) {
  return typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
}

function sendFailure(res, error) {
  reportError("Calendar request failed:", error);
  return res.status(500).json({ success: false, error: "Calendar request failed. Please try again." });
}

const dateSql = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;

export async function getCalendarMonth(req, res) {
  try {
    const viewer = req.verifiedUser;
    if (!ROLES.has(viewer.role)) return res.status(403).json({ error: "Not allowed" });
    const bounds = monthBounds(req.query.month);
    if (!bounds) return res.status(400).json({ error: "A valid month is required." });
    const [from, until] = bounds;
    const departmentId = viewer.role === "employer" ? -1 : viewer.department_id ?? -1;
    const isRegistrar = viewer.role === "department_head" && viewer.department_code === "REG";

    // The role guard already excludes employers. Keep registrar General-only reads
    // and author-department visibility aligned with the announcement feed.
    const [announcements] = viewer.role === "employer" ? [[]] : await db.execute(
      `SELECT a.public_id AS id, a.title, a.content, ${dateSql("a.event_date")} AS event_date,
              ${dateSql("a.event_end_date")} AS event_end_date,
              ac.name AS category
         FROM announcements a
         JOIN announcement_categories ac ON ac.id = a.category_id
         LEFT JOIN dept_heads_background_info author_dept ON author_dept.user_id = a.author_id
        WHERE a.event_date < ? AND COALESCE(a.event_end_date, a.event_date) >= ?
          ${isRegistrar ? "AND ac.name = 'General'" : ""}
          AND ((a.tagged_students_only=0 AND (ac.name != 'Department' OR ? = 'admin' OR author_dept.department_id = ?)) OR (a.tagged_students_only=1 AND ${targetedSchoolAccess('a','?')}))
        ORDER BY a.event_date, a.id`,
      [until, from, viewer.role, departmentId, viewer.id],
    );

    // Include any schedule overlapping the month, even if it starts before the first.
    // A null department is school-wide; admin can also view department schedules.
    const [schedules] = await db.execute(
      `SELECT id, created_by, department_id, title, description,
              ${dateSql("starts_on")} AS starts_on, ${dateSql("ends_on")} AS ends_on
         FROM calendar_schedules
        WHERE starts_on < ? AND ends_on >= ?
          AND (department_id IS NULL OR ? = 'admin' OR department_id = ?)
        ORDER BY starts_on, id`,
      [until, from, viewer.role, departmentId],
    );

    let internship = null;
    let todos = [];
    if (viewer.role === "student") {
      const [[record]] = await db.execute(
        `SELECT id, company_name, ${dateSql("date_started")} AS date_started,
                ${dateSql("date_ended")} AS date_ended
           FROM internship_records
          WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [viewer.id],
      );
      internship = record ?? null;
      [todos] = await db.execute(
        `SELECT id, internship_id, ${dateSql("todo_date")} AS todo_date, title, is_done
           FROM calendar_todos
          WHERE user_id = ? AND todo_date >= ? AND todo_date < ?
          ORDER BY todo_date, created_at, id`,
        [viewer.id, from, until],
      );
    }

    return res.json({ announcements, schedules, internship, todos });
  } catch (error) {
    return sendFailure(res, error);
  }
}

export async function getCalendarSchedule(req, res) {
  try {
    const viewer = req.verifiedUser;
    if (!ROLES.has(viewer.role)) return res.status(403).json({ error: "Not allowed" });
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: "Schedule not found." });
    const [[row]] = await db.execute(
      `SELECT id, department_id, title, description,
              ${dateSql("starts_on")} AS starts_on, ${dateSql("ends_on")} AS ends_on
         FROM calendar_schedules WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!row || (row.department_id != null && (viewer.role === "employer" || (viewer.role !== "admin" && Number(row.department_id) !== Number(viewer.department_id))))) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    return res.json(row);
  } catch (error) {
    return sendFailure(res, error);
  }
}

// New private to-dos must fall within an owned ongoing, non-deleted internship.
// Updating title/completion or deleting an existing to-do uses ownership separately.
async function activeInternshipOn(connection, userId, date) {
  const [[record]] = await connection.execute(
    `SELECT id FROM internship_records
      WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL
        AND date_started <= ? AND date_ended >= ?
      ORDER BY created_at DESC LIMIT 1`,
    [userId, date, date],
  );
  return record;
}

export async function createCalendarTodo(req, res) {
  try {
    const date = req.body?.date;
    const title = safeText(req.body?.title, 160);
    if (!validDate(date) || !title) return res.status(400).json({ error: "Valid date and title are required." });
    const record = await activeInternshipOn(db, req.verifiedUser.id, date);
    if (!record) return res.status(400).json({ error: "To-dos must be dated within your ongoing internship." });
    const [result] = await db.execute(
      `INSERT INTO calendar_todos (user_id, internship_id, todo_date, title) VALUES (?, ?, ?, ?)`,
      [req.verifiedUser.id, record.id, date, title],
    );
    return res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    return sendFailure(res, error);
  }
}

export async function updateCalendarTodo(req, res) {
  try {
    const { id } = req.params;
    const { title, is_done } = req.body ?? {};
    if (title === undefined && is_done === undefined) return res.status(400).json({ error: "No changes supplied." });
    const fields = [];
    const params = [];
    if (title !== undefined) {
      const clean = safeText(title, 160);
      if (!clean) return res.status(400).json({ error: "A valid title is required." });
      fields.push("title = ?");
      params.push(clean);
    }
    if (is_done !== undefined) {
      if (typeof is_done !== "boolean") return res.status(400).json({ error: "Invalid completion value." });
      fields.push("is_done = ?");
      params.push(is_done ? 1 : 0);
    }
    const [result] = await db.execute(
      `UPDATE calendar_todos SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      [...params, id, req.verifiedUser.id],
    );
    return result.affectedRows ? res.json({ success: true }) : res.status(404).json({ error: "To-do not found." });
  } catch (error) {
    return sendFailure(res, error);
  }
}

export async function deleteCalendarTodo(req, res) {
  try {
    const [result] = await db.execute("DELETE FROM calendar_todos WHERE id = ? AND user_id = ?", [req.params.id, req.verifiedUser.id]);
    return result.affectedRows ? res.json({ success: true }) : res.status(404).json({ error: "To-do not found." });
  } catch (error) {
    return sendFailure(res, error);
  }
}

// Persist alerts in the schedule transaction. Department audiences use each
// student's latest academic row; school-wide schedules target all student accounts.
async function notifyStudents(connection, req, scheduleId, title, date, departmentId, action) {
  const [students] = await connection.execute(
    `SELECT DISTINCT u.id
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN (
         SELECT sai.user_id, sai.department_id FROM student_academic_info sai
         JOIN (SELECT user_id, MAX(id) AS max_id FROM student_academic_info GROUP BY user_id) latest
           ON latest.max_id = sai.id
       ) student_department ON student_department.user_id = u.id
      WHERE r.role = 'student' AND (? IS NULL OR student_department.department_id = ?)`,
    [departmentId, departmentId],
  );
  if (students.length) {
    const notificationTitle = action === "created" ? "New calendar schedule" : action === "deleted" ? "Calendar schedule canceled" : "Calendar schedule updated";
    const values = students.map(({ id }) => [id, req.verifiedUser.id, "calendar_schedule", notificationTitle, `${title} · ${date}`, action === "deleted" ? null : String(scheduleId)]);
    await connection.query("INSERT INTO notifications (user_id, sender_id, type, title, message, link) VALUES ?", [values]);
  }
  return students;
}

// Called after commit to invalidate notification reads and emit recipient-scoped
// alerts. Cancellation alerts have no link to the deleted schedule.
function broadcastSchedule(req, recipients, scheduleId, title, date, action) {
  invalidateNotificationsCache();
  const io = req.app.get("socketio");
  for (const { id } of recipients) {
    io?.to(`user-${id}`).emit("new_notification", {
      type: "calendar_schedule",
      title: action === "created" ? "New calendar schedule" : action === "deleted" ? "Calendar schedule canceled" : "Calendar schedule updated",
      message: `${title} · ${date}`,
      link: action === "deleted" ? null : String(scheduleId),
    });
  }
}

function scheduleInput(req, res) {
  const title = safeText(req.body?.title, 160);
  const description = req.body?.description == null || req.body.description === "" ? null : safeText(req.body.description, 2000);
  const startsOn = req.body?.starts_on;
  const endsOn = req.body?.ends_on;
  if (!title || (req.body?.description && !description) || !validDate(startsOn) || !validDate(endsOn) || startsOn > endsOn) {
    res.status(400).json({ error: "Enter a title and valid start/end dates." });
    return null;
  }
  return { title, description, startsOn, endsOn };
}

// Route guards permit school staff only. Admin creates school-wide schedules;
// department heads create schedules for their assigned department.
export async function createCalendarSchedule(req, res) {
  const input = scheduleInput(req, res);
  if (!input) return;
  const viewer = req.verifiedUser;
  const departmentId = viewer.role === "admin" ? null : viewer.department_id;
  if (viewer.role === "department_head" && departmentId == null) return res.status(403).json({ error: "A department is required." });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO calendar_schedules (created_by, department_id, title, description, starts_on, ends_on)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [viewer.id, departmentId, input.title, input.description, input.startsOn, input.endsOn],
    );
    const recipients = await notifyStudents(connection, req, result.insertId, input.title, input.startsOn, departmentId, "created");
    await connection.commit();
    broadcastSchedule(req, recipients, result.insertId, input.title, input.startsOn, "created");
    return res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendFailure(res, error);
  } finally {
    connection?.release();
  }
}

// Lock before author/admin checks. Edits keep the stored audience, replace linked
// alerts in the transaction, then broadcast after commit.
export async function updateCalendarSchedule(req, res) {
  const input = scheduleInput(req, res);
  if (!input) return;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[schedule]] = await connection.execute("SELECT created_by, department_id FROM calendar_schedules WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!schedule || (req.verifiedUser.role !== "admin" && String(schedule.created_by) !== String(req.verifiedUser.id))) {
      await connection.rollback();
      return res.status(404).json({ error: "Schedule not found." });
    }
    await connection.execute(
      `UPDATE calendar_schedules SET title = ?, description = ?, starts_on = ?, ends_on = ? WHERE id = ?`,
      [input.title, input.description, input.startsOn, input.endsOn, req.params.id],
    );
    await connection.execute("DELETE FROM notifications WHERE type = 'calendar_schedule' AND link = ?", [String(req.params.id)]);
    const recipients = await notifyStudents(connection, req, req.params.id, input.title, input.startsOn, schedule.department_id, "updated");
    await connection.commit();
    broadcastSchedule(req, recipients, req.params.id, input.title, input.startsOn, "updated");
    return res.json({ success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendFailure(res, error);
  } finally {
    connection?.release();
  }
}

export async function deleteCalendarSchedule(req, res) {
  let connection;
  try {
    const viewer = req.verifiedUser;
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[schedule]] = await connection.execute(
      `SELECT created_by, department_id, title, ${dateSql("starts_on")} AS starts_on
         FROM calendar_schedules WHERE id = ? FOR UPDATE`,
      [req.params.id],
    );
    if (!schedule || (viewer.role !== "admin" && String(schedule.created_by) !== String(viewer.id))) {
      await connection.rollback();
      return res.status(404).json({ error: "Schedule not found." });
    }
    await connection.execute("DELETE FROM calendar_schedules WHERE id = ?", [req.params.id]);
    await connection.execute("DELETE FROM notifications WHERE type = 'calendar_schedule' AND link = ?", [String(req.params.id)]);
    const recipients = await notifyStudents(connection, req, req.params.id, schedule.title, schedule.starts_on, schedule.department_id, "deleted");
    await connection.commit();
    broadcastSchedule(req, recipients, req.params.id, schedule.title, schedule.starts_on, "deleted");
    return res.json({ success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendFailure(res, error);
  } finally {
    connection?.release();
  }
}
