const roles = { admin: "Admin", department_head: "Department head", student: "Student", employer: "Employer" };

export function activityLogRoleName(role) {
  return Object.hasOwn(roles, role || "") ? roles[role] : "User";
}

export function activityLogDocumentPhase(category) {
  return category === "before" ? "before deployment" : category === "after" ? "after deployment" : "internship requirements";
}
