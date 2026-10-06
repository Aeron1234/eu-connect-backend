import { db } from "./db.js";

export const LIVE_DTR_LOCATION_TTL_MS = 60_000;
const STAFF_WATCH_TTL_MS = 60_000;

const roomFor = (studentId, internshipId) => `dtr-location:${studentId}:${internshipId}`;

function validPosition(value, now) {
  if (!value || typeof value !== "object") return false;
  const { latitude, longitude, accuracy, timestamp } = value;
  return typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 100_000 &&
    typeof timestamp === "number" && Number.isFinite(timestamp) &&
    timestamp <= now + 5_000 && timestamp >= now - 30_000;
}

// Positions live only in this process. They are never written to the database;
// a student stops sharing on leaving the dashboard or disconnecting.
export function createLiveDtrLocationService({ database = db, now = Date.now, ttlMs = LIVE_DTR_LOCATION_TTL_MS } = {}) {
  const locations = new Map();

  function remove(io, studentId, socketId) {
    const current = locations.get(studentId);
    if (!current || current.socketId !== socketId) return;
    clearTimeout(current.timer);
    locations.delete(studentId);
    io.to(roomFor(studentId, current.internshipId)).emit("dtr_location:update", {
      studentId, internshipId: current.internshipId, location: null,
    });
  }

  async function roleOf(userId) {
    const [rows] = await database.execute(
      `SELECT r.role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1`,
      [userId],
    );
    return rows[0]?.role;
  }

  return function attach(io, socket) {
    const userId = String(socket.data.userId);
    let watchedRoom = null;
    let watchTimer = null;
    let watchGeneration = 0;
    let shareGeneration = 0;
    let lastShareAt = 0;

    socket.on("dtr_location:share", async (position, reply) => {
      const acknowledge = typeof reply === "function" ? reply : () => {};
      const receivedAt = now();
      if (!validPosition(position, receivedAt) || receivedAt - lastShareAt < 5_000) {
        acknowledge({ ok: false, error: "Invalid or too frequent location update." });
        return;
      }
      const generation = ++shareGeneration;
      try {
        if (await roleOf(userId) !== "student") {
          acknowledge({ ok: false, error: "Only students can share a location." });
          return;
        }
        const [internships] = await database.execute(
          `SELECT id FROM internship_records
           WHERE user_id = ? AND status = 'ongoing' AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
          [userId],
        );
        const internshipId = internships[0]?.id;
        if (!internshipId || !socket.connected || generation !== shareGeneration) {
          acknowledge({ ok: false, error: "No active internship or socket connection." });
          return;
        }
        const previous = locations.get(userId);
        if (previous) {
          clearTimeout(previous.timer);
          if (previous.internshipId !== internshipId) {
            io.to(roomFor(userId, previous.internshipId)).emit("dtr_location:update", {
              studentId: userId, internshipId: previous.internshipId, location: null,
            });
          }
        }
        lastShareAt = now();
        const shared = {
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          timestamp: lastShareAt,
        };
        const timer = setTimeout(() => remove(io, userId, socket.id), ttlMs);
        timer.unref?.();
        locations.set(userId, { socketId: socket.id, internshipId, shared, timer });
        io.to(roomFor(userId, internshipId)).emit("dtr_location:update", {
          studentId: userId, internshipId, location: shared,
        });
        acknowledge({ ok: true });
      } catch (error) {
        console.error("Live DTR location share failed:", error);
        acknowledge({ ok: false, error: "Could not share location right now." });
      }
    });

    socket.on("dtr_location:stop", () => {
      shareGeneration += 1;
      remove(io, userId, socket.id);
    });

    socket.on("dtr_location:watch", async (request, reply) => {
      const acknowledge = typeof reply === "function" ? reply : () => {};
      if (watchTimer) clearTimeout(watchTimer);
      if (watchedRoom) socket.leave(watchedRoom);
      watchedRoom = null;
      const generation = ++watchGeneration;
      const studentId = request?.studentId;
      const internshipId = request?.internshipId;
      if (typeof studentId !== "string" || !studentId || typeof internshipId !== "string" || !internshipId) {
        acknowledge({ ok: false, error: "Student and internship are required." });
        return;
      }
      try {
        const role = await roleOf(userId);
        if (!["admin", "department_head", "employer"].includes(role)) {
          acknowledge({ ok: false, error: "Access denied." });
          return;
        }
        const [records] = await database.execute(
          `SELECT ir.employer_id, sai.department_id,
                  dhbi.department_id AS head_department_id
           FROM internship_records ir
           LEFT JOIN student_academic_info sai ON sai.id = (
             SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id
           )
           LEFT JOIN dept_heads_background_info dhbi ON dhbi.user_id = ?
           WHERE ir.id = ? AND ir.user_id = ? AND ir.status = 'ongoing'
             AND ir.deleted_at IS NULL LIMIT 1`,
          [userId, internshipId, studentId],
        );
        const record = records[0];
        const permitted = record && (role === "admin" ||
          (role === "employer" && String(record.employer_id) === userId) ||
          (role === "department_head" && record.department_id != null &&
            String(record.department_id) === String(record.head_department_id)));
        if (!permitted || !socket.connected || generation !== watchGeneration) {
          acknowledge({ ok: false, error: "Access denied or internship is no longer active." });
          return;
        }
        watchedRoom = roomFor(studentId, internshipId);
        socket.join(watchedRoom);
        watchTimer = setTimeout(() => {
          if (watchedRoom) socket.leave(watchedRoom);
          watchedRoom = null;
          watchGeneration += 1;
        }, STAFF_WATCH_TTL_MS);
        watchTimer.unref?.();
        const current = locations.get(studentId);
        acknowledge({ ok: true, location: current?.internshipId === internshipId &&
          now() - current.shared.timestamp < ttlMs ? current.shared : null });
      } catch (error) {
        console.error("Live DTR location subscription failed:", error);
        acknowledge({ ok: false, error: "Could not check live location access." });
      }
    });

    socket.on("dtr_location:unwatch", () => {
      watchGeneration += 1;
      if (watchTimer) clearTimeout(watchTimer);
      if (watchedRoom) socket.leave(watchedRoom);
      watchedRoom = null;
    });
    socket.on("disconnect", () => {
      shareGeneration += 1;
      watchGeneration += 1;
      if (watchTimer) clearTimeout(watchTimer);
      remove(io, userId, socket.id);
    });
  };
}
