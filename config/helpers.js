import { v4 as uuidv4 } from "uuid";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Calculates distance between two coordinates and checks if it's within radius.
 *
 * @param {number|string} lat1 - Student's current latitude
 * @param {number|string} lon1 - Student's current longitude
 * @param {number|string} lat2 - Required DTR target latitude
 * @param {number|string} lon2 - Required DTR target longitude
 * @param {number} radiusMeters - Allowed radius from dtr_locations (e.g. 100)
 * @returns {{ isWithin: boolean, distanceMeters: number }}
 */
export function isWithinRadius(lat1, lon1, lat2, lon2, radiusMeters = 100) {
  // Convert string inputs to numbers to prevent string concatenation bugs
  const userLat = Number(lat1);
  const userLon = Number(lon1);
  const targetLat = Number(lat2);
  const targetLon = Number(lon2);

  const R = 6371000; // Earth's mean radius in meters
  const toRad = Math.PI / 180;

  const dLat = (targetLat - userLat) * toRad;
  const dLon = (targetLon - userLon) * toRad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(userLat * toRad) *
      Math.cos(targetLat * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = Math.round(R * c); // Distance rounded to nearest meter

  return {
    isWithin: distanceMeters <= Number(radiusMeters),
    distanceMeters,
  };
}

export function newUUID() {
  return uuidv4();
}

export const UPLOAD_ROOT = path.join(
  process.cwd(),
  "private-uploads",
  "internship-documents",
);

export const ALLOWED_TYPES = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
];

// Verifies the requester can access this internship record, and returns
// the record's basic info + department_id. Throws a { status, message }
// object on any failure, so callers can catch and respond consistently.
export async function verifyRecordAccess(
  connection,
  internshipId,
  requesterId,
  role,
) {
  if (!["department_head", "admin"].includes(role)) {
    throw { status: 403, message: "Access denied." };
  }

  const [rows] = await connection.execute(
    `SELECT ir.id, ir.deleted_at, sai.department_id
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
     WHERE ir.id = ?`,
    [internshipId],
  );

  if (rows.length === 0 || rows[0].deleted_at !== null) {
    throw { status: 404, message: "Internship record not found." };
  }

  if (role === "department_head") {
    const [deptHeadRows] = await connection.execute(
      `SELECT department_id FROM dept_heads_background_info WHERE user_id = ? LIMIT 1`,
      [requesterId],
    );
    if (
      deptHeadRows.length === 0 ||
      deptHeadRows[0].department_id !== rows[0].department_id
    ) {
      throw {
        status: 403,
        message: "You can only view records within your own department.",
      };
    }
  }

  return rows[0];
}

export const isRegistrarHeadOrAdmin = async (connection, verifiedUser) => {
  const { id: userId, role } = verifiedUser;

  if (role === "admin") return true;

  if (role !== "department_head") return false;

  const [rows] = await connection.execute(
    `SELECT 1
     FROM dept_heads_background_info dhbi
     INNER JOIN departments d ON dhbi.department_id = d.id
     WHERE dhbi.user_id = ? AND d.code = 'REG'
     LIMIT 1`,
    [userId],
  );

  return rows.length > 0;
};

// utils/academicYear.js
export function getCurrentAcademicYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // JS months are 0-indexed

  return month >= 7
    ? `${year}-${year + 1}` // Jul–Dec: e.g. Aug 2026 -> "2026-2027"
    : `${year - 1}-${year}`; // Jan–Jun: e.g. Mar 2027 -> "2026-2027"
}
