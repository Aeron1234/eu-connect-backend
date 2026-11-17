// Shared student identity rules. Keep paired frontend/backend copies identical.
export function normalizeSchoolId(value = "") {
  if (typeof value !== "string") throw new Error("School ID must be text.");
  const id = value.trim().toUpperCase();
  if (id && !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) throw new Error("Use letters, numbers and single hyphens for the school ID.");
  if (id.length > 30) throw new Error("School ID must be at most 30 characters.");
  return id;
}

export function studentUsername(firstName, lastName, schoolId = "") {
  const part = value => String(value ?? "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
  const first = part(firstName), last = part(lastName);
  if (!first || !last) return "";
  return [last, first, normalizeSchoolId(schoolId)].filter(Boolean).join(".");
}

export function validateStudentIdentity(row) {
  const schoolId = normalizeSchoolId(row.school_id ?? "");
  const username = studentUsername(row.first_name, row.last_name, schoolId);
  if (!username) throw new Error("First and last names must contain letters or numbers.");
  if ([...username].length > 50) throw new Error("Generated username exceeds 50 characters. Shorten the entered names.");
  return { schoolId, username };
}

