import { db } from '../../config/db.js';
import { employerVisibility } from './employerVisibility.js';

// One viewer parameter; current database roles/departments authorize targeted reads.
export function targetedSchoolAccess(alias, viewer) {
  return `EXISTS (SELECT 1 FROM users audience_user JOIN roles audience_role ON audience_role.id=audience_user.role_id WHERE audience_user.id=${viewer} AND audience_user.deleted_at IS NULL AND (audience_user.id=${alias}.author_id OR audience_role.role='admin' OR (audience_role.role='student' AND EXISTS (SELECT 1 FROM announcement_student_tags atag WHERE atag.announcement_id=${alias}.public_id AND atag.student_id=audience_user.id)) OR (audience_role.role='department_head' AND EXISTS (SELECT 1 FROM announcement_student_tags atag JOIN student_academic_info asi ON asi.id=(SELECT MAX(alatest.id) FROM student_academic_info alatest WHERE alatest.user_id=atag.student_id) JOIN dept_heads_background_info ah ON ah.department_id=asi.department_id WHERE atag.announcement_id=${alias}.public_id AND ah.user_id=audience_user.id))))`;
}
export async function saveSchoolAudience(connection, id, value) {
  // Tags always identify a restricted school audience, even if a stale client
  // submits broad mode. Reuse the persisted tags after saveStudentTags.
  const [selectedTags] = await connection.execute('SELECT student_id FROM announcement_student_tags WHERE announcement_id=? LIMIT 1', [id]);
  if (selectedTags.length) {
    if (value !== undefined) { try { employerVisibility(value); } catch { throw invalid('Choose a valid announcement audience.'); } }
    await connection.execute('UPDATE announcements SET tagged_students_only=1 WHERE public_id=?', [id]);
    return true;
  }
  if (value !== undefined) {
    let targeted;
    try { targeted = employerVisibility(value); } catch { throw invalid('Choose a valid announcement audience.'); }
    if (targeted) {
      const [tags] = await connection.execute('SELECT student_id FROM announcement_student_tags WHERE announcement_id=? LIMIT 1', [id]);
      if (!tags.length) throw invalid('Tag at least one student for Tagged students only.');
    }
    await connection.execute('UPDATE announcements SET tagged_students_only=? WHERE public_id=?', [targeted, id]);
  }
  const [rows] = await connection.execute('SELECT tagged_students_only FROM announcements WHERE public_id=?', [id]);
  if (Number(rows[0]?.tagged_students_only) === 1) {
    const [tags] = await connection.execute('SELECT student_id FROM announcement_student_tags WHERE announcement_id=? LIMIT 1', [id]);
    if (!tags.length) throw invalid('Tag at least one student or switch to the usual audience.');
    return true;
  }
  return false;
}
export async function schoolRecipients(connection, id) {
  const [rows] = await connection.execute(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id JOIN announcements a ON a.public_id=? JOIN announcement_categories ac ON ac.id=a.category_id LEFT JOIN dept_heads_background_info author_dept ON author_dept.user_id=a.author_id WHERE u.id!=a.author_id AND u.deleted_at IS NULL AND r.role!='employer' AND ((a.tagged_students_only=1 AND r.role!='admin' AND ${targetedSchoolAccess('a','u.id')}) OR (a.tagged_students_only=0 AND (ac.name!='Department' OR r.role='admin' OR (r.role='student' AND EXISTS (SELECT 1 FROM student_academic_info sa WHERE sa.id=(SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id=u.id) AND sa.department_id=author_dept.department_id)) OR (r.role='department_head' AND EXISTS (SELECT 1 FROM dept_heads_background_info h WHERE h.user_id=u.id AND h.department_id=author_dept.department_id)))))`, [id]);
  return rows;
}
const invalid = message => Object.assign(new Error(message), { status: 400 });

// Resolve supervisor access live: transfers/removal stop exposing the post to the
// former supervisor. No tags retains the existing all-employer opt-in contract.
export function employerAnnouncementAccess(alias, viewer) {
  return `${alias}.visible_to_employers = 1 AND (${alias}.employer_tagged_only = 0 OR EXISTS (SELECT 1 FROM announcement_student_tags ast JOIN internship_records tagged_ir ON tagged_ir.user_id = ast.student_id JOIN users tagged_user ON tagged_user.id = ast.student_id WHERE ast.announcement_id = ${alias}.public_id AND tagged_ir.employer_id = ${viewer} AND tagged_ir.status = 'ongoing' AND tagged_ir.deleted_at IS NULL AND tagged_user.deleted_at IS NULL))`;
}
export const tagProjection = `(SELECT JSON_ARRAYAGG(ast.student_id) FROM announcement_student_tags ast WHERE ast.announcement_id = a.public_id) AS tagged_student_ids, (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',ast.student_id,'name',CONCAT_WS(' ',tp.first_name,tp.last_name))) FROM announcement_student_tags ast JOIN user_profiles tp ON tp.user_id=ast.student_id WHERE ast.announcement_id=a.public_id) AS tagged_students`;

function parseIds(value) {
  let ids;
  try { ids = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw invalid('Choose valid tagged students.'); }
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) || new Set(ids).size !== ids.length) throw invalid('Choose up to 100 distinct students.');
  return ids;
}
async function studentScope(connection, actor) {
  if (!['admin', 'department_head'].includes(actor.role)) throw invalid('Only announcement authors can tag students.');
  if (actor.role === 'admin') return null;
  const [heads] = await connection.execute('SELECT h.department_id, d.code FROM dept_heads_background_info h JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1', [actor.id]);
  if (!heads[0]) throw invalid('Your department could not be verified.');
  // All regular heads use their current database department on search AND save.
  // Registrar heads have the explicitly authorized school-wide tagging exception.
  return heads[0].code === 'REG' ? null : heads[0].department_id;
}
const studentJoins = `FROM users u JOIN roles r ON r.id=u.role_id JOIN user_profiles p ON p.user_id=u.id LEFT JOIN student_academic_info sai ON sai.id=(SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id=u.id)`;
export async function saveStudentTags(connection, actor, announcementId, value) {
  if (value === undefined) return;
  const ids = parseIds(value);
  const department = await studentScope(connection, actor);
  if (ids.length) {
    const [students] = await connection.execute(`SELECT u.id ${studentJoins} WHERE r.role='student' AND u.deleted_at IS NULL AND u.id IN (${ids.map(() => '?').join(',')}) ${department == null ? '' : 'AND sai.department_id = ?'} AND EXISTS (SELECT 1 FROM internship_records ir WHERE ir.user_id=u.id AND ir.status='ongoing' AND ir.deleted_at IS NULL)`, [...ids, ...(department == null ? [] : [department])]);
    if (students.length !== ids.length) throw invalid('Some tagged students are no longer accessible ongoing interns. Refresh the student list.');
  }
  await connection.execute('DELETE FROM announcement_student_tags WHERE announcement_id = ?', [announcementId]);
  await connection.execute('UPDATE announcements SET employer_tagged_only=? WHERE public_id=?', [ids.length ? 1 : 0, announcementId]);
  if (ids.length) await connection.execute(`INSERT INTO announcement_student_tags (announcement_id,student_id) VALUES ${ids.map(() => '(?,?)').join(',')}`, ids.flatMap(id => [announcementId, id]));
}
export async function employerRecipients(connection, announcementId) {
  const [all] = await connection.execute("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.role='employer'");
  const [allowed] = await connection.execute(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id JOIN announcements a ON a.public_id=? WHERE r.role='employer' AND u.deleted_at IS NULL AND ${employerAnnouncementAccess('a', 'u.id')}`, [announcementId]);
  return { all: new Set(all.map(row => row.id)), allowed };
}
export async function getAnnouncementTagStudents(req, res) {
  let connection;
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    connection = await db.getConnection();
    const department = await studentScope(connection, req.verifiedUser);
    const [students] = await connection.execute(`SELECT u.id, p.first_name, p.last_name ${studentJoins} WHERE r.role='student' AND u.deleted_at IS NULL ${department == null ? '' : 'AND sai.department_id=?'} AND CONCAT_WS(' ',p.first_name,p.last_name) LIKE ? AND EXISTS (SELECT 1 FROM internship_records ir WHERE ir.user_id=u.id AND ir.status='ongoing' AND ir.deleted_at IS NULL) ORDER BY p.last_name,p.first_name,u.id LIMIT 30`, [...(department == null ? [] : [department]), `%${search}%`]);
    res.set('Cache-Control', 'private, no-store').json({ success: true, students });
  } catch { res.status(400).json({ success: false, error: 'Could not load eligible students. Check your department or retry.' }); }
  finally { connection?.release(); }
}
