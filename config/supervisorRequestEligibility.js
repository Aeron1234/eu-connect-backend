// Share the live eligibility rule between inbox response controls and deletion protection.
// A pending request is actionable only for its student's ongoing, undeleted,
// unassigned internship. Dashboard lists contain accepted assignments only.
// Alias arguments are internal SQL identifiers, never request input.
export function pendingSupervisorRequestSql(request = "sr", internship = "request_internship") {
  return `${request}.status = 'pending'
    AND ${internship}.user_id = ${request}.student_id
    AND ${internship}.status = 'ongoing'
    AND ${internship}.deleted_at IS NULL
    AND ${internship}.employer_id IS NULL`;
}
