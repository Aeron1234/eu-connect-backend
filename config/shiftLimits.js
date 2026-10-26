// MAX_SHIFT_HOURS is a required positive whole-number duty cap. Invalid
// configuration fails rather than silently choosing a different credit limit.
export const getMaxShiftHours = () => {
  const hours = Number(process.env.MAX_SHIFT_HOURS);
  if (!Number.isSafeInteger(hours) || hours <= 0) {
    throw new Error("MAX_SHIFT_HOURS must be a positive whole number of hours.");
  }
  return hours;
};
