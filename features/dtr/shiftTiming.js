// Work in Philippine wall-clock values supplied by the +08:00 SQL session.
// UTC Date math here avoids depending on the Node host's local timezone.
const parse = value => {
  const match = String(value).match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/);
  if (!match) throw new Error("Invalid database attendance time.");
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
};
const format = epoch => new Date(epoch).toISOString().slice(0, 19).replace("T", " ");
const minuteOfDay = time => {
  const match = String(time).match(/^(\d\d):(\d\d)(?::\d\d)?$/);
  if (!match || +match[1] > 23 || +match[2] > 59) throw new Error("Invalid shift time.");
  return +match[1] * 60 + +match[2];
};

export function shiftExpectations(recordedAt, startTime, endTime) {
  if (!startTime || !endTime) return null;
  const actual = parse(recordedAt);
  const startMinute = minuteOfDay(startTime);
  const endMinute = minuteOfDay(endTime);
  const day = Math.floor(actual / 86_400_000) * 86_400_000;
  let start = day + startMinute * 60_000;
  const overnight = endMinute <= startMinute;
  // Choose the nearer occurrence of an overnight start. For 22:00 daily,
  // clock-ins before 10:00 belong to the previous night's shift.
  if (overnight && actual < start - 12 * 60 * 60_000) start -= 86_400_000;
  const end = start + ((endMinute - startMinute + (overnight ? 1440 : 0)) * 60_000);
  return {
    expectedIn: format(start), expectedOut: format(end),
    late: actual >= start + 10 * 60_000,
  };
}

export function clockOutTiming(recordedAt, expectedOut) {
  if (!expectedOut) return { undertime: false, overtime: false };
  const difference = parse(recordedAt) - parse(expectedOut);
  return { undertime: difference < 0, overtime: difference >= 30 * 60_000 };
}
