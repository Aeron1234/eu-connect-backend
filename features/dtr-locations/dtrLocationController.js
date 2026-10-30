import { randomUUID } from "node:crypto";
import { db } from "../../config/db.js";
import { reportError } from "../../config/errorTracking.js";
import { invalidateNotificationsCache } from "../../config/cache/notificationsCache.js";
import { invalidateActivityLogsCache } from "../../config/cache/activityLogsCache.js";
import {
  validateDtrLocation,
  sameDtrLocation,
  groupDtrLocations,
} from "./locationRules.js";

export const MAX_ASSIGNMENTS = 100;
const deny = (message, status = 403) =>
  Object.assign(new Error(message), { status });
const joins = `FROM internship_records ir
  JOIN users u ON u.id = ir.user_id
  LEFT JOIN user_profiles p ON p.user_id = ir.user_id
  LEFT JOIN student_academic_info sai ON sai.id = (SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id)
  LEFT JOIN courses c ON c.id = sai.course_id
  LEFT JOIN departments d ON d.id = sai.department_id
  LEFT JOIN dtr_locations dl ON dl.internship_id = ir.id`;
const columns = `ir.id AS internship_id, ir.user_id, ir.employer_id, ir.company_name,
  p.first_name, p.last_name, p.avatar, sai.department_id, sai.course_id,
  c.course_name, c.short_name, d.name AS department_name, d.code AS department_code,
  ir.lat AS company_lat, ir.lon AS company_lon, ir.company_address,
  dl.id AS location_id, dl.lat, dl.lon, dl.radius_meters, dl.label, dl.address`;

