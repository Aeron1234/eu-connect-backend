import { manilaCalendarDay } from "../../config/internshipStart.js";

export const rotationError = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function rotationEnabled(value) {
  if ([true, 1, "1", "true", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "off", "", null, undefined].includes(value))
    return false;
  throw rotationError("Choose whether company rotations are enabled.");
}

// Rotation dates are inclusive calendar days, not browser/server-local instants.
export function readRotation(body, record) {
  const department =
    typeof body.department_name === "string" ? body.department_name.trim() : "";
  const supervisor =
    typeof body.supervisor_name === "string" ? body.supervisor_name.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const from = typeof body.date_from === "string" ? body.date_from.trim() : "";
  const to = typeof body.date_to === "string" ? body.date_to.trim() : "";
  if (!department || department.length > 120)
    throw rotationError(
      "Enter a company department or unit (up to 120 characters).",
    );
  if (supervisor.length > 120 || notes.length > 1000)
    throw rotationError(
      "Supervisor must be at most 120 characters and notes at most 1,000.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    manilaCalendarDay(from) !== from ||
    manilaCalendarDay(to) !== to ||
    to < from
  ) {
    throw rotationError("Enter a valid rotation start and end date.");
  }
  // date_ended is an estimate, not an assignment deadline. Keep the actual
  // placement start as the lower bound; ongoing status and overlap checks live
  // in the controller and still apply to every assignment mutation.
  const start = manilaCalendarDay(record.date_started);
  if (!start || from < start)
    throw rotationError(
      "Rotation dates must start on or after the internship start date.",
    );
  return {
    department_name: department,
    supervisor_name: supervisor || null,
    notes: notes || null,
    date_from: from,
    date_to: to,
  };
}

// Snapshots deliberately keep old journal assignments readable after rotation changes.
export function parseRotationSnapshots(value) {
  if (!value) return [];
  try {
    const rows = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function narrativeRotationSnapshot(
  connection,
  record,
  body,
  dates,
  previous = [],
  preserveExisting = false,
) {
  if (body.rotation_ids === undefined) return undefined; // Old clients preserve the existing snapshot on edit.
  let ids;
  try {
    ids =
      typeof body.rotation_ids === "string"
        ? JSON.parse(body.rotation_ids)
        : body.rotation_ids;
  } catch {
    throw rotationError("Choose valid company rotations.");
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 52 ||
    ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,36}$/.test(id),
    ) ||
    new Set(ids).size !== ids.length
  ) {
    throw rotationError("Choose valid company rotations.");
  }
  if (!ids.length) return null;
  if (!rotationEnabled(record.rotations_enabled))
    throw rotationError(
      "Enable company rotations before assigning them to a narrative.",
    );
  const [rows] = await connection.execute(
    // Coverage matches assignments by overlap. The placement's estimated end
    // does not limit narrative selection or change historical snapshots.
    `SELECT id, department_name, supervisor_name,
       DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from, DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
     FROM internship_rotations WHERE internship_id = ? AND deleted_at IS NULL ORDER BY date_from, id`,
    [record.id],
  );
  const saved = parseRotationSnapshots(previous);
  const selected = ids.map(
    (id) =>
      preserveExisting
        ? saved.find((row) => row.id === id) || rows.find((row) => row.id === id)
        : rows.find((row) => row.id === id) || saved.find((row) => row.id === id),
  );
  if (
    selected.some(
      (row) => !row || row.date_from > dates.to || row.date_to < dates.from,
    )
  ) {
    throw rotationError(
      "Selected rotations must belong to this internship and overlap the narrative's dates.",
    );
  }
  return JSON.stringify(selected);
}
