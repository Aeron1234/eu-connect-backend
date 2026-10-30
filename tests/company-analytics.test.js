import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../config/db.js';
import { companyAnalytics,academicYear } from '../features/analytics/analyticsModel.js';
import { getCompanyAnalytics,getRegistrarDashboard } from '../features/analytics/analyticsController.js';
import express from 'express';
import { once } from 'node:events';
process.env.ACCESS_TOKEN_SECRET='company-analytics-test-key';
process.env.REFRESH_TOKEN_SECRET='company-analytics-refresh-key';
process.env.TEMP_PASSWORD_SECRET='company-analytics-temp-key';
const {default:routes}=await import('../features/analytics/analyticsRoutes.js');
const {signAccessToken}=await import('../config/jwt.js');
let database,committed,released;
const original=db.getConnection;
beforeEach(()=>{
  database?.close();database=new DatabaseSync(':memory:');committed=0;released=0;
  database.function('DATE_FORMAT',(value,pattern)=>value==null?null:pattern.includes('%H')?value:value.slice(0,10));
  database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,deleted_at TEXT);
  CREATE TABLE user_profiles(user_id TEXT);
  CREATE TABLE departments(id INTEGER PRIMARY KEY,name TEXT,code TEXT);
  CREATE TABLE dept_heads_background_info(user_id TEXT,department_id INTEGER);
  CREATE TABLE student_academic_info(id INTEGER PRIMARY KEY,user_id TEXT,course_id INTEGER,department_id INTEGER);
  CREATE TABLE courses(id INTEGER PRIMARY KEY,course_name TEXT,short_name TEXT,department_id INTEGER);
  CREATE TABLE internship_records(id TEXT,user_id TEXT,company_name TEXT,status TEXT,semester TEXT,date_started TEXT,deleted_at TEXT);
  CREATE TABLE alumni_internship_records(company_name TEXT,department_id INTEGER,course_id INTEGER);
  CREATE TABLE program_annual_reports(id TEXT,academic_year TEXT,degree_program TEXT,status TEXT,created_at TEXT,updated_at TEXT,submitted_at TEXT);
  INSERT INTO departments VALUES(1,'Computing','CCS'),(2,'Tourism','CITHM'),(3,'Registrar','REG');
  INSERT INTO courses VALUES(1,'Computer Science','BSCS',1),(2,'Tourism','BSTM',2);
  INSERT INTO dept_heads_background_info VALUES('head',1),('registrar',3);
  INSERT INTO users VALUES('a',NULL),('b',NULL),('c',NULL),('deleted','2026-01-01');
  INSERT INTO user_profiles SELECT id FROM users;
  INSERT INTO student_academic_info VALUES(1,'a',1,1),(2,'b',1,1),(3,'c',2,2),(4,'deleted',1,1);
  INSERT INTO internship_records VALUES
  ('1','a',' ACME ','finished','1st','2026-08-01',NULL),
  ('2','a','acme','ongoing','1st','2026-09-01',NULL),
  ('3','b','Acme','finished','1st','2026-08-03',NULL),
  ('4','c','Beta','ongoing','1st','2026-08-04',NULL),
  ('5','a','Old Company','finished','1st','2025-08-01',NULL),
  ('6','a','Rejected','rejected','1st','2026-08-01',NULL),
  ('7','b','Pending','pending','1st','2026-08-01',NULL),
  ('8','a','Soft deleted','finished','1st','2026-08-01','2026-09-01'),
  ('9','deleted','Deleted student','finished','1st','2026-08-01',NULL),
  ('10','b','Undated','finished',NULL,NULL,NULL);
  INSERT INTO alumni_internship_records VALUES('Directory only',1,1),('Tourism directory',2,2);
  INSERT INTO program_annual_reports VALUES('r1','2026-2027','Computer Science','draft','2026-10-01','2026-10-02',NULL),('r2','2026-2027','Tourism','submitted','2026-10-01','2026-10-03','2026-10-03'),('r3','2025-2026','Computer Science','submitted','2025-10-01','2025-10-02','2025-10-02');`);
  db.getConnection=async()=>({release(){released++;},async beginTransaction(){database.exec('BEGIN');},async commit(){database.exec('COMMIT');committed++;},async rollback(){database.exec('ROLLBACK');},async execute(sql,params=[]){if(sql.startsWith('SET TRANSACTION'))return [{}];return [database.prepare(sql).all(...params).map(row=>({...row}))];}});
});
after(async()=>{database?.close();db.getConnection=original;await db.end();});
async function read(handler,role='admin',id=role,query={}){
  const res={statusCode:200,set(){return this;},status(value){this.statusCode=value;return this;},json(body){this.body=body;return this;}};
  await handler({verifiedUser:{id,role,department_id:999,department_code:'CCS'},query},res);return res;
}
test('distinct student/company counts exclude applications, deleted records/users and normalize repeated company names',async()=>{
  const result=await read(getCompanyAnalytics,'admin','admin',{academicYear:'2026-2027'});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body.companies.map(row=>[row.company,row.students,row.ongoing,row.finished]),[['ACME',2,1,1],['Beta',1,1,0]]);
  assert.equal(result.body.stats.distinctStudents,3);assert.equal(result.body.stats.studentCompanyPairs,3);
  assert.equal(result.body.stats.ongoing+result.body.stats.finished,3);
  assert(result.body.zeroCompanies.some(row=>row.company==='Directory only'));
  assert(result.body.zeroCompanies.some(row=>row.company==='Old Company'));
  assert(!result.body.companies.some(row=>/Pending|Rejected|Deleted/i.test(row.company)));
  assert.equal(result.body.least[0].company,'Beta');assert.equal(committed,1);assert.equal(released,1);
});
test('department heads use current department and latest student membership; cannot inject other departments/courses',async()=>{
  const result=await read(getCompanyAnalytics,'department_head','head');
  assert(!result.body.companies.some(row=>row.company==='Beta'));
  assert(!result.body.zeroCompanies.some(row=>row.company==='Tourism directory'));
  assert.equal((await read(getCompanyAnalytics,'department_head','head',{departmentId:'2'})).statusCode,400);
  assert.equal((await read(getCompanyAnalytics,'department_head','head',{courseId:'2'})).statusCode,403);
  database.prepare('INSERT INTO student_academic_info VALUES(99,?,?,?)').run('b',2,2);
  const transferred=await read(getCompanyAnalytics,'department_head','head',{academicYear:'2026-2027'});
  assert.equal(transferred.body.companies[0].students,1);
});
test('Registrar, students and employers cannot access popularity; only current Registrar can access its dashboard',async()=>{
  for(const [role,id] of [['student','a'],['employer','employer'],['department_head','registrar'],['department_head','missing']])assert.equal((await read(getCompanyAnalytics,role,id)).statusCode,403);
  for(const [role,id] of [['admin','admin'],['department_head','head'],['student','a']])assert.equal((await read(getRegistrarDashboard,role,id)).statusCode,403);
  const reg=await read(getRegistrarDashboard,'department_head','registrar',{academicYear:'2026-2027'});
  assert.equal(reg.statusCode,200);assert.deepEqual(reg.body.stats,{confirmedStudents:4,confirmedRecords:5,reports:2,drafts:1,submitted:1});
  assert.equal(reg.body.distribution.reduce((sum,row)=>sum+row.students,0),4);
  assert.deepEqual(reg.body.trends,[{month:'2026-10',reports:1}]);assert.equal(reg.body.companies,undefined);
});
test('date bounds are inclusive, intersect academic year/term and report totals equal detailed rows',async()=>{
  const result=await read(getCompanyAnalytics,'admin','admin',{from:'2026-08-01',to:'2026-08-03',academicYear:'2026-2027',term:'1st'});
  assert.equal(result.body.companies.length,1);assert.equal(result.body.companies[0].students,2);
  assert.equal(result.body.stats.studentCompanyPairs,result.body.companies.reduce((sum,row)=>sum+row.students,0));
  for(const query of [{from:'2026-02-30'},{from:'2027-01-01',to:'2026-01-01'},{academicYear:'2026-2028'},{term:'bad'},{courseId:'1 OR 1=1'},{departmentId:'2',courseId:'1'}])assert((await read(getCompanyAnalytics,'admin','admin',query)).statusCode>=400);
});
test('zero matches stay separate, all-time undated rows remain visible, ties and empty datasets are meaningful',async()=>{
  const all=await read(getCompanyAnalytics);assert(all.body.companies.some(row=>row.company==='Undated'));assert.equal(all.body.stats.undatedRecords,1);
  const future=await read(getCompanyAnalytics,'admin','admin',{from:'2030-01-01'});assert.equal(future.body.companies.length,0);assert.equal(future.body.least.length,0);assert(future.body.zeroCompanies.length>0);
  const model=companyAnalytics([{user_id:'a',company_name:'A',status:'finished',date_started:null},{user_id:'a',company_name:'B',status:'finished',date_started:null}],[],{});
  assert.equal(model.stats.distinctStudents,1);assert.equal(model.stats.studentCompanyPairs,2);assert.equal(model.most.length,2);assert.equal(model.least.length,2);
});
test('academic years match existing semester-aware report rules',()=>{
  for(const [date_started,semester,expected] of [['2026-01-01','1st','2026-2027'],['2026-12-01','2nd','2026-2027'],['2026-02-01','2nd','2025-2026'],['2026-05-01','summer','2025-2026'],['2026-08-01',null,'2026-2027'],['2026-06-01',null,'2025-2026']])assert.equal(academicYear({date_started,semester}),expected);
});
test('mounted APIs reject unauthenticated and forbidden roles across both API prefixes',async t=>{
  const app=express();app.use(['/api/v1','/eu-connect/api'],routes);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  for(const prefix of ['/api/v1','/eu-connect/api']){
    for(const [path,role,id,status] of [['/analytics/companies',null,null,401],['/analytics/companies','student','a',403],['/analytics/companies','employer','employer',403],['/analytics/companies','department_head','registrar',403],['/analytics/companies','department_head','head',200],['/analytics/companies','admin','admin',200],['/registrar/dashboard','department_head','head',403],['/registrar/dashboard','department_head','registrar',200]]){
      const response=await fetch(`http://127.0.0.1:${server.address().port}${prefix}${path}`,{headers:role?{Authorization:'Bearer '+signAccessToken({id,role,department_code:'CCS',department_id:999})}:{}});
      assert.equal(response.status,status,`${path} ${role}/${id}`);
      if(status===200)assert.equal(response.headers.get('cache-control'),'private, no-store');
    }
  }
});
test('a failed snapshot returns an error and releases the connection without partial success',async()=>{
  database.exec('DROP TABLE alumni_internship_records');
  const result=await read(getCompanyAnalytics);
  assert.equal(result.statusCode,500);assert.equal(result.body.success,false);assert.equal(result.body.companies,undefined);assert.equal(committed,0);assert.equal(released,1);assert.equal(database.isTransaction,false);
});