// Resolve heads from current database membership on every read and write.
// A stale or forged department claim cannot grant access, including to Registrar.
export async function resolveDtrScope(connection, actor, lock = false) {
  if (!["admin", "department_head", "employer"].includes(actor?.role))
    throw deny("DTR location assignment is not available for this role.");
  const scope = {
    where: [
      "ir.status = 'ongoing'",
      "ir.deleted_at IS NULL",
      "u.deleted_at IS NULL",
    ],
    params: [],
  };
  if (actor.role === "department_head") {
    const [heads] = await connection.execute(
      `SELECT h.department_id, d.code FROM dept_heads_background_info h JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [actor.id],
    );
    if (!heads[0]?.department_id)
      throw deny(
        "Your department could not be verified. Contact an administrator.",
      );
    if (heads[0].code === "REG")
      throw deny("Registrar department heads cannot assign DTR locations.");
    scope.where.push("sai.department_id = ?");
    scope.params.push(heads[0].department_id);
  } else if (actor.role === "employer") {
    scope.where.push("ir.employer_id = ?");
    scope.params.push(actor.id);
  }
  return scope;
}

function readFilters(query, role) {
  const filters = { search: "" };
  if (
    query.search != null &&
    (typeof query.search !== "string" || query.search.length > 100)
  )
    throw deny("Search must be at most 100 characters.", 400);
  filters.search = query.search?.trim() || "";
  for (const key of ["departmentId", "courseId"]) {
    const value = query[key];
    if (value == null || value === "") continue;
    if (
      (key === "departmentId" && role !== "admin") ||
      (key === "courseId" && role === "employer")
    )
      throw deny("This filter is not available for your role.", 400);
    if (
      typeof value !== "string" ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw deny("Choose a valid department or course.", 400);
    filters[key] = Number(value);
  }
  return filters;
}
function filteredScope(base, filters, { search = true, course = true } = {}) {
  const scope = { where: [...base.where], params: [...base.params] };
  for (const [key, column] of [
    ["departmentId", "sai.department_id"],
    ["courseId", "sai.course_id"],
  ]) {
    if (filters[key] && (key !== "courseId" || course)) {
      scope.where.push(`${column} = ?`);
      scope.params.push(filters[key]);
    }
  }
  if (search && filters.search) {
    scope.where.push(
      "CONCAT_WS(' ', p.first_name, p.last_name) LIKE ? ESCAPE '!'",
    );
    scope.params.push(`%${filters.search.replace(/[!%_]/g, "!$&")}%`);
  }
  return scope;
}
function studentRow(row) {
  const location =
    row.location_id == null
      ? null
      : {
          lat: Number(row.lat),
          lon: Number(row.lon),
          radius_meters: Number(row.radius_meters),
          label: row.label,
          address: row.address,
        };
  return {
    internship_id: row.internship_id,
    user_id: row.user_id,
    name:
      [row.first_name, row.last_name].filter(Boolean).join(" ") || "Student",
    avatar: row.avatar,
    company_name: row.company_name,
    course_name: row.course_name,
    course_code: row.short_name,
    department_name: row.department_name,
    department_code: row.department_code,
    location,
    company_location:
      row.company_lat == null || row.company_lon == null
        ? null
        : {
            lat: Number(row.company_lat),
            lon: Number(row.company_lon),
            radius_meters: 150,
            address: row.company_address,
          },
  };
}
function handleError(res, error, context) {
  if (!error.status) reportError(context, error);
  res.status(error.status || 500).json({
    success: false,
    error: error.status
      ? error.message
      : "Could not complete the DTR location request. Refresh before trying again.",
  });
}

export async function getDtrLocationStudents(req, res) {
  let connection;
  res.set("Cache-Control", "private, no-store");
  try {
    const page = req.query.page == null ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw deny("Choose a valid page.", 400);
    const filters = readFilters(req.query, req.verifiedUser.role);
    connection = await db.getConnection();
    const base = await resolveDtrScope(connection, req.verifiedUser);
    const scope = filteredScope(base, filters);
    const [[count]] = await connection.execute(
      `SELECT COUNT(*) AS total ${joins} WHERE ${scope.where.join(" AND ")}`,
      scope.params,
    );
    const total = Number(count.total),
      pageSize = 10,
      totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const [rows] = await connection.execute(
      `SELECT ${columns} ${joins} WHERE ${scope.where.join(" AND ")} ORDER BY p.last_name, p.first_name, ir.id LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`,
      scope.params,
    );
    const departments =
      req.verifiedUser.role === "admin"
        ? (
            await connection.execute(
              `SELECT DISTINCT d.id, d.name, d.code ${joins} WHERE ${base.where.join(" AND ")} AND d.id IS NOT NULL ORDER BY d.name`,
              base.params,
            )
          )[0]
        : [];
    const courseScope = filteredScope(base, filters, {
      search: false,
      course: false,
    });
    const courses =
      req.verifiedUser.role === "employer"
        ? []
        : (
            await connection.execute(
              `SELECT DISTINCT c.id, c.course_name, c.short_name ${joins} WHERE ${courseScope.where.join(" AND ")} AND c.id IS NOT NULL ORDER BY c.course_name`,
              courseScope.params,
            )
          )[0];
    res.json({
      success: true,
      students: rows.map(studentRow),
      departments,
      courses,
      pagination: { page: currentPage, pageSize, total, totalPages },
    });
  } catch (error) {
    handleError(res, error, "DTR location student lookup:");
  } finally {
    connection?.release();
  }
}

export async function getDtrLocationPins(req, res) {
  let connection;
  res.set("Cache-Control", "private, no-store");
  try {
    const filters = readFilters(req.query, req.verifiedUser.role);
    connection = await db.getConnection();
    const scope = filteredScope(
      await resolveDtrScope(connection, req.verifiedUser),
      filters,
    );
    // Apply scope BEFORE grouping. A shared physical site never exposes another
    // department's or supervisor's students in counts or popup membership.
    const [rows] = await connection.execute(
      `SELECT ${columns} ${joins} WHERE ${scope.where.join(" AND ")} AND dl.id IS NOT NULL ORDER BY p.last_name, p.first_name, ir.id`,
      scope.params,
    );
    res.json({
      success: true,
      locations: groupDtrLocations(rows.map(studentRow)),
    });
  } catch (error) {
    handleError(res, error, "DTR location pins lookup:");
  } finally {
    connection?.release();
  }
}

export async function assignDtrLocations(req, res) {
  let connection,
    transaction = false;
  const notices = [],
    results = [];
  res.set("Cache-Control", "private, no-store");
  try {
    const location = validateDtrLocation(req.body);
    const ids = req.body.internshipIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > MAX_ASSIGNMENTS ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
            id,
          ),
      ) ||
      new Set(ids).size !== ids.length
    )
      throw deny(
        `Choose 1 to ${MAX_ASSIGNMENTS} distinct internship records.`,
        400,
      );
    const actor = req.verifiedUser;
    connection = await db.getConnection();
    await connection.beginTransaction();
    transaction = true;
    const scope = await resolveDtrScope(connection, actor, true);
    // Lock in stable ID order. Concurrent reassignment, status changes and
    // supervisor changes serialize with this write; a client selection is no authority.
    const ordered = [...ids].sort();
    const [rows] = await connection.execute(
      `SELECT ${columns} ${joins} WHERE ${scope.where.join(" AND ")} AND ir.id IN (${ordered.map(() => "?").join(",")}) ORDER BY ir.id FOR UPDATE`,
      [...scope.params, ...ordered],
    );
    const found = new Map(rows.map((row) => [row.internship_id, row]));
    const [profiles] = await connection.execute(
      "SELECT first_name, last_name FROM user_profiles WHERE user_id = ? LIMIT 1",
      [actor.id],
    );
    const actorName =
      [profiles[0]?.first_name, profiles[0]?.last_name]
        .filter(Boolean)
        .join(" ") ||
      (actor.role === "employer" ? "Your supervisor" : "School staff");
    const employerGroups = new Map(),
      changed = [];
    const site = location.address || `${location.lat}, ${location.lon}`;
    const instructions = `Be within ${location.radius_meters} meters of this location for clock-in and clock-out. Existing attendance and start-date rules still apply.${location.label ? ` Note: ${location.label}` : ""}`;
    for (const id of ordered) {
      const row = found.get(id);
      if (!row) {
        results.push({
          internship_id: id,
          status: "failed",
          reason:
            "No longer an accessible ongoing internship. Refresh your selection.",
        });
        continue;
      }
      const student = studentRow(row);
      if (sameDtrLocation(row, location)) {
        results.push({
          internship_id: id,
          status: "unchanged",
          name: student.name,
        });
        continue;
      }
      changed.push(student);
      results.push({
        internship_id: id,
        status: "assigned",
        name: student.name,
      });
      notices.push({
        user_id: row.user_id,
        title: row.location_id
          ? "DTR Location Updated"
          : "DTR Location Assigned",
        message: `${actorName} ${row.location_id ? "updated" : "assigned"} your DTR location: ${site}. ${instructions}`,
        link: "/student",
        link_uuid: id,
      });
      if (actor.role !== "employer" && row.employer_id) {
        if (!employerGroups.has(row.employer_id))
          employerGroups.set(row.employer_id, []);
        employerGroups.get(row.employer_id).push(student.name);
      }
    }
    // Bounded multi-row statements avoid a remote-database round trip for each
    // student. The same unique internship key and transaction protect all rows.
    if (changed.length)
      await connection.execute(
        `INSERT INTO dtr_locations (internship_id, set_by, lat, lon, radius_meters, label, address) VALUES ${changed.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE set_by = VALUES(set_by), lat = VALUES(lat), lon = VALUES(lon), radius_meters = VALUES(radius_meters), label = VALUES(label), address = VALUES(address), updated_at = NOW()`,
        changed.flatMap((student) => [
          student.internship_id,
          actor.id,
          location.lat,
          location.lon,
          location.radius_meters,
          location.label,
          location.address,
        ]),
      );
    const actionId = randomUUID();
    for (const [employer, names] of employerGroups)
      notices.push({
        user_id: employer,
        title: "Intern DTR Locations Updated",
        message: `${actorName} assigned or updated the DTR location for ${names.join(", ")}: ${site}. ${instructions}`,
        link: "/dtr-locations",
        link_uuid: actionId,
      });
    // Persist notifications with the assignments. Any unexpected database failure
    // rolls back this entire write set; no success or socket event precedes commit.
    if (notices.length)
      await connection.execute(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, link, link_uuid) VALUES ${notices.map(() => "(?, ?, 'dtr_location_set', ?, ?, ?, ?)").join(", ")}`,
        notices.flatMap((notice) => [
          notice.user_id,
          actor.id,
          notice.title,
          notice.message,
          notice.link,
          notice.link_uuid,
        ]),
      );
    if (changed.length)
      await connection.execute(
        "INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description) VALUES (?, ?, ?, ?, ?, ?)",
        [
          actor.id,
          actor.role,
          "dtr_locations_assigned",
          "dtr_locations",
          actionId,
          `${actorName} assigned a DTR location to ${changed.length} internship record(s): ${changed.map((s) => s.name).join(", ")}. Location: ${site}; radius: ${location.radius_meters} meters.`,
        ],
      );
    await connection.commit();
    transaction = false;
    // Delivery/cache failures after a committed write must not report a rollback.
    try {
      if (changed.length) {
        invalidateNotificationsCache();
        invalidateActivityLogsCache();
      }
      const io = req.app.get("socketio");
      for (const notice of notices)
        io?.to(`user-${notice.user_id}`).emit("new_notification", {
          ...notice,
          user_id: undefined,
          type: "dtr_location_set",
        });
      io?.to(`user-${actor.id}`).emit("dtr_locations_changed", {});
    } catch (error) {
      reportError("Committed DTR location delivery:", error);
    }
    const summary = {
      assigned: results.filter((r) => r.status === "assigned").length,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      failed: results.filter((r) => r.status === "failed").length,
    };
    res.json({
      success: true,
      results,
      summary,
      message: `${summary.assigned} assigned, ${summary.unchanged} unchanged, ${summary.failed} not assigned.`,
    });
  } catch (error) {
    if (transaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        reportError("DTR location rollback:", rollbackError);
      }
    }
    handleError(res, error, "Bulk DTR location assignment:");
  } finally {
    connection?.release();
  }
}
