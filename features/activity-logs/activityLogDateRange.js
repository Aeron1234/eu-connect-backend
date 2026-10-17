// The MySQL session uses +08:00, matching the dates shown in the admin UI.
// Keep created_at unwrapped so an index on that column can still be used.
export function activityLogDateRange(input) {
  const { fromDate, throughDate } = input || {};
  const validDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number(value.slice(0, 4)) >= 1000 &&
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(fromDate) || !validDate(throughDate)) {
    return { error: "Choose valid From and Through dates." };
  }
  if (fromDate > throughDate) {
    return { error: "Through date must be on or after From date." };
  }
  return {
    fromDate,
    throughDate,
    // Includes the entire final day, even for fractional-second timestamps.
    params: [`${fromDate} 00:00:00`, `${throughDate} 23:59:59.999999`],
  };
}
