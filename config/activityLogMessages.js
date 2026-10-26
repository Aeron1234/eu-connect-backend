// Human-readable labels for newly written audit descriptions. Stored role/category codes
// remain unchanged; unknown values use generic wording rather than leaking identifiers.
const roles = { admin: "Admin", department_head: "Department head", student: "Student", employer: "Employer" };

export function activityLogRoleName(role) {
  return Object.hasOwn(roles, role || "") ? roles[role] : "User";
}

export function activityLogDocumentPhase(category) {
  return category === "before" ? "before deployment" : category === "after" ? "after deployment" : "internship requirements";
}
