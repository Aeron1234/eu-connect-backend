import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

const PAGE_SIZE = 15;

// Remove every recorded occurrence for this fingerprint, not just the active list
// filters. A later occurrence can recreate the group; deletion does not fix its cause.
export async function deleteErrorGroup(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (req.verifiedUser?.role !== "admin") {
    return res.status(403).json({ error: "Only administrators can delete error groups." });
  }
  const { fingerprint } = req.params;
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    return res.status(400).json({ error: "Invalid error group." });
  }
  try {
    // One atomic statement removes this group's recorded history across all filters.
    const [result] = await db.execute("DELETE FROM error_events WHERE fingerprint = ?", [fingerprint]);
    if (!result.affectedRows) return res.status(404).json({ error: "Error group not found." });
    return res.json({
      success: true,
      message: "Error group deleted.",
      deletedOccurrences: Number(result.affectedRows),
    });
  } catch (error) {
    reportError("Delete error group failed:", error);
    return res.status(error?.code === "ER_NO_SUCH_TABLE" ? 503 : 500).json({
      error: error?.code === "ER_NO_SUCH_TABLE"
        ? "Error tracking is not installed. Run the error-tracking.sql migration."
        : "Could not delete the error group. Please try again.",
    });
  }
}

function filtersFrom(query) {
  const days = [1, 7, 30].includes(Number(query.days)) ? Number(query.days) : 7;
  const conditions = ["created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
  const params = [days];
  if (query.method && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(query.method)) {
    conditions.push("method = ?");
    params.push(query.method.toUpperCase());
  }
  if (query.source && /^[a-zA-Z0-9_-]{1,80}$/.test(query.source)) {
    conditions.push("source = ?");
    params.push(query.source);
  }
  if (query.status && /^\d{3}$/.test(String(query.status))) {
    conditions.push("status_code = ?");
    params.push(Number(query.status));
  }
  if (typeof query.search === "string" && query.search.trim()) {
    conditions.push("(route_pattern LIKE ? OR context LIKE ? OR error_code LIKE ? OR message LIKE ?)");
    const search = `%${query.search.trim().slice(0, 80)}%`;
    params.push(search, search, search, search);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}

// Summary counts and group pages share the same filters. Each displayed sample is
// the greatest event ID within that filtered group, not an unfiltered global sample.
export async function getErrorGroups(req, res) {
  try {
    const { where, params } = filtersFrom(req.query);
    const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const offset = (page - 1) * PAGE_SIZE;
    const [summaryResult, groupsResult] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS total_occurrences, COUNT(DISTINCT fingerprint) AS total_groups
                  FROM error_events ${where}`, params),
      db.execute(
        `SELECT fingerprint, MAX(id) AS latest_id, COUNT(*) AS occurrences,
                MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
         FROM error_events ${where}
         GROUP BY fingerprint ORDER BY last_seen DESC LIMIT ? OFFSET ?`,
        [...params, PAGE_SIZE, offset],
      ),
    ]);
    const summary = summaryResult[0][0];
    const groups = groupsResult[0];
    const ids = groups.map((group) => group.latest_id);
    let samples = [];
    if (ids.length) {
      [samples] = await db.query(
        `SELECT id, source, method, route_pattern, status_code, error_name,
                error_code, context, message, code_location
         FROM error_events WHERE id IN (${ids.map(() => "?").join(",")})`, ids,
      );
    }
    const byId = new Map(samples.map((sample) => [String(sample.id), sample]));
    res.set("Cache-Control", "private, no-store");
    res.json({
      data: groups.map((group) => ({
        fingerprint: group.fingerprint,
        occurrences: Number(group.occurrences),
        first_seen: group.first_seen,
        last_seen: group.last_seen,
        ...byId.get(String(group.latest_id)),
      })),
      stats: {
        totalOccurrences: Number(summary.total_occurrences),
        totalGroups: Number(summary.total_groups),
      },
      pagination: {
        page,
        limit: PAGE_SIZE,
        total: Number(summary.total_groups),
        totalPages: Math.ceil(Number(summary.total_groups) / PAGE_SIZE),
      },
    });
  } catch (error) {
    reportError("Get error groups failed:", error);
    res.status(error?.code === "ER_NO_SUCH_TABLE" ? 503 : 500).json({
      error: error?.code === "ER_NO_SUCH_TABLE"
        ? "Error tracking is not installed. Run the error-tracking.sql migration."
        : "Could not load error tracking.",
    });
  }
}

// Detail ignores list filters: summarize retained history for the fingerprint and
// return only its newest 25 occurrences. Route middleware restricts reads to admin.
export async function getErrorGroup(req, res) {
  const { fingerprint } = req.params;
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    return res.status(400).json({ error: "Invalid error group." });
  }
  try {
    const [summaryResult, occurrencesResult] = await Promise.all([
      db.execute(
        `SELECT COUNT(*) AS count, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
         FROM error_events WHERE fingerprint = ?`, [fingerprint],
      ),
      db.execute(
        `SELECT id, request_id, source, method, route_pattern, status_code,
                error_name, error_code, context, message, code_location,
                actor_id, actor_role, created_at
         FROM error_events WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 25`,
        [fingerprint],
      ),
    ]);
    const summary = summaryResult[0][0];
    const occurrences = occurrencesResult[0];
    if (!occurrences.length) return res.status(404).json({ error: "Error group not found." });
    res.set("Cache-Control", "private, no-store");
    res.json({
      fingerprint,
      count: Number(summary.count),
      first_seen: summary.first_seen,
      last_seen: summary.last_seen,
      occurrences,
    });
  } catch (error) {
    reportError("Get error group failed:", error);
    res.status(error?.code === "ER_NO_SUCH_TABLE" ? 503 : 500).json({
      error: error?.code === "ER_NO_SUCH_TABLE"
        ? "Error tracking is not installed. Run the error-tracking.sql migration."
        : "Could not load error details.",
    });
  }
}
