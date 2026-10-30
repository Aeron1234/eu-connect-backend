import { db } from '../../config/db.js';
import { reportError } from '../../config/errorTracking.js';
import { getCurrentAcademicYear } from '../../config/helpers.js';
import { companyAnalytics, registrarAnalytics, academicYear } from './analyticsModel.js';
const fail = (message,status=400) => Object.assign(new Error(message),{status});
export async function analyticsScope(connection, actor, registrar = false) {
  if (actor.role === 'admin' && !registrar) return null;
  if (actor.role !== 'department_head') throw fail('Access denied.',403);
  const [rows] = await connection.execute('SELECT h.department_id,d.code FROM dept_heads_background_info h JOIN departments d ON d.id=h.department_id WHERE h.user_id=? LIMIT 1',[actor.id]);
  if (!rows[0] || (registrar ? rows[0].code !== 'REG' : rows[0].code === 'REG')) throw fail('This dashboard is not available for your role.',403);
  return registrar ? null : Number(rows[0].department_id);
}
function filters(query, role, registrar) {
  const result={};
  for (const key of ['departmentId','courseId']) if (query[key]) {
    if (registrar || (key==='departmentId' && role!=='admin')) throw fail('This filter is unavailable for your role.');
    if (typeof query[key]!=='string' || !/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key]))) throw fail('Choose a valid department/course.');
    result[key]=Number(query[key]);
  }
  if (query.academicYear) {
    if (typeof query.academicYear!=='string' || !/^\d{4}-\d{4}$/.test(query.academicYear) || Number(query.academicYear.slice(5))!==Number(query.academicYear.slice(0,4))+1) throw fail('Use consecutive academic years, for example 2026-2027.');
    result.academicYear=query.academicYear;
  }
  if (query.term) { if (registrar || !['1st','2nd','summer'].includes(query.term)) throw fail('Choose a valid term.'); result.term=query.term; }
  for (const key of ['from','to']) if (query[key]) {
    const value=query[key];
    if (registrar || typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw fail('Choose a valid internship start date.');
    result[key]=value;
  }
  if (result.from && result.to && result.from>result.to) throw fail('From date must not follow To date.');
  return result;
}
const recordsSql = `SELECT ir.id,ir.user_id,ir.company_name,ir.status,ir.semester,
 DATE_FORMAT(ir.date_started,'%Y-%m-%d') AS date_started,
 sai.department_id,sai.course_id,c.course_name,d.code AS department_code
 FROM internship_records ir JOIN users u ON u.id=ir.user_id
 LEFT JOIN student_academic_info sai ON sai.id=(SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id=ir.user_id)
 LEFT JOIN courses c ON c.id=sai.course_id LEFT JOIN departments d ON d.id=sai.department_id
 WHERE ir.deleted_at IS NULL AND u.deleted_at IS NULL AND ir.status IN ('ongoing','finished')`;
async function read(req,res,registrar) {
  let connection,transaction=false;
  res.set('Cache-Control','private, no-store');
  try {
    connection=await db.getConnection();
    await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();transaction=true;
    const department=await analyticsScope(connection,req.verifiedUser,registrar), selected=filters(req.query,req.verifiedUser.role,registrar);
    if(registrar && !selected.academicYear)selected.academicYear=getCurrentAcademicYear();
    const departmentId=department ?? selected.departmentId;
    const [departments]=registrar || department ? [[]] : await connection.execute('SELECT id,name,code FROM departments ORDER BY name');
    const [courses]=await connection.execute(`SELECT id,course_name,short_name,department_id FROM courses ${department ? 'WHERE department_id=?' : ''} ORDER BY course_name`,department?[department]:[]);
    if (selected.courseId && !courses.some(row=>Number(row.id)===selected.courseId && (!departmentId || Number(row.department_id)===departmentId))) throw fail('The selected course is outside the permitted department.',403);
    const clauses=[],params=[];
    if(departmentId){clauses.push('sai.department_id=?');params.push(departmentId);}
    if(selected.courseId){clauses.push('sai.course_id=?');params.push(selected.courseId);}
    const source=registrar?recordsSql.replace('AND u.deleted_at IS NULL','')+' AND sai.id IS NOT NULL AND c.id IS NOT NULL AND EXISTS (SELECT 1 FROM user_profiles report_profile WHERE report_profile.user_id=ir.user_id)':recordsSql;
    const [records]=await connection.execute(source+(clauses.length?' AND '+clauses.join(' AND '):'')+' ORDER BY ir.id',params);
    let data,years;
    if(registrar) {
      // Registrar already reads all Annex C drafts/submissions and Annex D placements.
      // No attendance, confidential evaluations or document-review data is queried.
      const [reports]=await connection.execute("SELECT id,academic_year,degree_program,status,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS created_at,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updated_at,DATE_FORMAT(submitted_at,'%Y-%m-%d %H:%i:%s') AS submitted_at FROM program_annual_reports ORDER BY id");
      data=registrarAnalytics(records,reports,selected.academicYear);
      years=[...new Set([...records.map(academicYear),...reports.map(row=>row.academic_year)].filter(Boolean))].sort().reverse();
    } else {
      // Reuse the existing company-directory sources. Manual alumni entries establish
      // known companies only: they lack linked student IDs and cannot be popularity counts.
      const zeroClauses=[],zeroParams=[];
      if(departmentId){zeroClauses.push('air.department_id=?');zeroParams.push(departmentId);}
      if(selected.courseId){zeroClauses.push('air.course_id=?');zeroParams.push(selected.courseId);}
      const [directory]=await connection.execute('SELECT air.company_name FROM alumni_internship_records air'+(zeroClauses.length?' WHERE '+zeroClauses.join(' AND '):''),zeroParams);
      data=companyAnalytics(records,directory,selected);
      years=[...new Set(records.map(academicYear).filter(Boolean))].sort().reverse();
    }
    await connection.commit();transaction=false;
    res.json({success:true,...data,filters:selected,options:{departments,courses,academicYears:years},generatedAt:new Date().toISOString()});
  } catch(error) {
    if(transaction) try{await connection.rollback();}catch{}
    if(!error.status) reportError('Analytics lookup:',error);
    res.status(error.status||500).json({success:false,error:error.status?error.message:'Could not load analytics. Please retry.'});
  } finally {connection?.release();}
}
export const getCompanyAnalytics=(req,res)=>read(req,res,false);
export const getRegistrarDashboard=(req,res)=>read(req,res,true);
