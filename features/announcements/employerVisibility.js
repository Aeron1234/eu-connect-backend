// JSON and HTML form checkbox representations only; never coerce arbitrary strings.
export function employerVisibility(value) {
  if ([true, 1, "1", "true", "on"].includes(value)) return 1;
  if ([false, 0, "0", "false", "", null, undefined].includes(value)) return 0;
  throw Object.assign(new Error("Choose whether this announcement is visible to employers."), { status: 400 });
}
