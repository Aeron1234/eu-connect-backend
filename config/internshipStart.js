const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
});
const labelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric",
});

// Keep validated date-only input as a calendar day. Convert Date objects and
// timestamps with an explicit timezone to the Philippine day; reject ambiguous
// timezone-less timestamps and dates that normalize to a different day.
export function manilaCalendarDay(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  if (!(value instanceof Date) && (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = dayFormatter.formatToParts(parsed);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}

// Compare normalized YYYY-MM-DD days and unlock at midnight in Asia/Manila.
// Missing or invalid dates fail closed. This checks timing only; callers still
// enforce ownership, internship status and feature-specific permissions.
export function getInternshipStartAccess(dateStarted, feature, now = new Date()) {
  const startDay = manilaCalendarDay(dateStarted);
  const today = manilaCalendarDay(now);
  const unlockAt = startDay ? new Date(startDay + "T00:00:00+08:00").getTime() : null;
  if (!startDay || !today) {
    return {
      allowed: false, startDay, unlockAt,
      message: "This internship has no valid start date. Contact your coordinator before creating or editing " + feature.toLowerCase() + ".",
    };
  }
  const allowed = today >= startDay;
  return {
    allowed, startDay, unlockAt,
    message: allowed ? null : feature + " can be created or edited starting " + labelFormatter.format(new Date(unlockAt)) + " (Philippine time).",
  };
}

// Apply the same date gate on backend writes; client controls cannot authorize a write.
export function assertInternshipStarted(dateStarted, feature, now = new Date()) {
  const access = getInternshipStartAccess(dateStarted, feature, now);
  if (!access.allowed) throw Object.assign(new Error(access.message), { status: 409, code: "INTERNSHIP_NOT_STARTED" });
}
