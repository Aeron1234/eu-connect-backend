import { reportError } from "../config/errorTracking.js";
import { invalidateActivityLogsCache } from "../config/activityLogsCache.js";
import { db } from "../config/db.js";

// GET — for the logged-in user's own activity, 10 per page
export const getMyActivityLogs = async (req, res) => {
  let connection;
  try {
    const { id: actorId } = req.verifiedUser;
    const { page = 1 } = req.query;

    const pageSize = 10;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const offset = (pageNum - 1) * pageSize;

    connection = await db.getConnection();

    const [pageRows] = await connection.execute(
      `SELECT id, action, target_type, target_id, description, metadata, created_at,
              (SELECT COUNT(*) FROM activity_logs WHERE actor_id = ?) AS total_logs
       FROM activity_logs
       WHERE actor_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [actorId, actorId, pageSize, offset],
    );

    let total = pageRows[0]?.total_logs;
    if (pageRows.length === 0) {
      [[{ total }]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM activity_logs WHERE actor_id = ?`,
        [actorId],
      );
    }
    const rows = pageRows.map(({ total_logs, ...row }) => row);

    res.status(200).json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    reportError("Get my activity logs error:", error);
    res.status(500).json({ error: "Failed to load activity logs." });
  } finally {
    if (connection) connection.release();
  }
};

// GET — admin view, all logs, 15 per page, filterable, with unique
// action/actor_role/target_type values included for building the filter UI
export const getAllActivityLogs = async (req, res) => {
  let connection;
  try {
    const { action, actorRole, targetType, search, page = 1 } = req.query;

    const pageSize = 15;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (action) {
      conditions.push("action = ?");
      params.push(action);
    }
    if (actorRole) {
      conditions.push("actor_role = ?");
      params.push(actorRole);
    }
    if (targetType) {
      conditions.push("target_type = ?");
      params.push(targetType);
    }
    if (search) {
      conditions.push("description LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    connection = await db.getConnection();

    const [rows] = await connection.execute(
      `SELECT al.id, al.actor_id, al.actor_role, al.action, al.target_type, 
              al.target_id, al.description, al.metadata, al.created_at,
              up.first_name, up.last_name
       FROM activity_logs al
       LEFT JOIN user_profiles up ON al.actor_id = up.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const [filterRows] = await connection.execute(
      `SELECT DISTINCT 'action' AS filter_type, action AS filter_value
       FROM activity_logs
       UNION ALL
       SELECT DISTINCT 'actor_role', actor_role FROM activity_logs
       UNION ALL
       SELECT DISTINCT 'target_type', target_type FROM activity_logs
       ORDER BY filter_type ASC, filter_value ASC`,
    );

    const [[summary]] = await connection.execute(
      `SELECT COUNT(*) AS total_events,
              COUNT(DISTINCT actor_id) AS active_users
       FROM activity_logs ${whereClause}`,
      params,
    );
    const [topActions] = await connection.execute(
      `SELECT action AS name, COUNT(*) AS event_count
       FROM activity_logs ${whereClause}
       GROUP BY action
       ORDER BY event_count DESC, action ASC
       LIMIT 1`,
      params,
    );
    const [topModules] = await connection.execute(
      `SELECT target_type AS name, COUNT(*) AS event_count
       FROM activity_logs ${whereClause}
       GROUP BY target_type
       ORDER BY event_count DESC, target_type ASC
       LIMIT 1`,
      params,
    );

    const topStat = (row) => row
      ? { name: row.name, count: Number(row.event_count) }
      : null;

    const data = rows.map((r) => ({
      id: r.id,
      actor_id: r.actor_id,
      actor_name: r.first_name ? `${r.first_name} ${r.last_name}` : "Unknown",
      actor_role: r.actor_role,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      description: r.description,
      metadata: r.metadata,
      created_at: r.created_at,
    }));

    res.status(200).json({
      data,
      filters: {
        actions: filterRows.filter((r) => r.filter_type === "action").map((r) => r.filter_value),
        actorRoles: filterRows.filter((r) => r.filter_type === "actor_role").map((r) => r.filter_value),
        targetTypes: filterRows.filter((r) => r.filter_type === "target_type").map((r) => r.filter_value),
      },
      stats: {
        totalEvents: Number(summary.total_events),
        activeUsers: Number(summary.active_users),
        mostCommonAction: topStat(topActions[0]),
        mostActiveModule: topStat(topModules[0]),
      },
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: Number(summary.total_events),
        totalPages: Math.ceil(Number(summary.total_events) / pageSize),
      },
    });
  } catch (error) {
    reportError("Get all activity logs error:", error);
    res.status(500).json({ error: "Failed to load activity logs." });
  } finally {
    if (connection) connection.release();
  }
};

// DELETE — a user can delete their own log entries; admin can delete any
export const deleteActivityLog = async (req, res) => {
  let connection;
  try {
    const { id: requesterId, role } = req.verifiedUser;
    const { logId } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, actor_id FROM activity_logs WHERE id = ? FOR UPDATE`,
      [logId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Activity log not found." });
    }

    if (role !== "admin" && rows[0].actor_id !== requesterId) {
      await connection.rollback();
      return res.status(403).json({
        error: "You can only delete your own activity logs.",
      });
    }

    await connection.execute(`DELETE FROM activity_logs WHERE id = ?`, [logId]);

    await connection.commit();

    invalidateActivityLogsCache();

    res.status(200).json({ success: true, message: "Activity log deleted." });
  } catch (error) {
    if (connection) await connection.rollback();
    reportError("Delete activity log error:", error);
    res.status(500).json({ error: "Failed to delete activity log." });
  } finally {
    if (connection) connection.release();
  }
};
