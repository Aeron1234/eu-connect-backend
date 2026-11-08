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
  // A shift starting shortly after midnight opens on the preceding date.
  if (startMinute < 30 && actual >= day + 86_400_000 - 30 * 60_000) start += 86_400_000;
  const end = start + ((endMinute - startMinute + (overnight ? 1440 : 0)) * 60_000);
  return {
    expectedIn: format(start), expectedOut: format(end),
    late: actual >= start + 10 * 60_000,
  };
}

export function clockInWindow(recordedAt, expected) {
  if (!expected) return { open: true, opensAt: null };
  const opensAt = parse(expected.expectedIn) - 30 * 60_000;
  return { open: parse(recordedAt) >= opensAt, opensAt: format(opensAt) };
}

// Optional bounds apply to the shift's start date, including overnight shifts
// whose clock-in happens after midnight on the following calendar day.
export function datedShiftExpectations(recordedAt, startTime, endTime, startDate, endDate) {
  const expected = shiftExpectations(recordedAt, startTime, endTime);
  if (!expected) return null;
  const shiftDate = expected.expectedIn.slice(0, 10);
  return (startDate && shiftDate < startDate) || (endDate && shiftDate > endDate)
    ? null : expected;
}

export function clockOutTiming(recordedAt, expectedOut, dutyHours) {
  if (!expectedOut) return { undertime: Number.isFinite(dutyHours) && dutyHours < 7, overtime: false };
  const difference = parse(recordedAt) - parse(expectedOut);
  return { undertime: difference <= -60 * 60_000, overtime: difference >= 30 * 60_000 };
}
