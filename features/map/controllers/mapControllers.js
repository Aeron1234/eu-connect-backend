import { reportError } from "../../../config/errorTracking.js";
import { db } from "../../../config/db.js";
import { mapOrigin } from "../mapRouting.js";

// Staff visit planning spans departments and includes live ongoing internships
// only. Current course labels come from each student's latest academic row.
export const getStudentMap = async (req, res) => {
  let connection;
  try {
    const { role } = req.verifiedUser;

    if (!["department_head", "admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied." });
    }

    connection = await db.getConnection();

    // mysql2's underlying prepared command streams rows in the same order and
    // types as execute(), without retaining a second full result array.
    const rows = connection.connection
      .execute(
        `SELECT 
         ir.id, ir.company_name, ir.company_address, ir.city_name, ir.province_name, ir.internship_position,
         ir.lat, ir.lon, ir.date_started, ir.date_ended, ir.total_hours,
         ir.accumulated_hours, ir.user_id, ir.region_id,
         up.first_name, up.last_name,
         c.course_name, c.short_name AS course_short_name,
         r.short_name AS region_name
       FROM internship_records ir
       INNER JOIN user_profiles up ON ir.user_id = up.user_id
       INNER JOIN (
         SELECT sai1.user_id, sai1.course_id
         FROM student_academic_info AS sai1
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM student_academic_info
           GROUP BY user_id
         ) AS latest ON sai1.user_id = latest.user_id AND sai1.id = latest.max_id
       ) AS sai ON ir.user_id = sai.user_id
       INNER JOIN courses c ON sai.course_id = c.id
       LEFT JOIN regions r ON ir.region_id = r.id
       WHERE ir.status = 'ongoing' AND ir.deleted_at IS NULL
       ORDER BY ir.company_name ASC`,
      )
      .stream({ highWaterMark: 64 });

    // Group trimmed, case-insensitive company names with coordinates rounded to
    // five decimal places. Each group becomes one pin/card with its internship rows.
    const groups = {};
    const regionsSeen = new Map(); // id -> name, dedupe while preserving one clean name per id

    for await (const row of rows) {
      const normalizedName = row.company_name.trim().toLowerCase();
      const key = `${Number(row.lat).toFixed(5)}_${Number(row.lon).toFixed(5)}_${normalizedName}`;

      if (!groups[key]) {
        groups[key] = {
          company_name: row.company_name,
          company_address: row.company_address,
          city_name: row.city_name || null,
          province_name: row.province_name || null,
          lat: row.lat,
          lon: row.lon,
          region_id: row.region_id,
          region_name: row.region_name,
          interns: [],
        };
      }

      if (row.region_id && !regionsSeen.has(row.region_id)) {
        regionsSeen.set(row.region_id, row.region_name);
      }

      const totalHours = Number(row.total_hours) || 0;
      const accumulatedHours = Number(row.accumulated_hours) || 0;
      const percentComplete =
        totalHours > 0 ? Math.round((accumulatedHours / totalHours) * 100) : 0;

      groups[key].interns.push({
        internship_id: row.id,
        student_id: row.user_id,
        name: `${row.first_name} ${row.last_name}`,
        position: row.internship_position,
        course: row.course_name,
        course_short_name: row.course_short_name,
        percent_complete: percentComplete,
        date_started: row.date_started,
        date_ended: row.date_ended,
      });
    }

    const companies = Object.values(groups).map((g) => ({
      ...g,
      intern_count: g.interns.length,
    }));

    const availableRegions = Array.from(regionsSeen, ([id, name]) => ({
      id,
      name,
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ companies, availableRegions, origin: mapOrigin() });
  } catch (error) {
    reportError("Get student map error:", error);
    res.status(500).json({ error: "Failed to load student map data." });
  } finally {
    if (connection) connection.release();
  }
};
