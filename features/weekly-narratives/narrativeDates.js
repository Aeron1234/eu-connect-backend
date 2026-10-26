// Round-trip the date-only value in UTC to reject impossible calendar days.
// UTC is a validation anchor here, not an internship start-time comparison.
function validDay(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Every create/edit must supply both coverage dates, including edits to legacy rows.
// Equal dates are valid; this checks ordering, not a fixed seven-day duration.
export function parseNarrativeDateRange(body) {
  const from = typeof body.date_from === "string" ? body.date_from.trim() : "";
  const to = typeof body.date_to === "string" ? body.date_to.trim() : "";
  if (!validDay(from) || !validDay(to)) {
    throw Object.assign(new Error("Choose valid start and end dates for the narrative (YYYY-MM-DD)."), { status: 400, code: "INVALID_NARRATIVE_DATE_RANGE" });
  }
  if (to < from) {
    throw Object.assign(new Error("The end date cannot be earlier than the start date."), { status: 400, code: "INVALID_NARRATIVE_DATE_RANGE" });
  }
  return { from, to };
}
