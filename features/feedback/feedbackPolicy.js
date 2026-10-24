export const CATEGORIES = ["platform_feedback", "technical_issue", "internship_feedback", "general_feedback"];
export const STATUSES = ["open", "in_review", "resolved"];
export const STAFF = ["admin", "department_head"];
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function assertRole(user) {
  if (!["employer", ...STAFF].includes(user?.role)) fail(403, "Feedback is available to employers and school staff only.");
}
export function validatePost(body) {
  const category = String(body.category || "");
  const subject = String(body.subject || "").trim();
  const description = String(body.description || "").trim();
  if (!CATEGORIES.includes(category)) fail(400, "Choose a feedback category.");
  if (!subject || subject.length > 160) fail(400, "Enter a subject of up to 160 characters.");
  if (!description || description.length > 5000) fail(400, "Enter a description of up to 5,000 characters.");
  let ids;
  try { ids = typeof body.internshipIds === "string" ? JSON.parse(body.internshipIds) : body.internshipIds || []; }
  catch { fail(400, "Choose valid internships."); }
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) fail(400, "Choose up to 200 valid internships.");
  ids = [...new Set(ids)];
  if (category !== "internship_feedback" && ids.length) fail(400, "Intern tagging is available for internship feedback and concerns only.");
  return { category, subject, description, ids };
}
// Shared by post access and notification recipients. Category checks also protect
// against legacy/incorrect mention rows attached to technical or platform posts.
export function departmentFeedbackScope(alias = "p", headIdSql = "?") {
  return "(" + alias + ".category = 'general_feedback' OR (" + alias + ".category = 'internship_feedback' AND " +
    "EXISTS (SELECT 1 FROM feedback_mentions fm JOIN dept_heads_background_info dh ON dh.department_id = fm.department_id WHERE fm.post_id = " + alias + ".id AND dh.user_id = " + headIdSql + ")))";
}
export function feedbackScope(user, alias = "p") {
  assertRole(user);
  if (user.role === "admin") return { sql: "1=1", params: [] };
  if (user.role === "employer") return { sql: alias + ".author_id = ?", params: [user.id] };
  return {
    sql: departmentFeedbackScope(alias),
    params: [user.id],
  };
}
export function uniqueRecipients(rows, actorId) {
  return [...new Set(rows.map(row => row.id).filter(id => id && id !== actorId))];
}
export function attachmentType(file) {
  const b = file.buffer;
  if (!Buffer.isBuffer(b) || b.length > 5 * 1024 * 1024) fail(400, "Each attachment must be 5 MB or smaller.");
  const types = {
    "application/pdf": ["pdf", b.subarray(0, 5).toString() === "%PDF-"],
    "image/png": ["png", b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
    "image/jpeg": ["jpg", b[0] === 255 && b[1] === 216 && b[2] === 255],
    "image/webp": ["webp", b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP"],
  };
  const type = types[file.mimetype];
  if (!type?.[1]) fail(400, "Attachments must be valid PDF, PNG, JPG, or WebP files.");
  return type[0];
}
