import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import cache from '../config/cache.js';
import { db } from '../config/db.js';
import * as reports from '../controllers/hteReportControllers.js';
process.env.ACCESS_TOKEN_SECRET = 'reports-test';
process.env.REFRESH_TOKEN_SECRET = 'reports-refresh';
process.env.TEMP_PASSWORD_SECRET = 'reports-temp';
process.env.CACHE_ENABLED = 'true';
const { default: routes } = await import('../routes/hteReportRoutes.js');
const { signAccessToken } = await import('../config/jwt.js');
const original = db.getConnection;
const base='/eu-connect/api';
let calls, allowed, fail, empty, existing, committed, released;
beforeEach(() => {
  cache.flushAll(); calls=0; allowed=true; fail=''; empty=false; existing=false; committed=false; released=0;
  db.getConnection=async()=>({
    release(){released++;}, async beginTransaction(){}, async rollback(){},
    async commit(){assert.ok(cache.has('annual')); if(fail==='commit') throw Error('commit'); committed=true;},
    async query(){return [{affectedRows:1}];},
    async execute(sql){
      if(sql.includes("d.code = 'REG'")) {if(fail==='auth') throw Error('auth offline'); return [allowed?[{ok:1}]:[]];}
      calls++;
      if(fail==='read' || (fail==='after-commit' && committed)) throw Error('read offline');
      if(!sql.trim().startsWith('SELECT')) return [{affectedRows:1}];
      if(sql.includes('FOR UPDATE')) return [existing?[{id:'r',degree_program:'Computing',academic_year:'2026-2027'}]:[]];
      if(sql.includes('COUNT(') && !sql.includes('AS intern_count')) return [[{total:empty?0:1}]];
      if(empty) return [[]];
      if(sql.includes('DISTINCT academic_year')) return [[{academic_year:'2026-2027'}]];
      if(sql.includes('program_annual_report_entries')) return [[{report_id:'r',issue:'Issue',solution:'Solution',recommendation:'Advice'}]];
      if(sql.includes('program_annual_reports')) return [[{id:'r',academic_year:'2026-2027',degree_program:'Computing',status:'draft'}]];
      return [[{company_key:'key',company_name:'Company',company_address:'City',intern_count:1,first_name:'Test',last_name:'Student',gender:'F',course_name:'Computing',date_started:'2026-08-01',date_ended:'2026-12-01'}]];
    }
  });
});
after(async()=>{db.getConnection=original;cache.close();await db.end();});
async function client(t){
  const app=express();app.use(base,routes);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return (path,role='admin',id='viewer',department_id=1)=>fetch(`http://127.0.0.1:${server.address().port}${base}${path}`,{headers:id?{Authorization:`Bearer ${signAccessToken({id,role,department_id})}`}:{}});
}
const paths=['/reports/academic-years','/reports/hte-annual/companies?academicYear=2026-2027','/reports/hte-annual/company?academicYear=2026-2027&companyKey=key','/reports/annex-c?academicYear=2026-2027'];
test('four report reads cache for sixty seconds with original JSON shapes',async t=>{
  const get=await client(t);
  for(const path of paths){const first=await get(path);assert.equal(first.status,200);const body=await first.json();const before=calls;assert.deepEqual(await(await get(path)).json(),body);assert.equal(calls,before);}
  assert.equal(cache.keys().length,4);
  for(const key of cache.keys()) assert.ok(cache.getTtl(key)-Date.now()>58000 && cache.getTtl(key)-Date.now()<=60000);
  assert.equal(released,7);
});
test('Registrar access is rechecked on hits, including database failure and revoked assignment',async t=>{
  const get=await client(t); const error=console.error;console.error=()=>{};
  try{for(const path of paths.slice(1)){
    allowed=true;fail='';assert.equal((await get(path,'department_head')).status,200);
    const before=calls;assert.equal((await get(path,'department_head')).status,200);assert.equal(calls,before);
    allowed=false;assert.equal((await get(path,'department_head')).status,403);
    fail='auth';assert.equal((await get(path,'department_head')).status,500);
    fail='';assert.equal((await get(path,'student')).status,403);assert.equal((await get(path,'admin',null)).status,401);
  }}finally{console.error=error;}
  assert.equal((await get(paths[0],'department_head')).status,200);
});
test('report filters, company keys, users and departments remain isolated; detail reads stay uncached',async t=>{
  const get=await client(t);
  for(const suffix of ['', '&search=Company','&page=2','&limit=5','&companyKey=key','&companyKey=other']){
    const path=paths[1]+suffix;let before=calls;assert.equal((await get(path)).status,200);assert.ok(calls>before);before=calls;await get(path);assert.equal(calls,before);
  }
  for(const [role,id,dept] of [['admin','other',1],['admin','viewer',2],['department_head','viewer',1]]){const before=calls;await get(paths[1],role,id,dept);assert.ok(calls>before);}
  for(const path of ['/reports/annex-c/r','/reports/annex-c/other']){await get(path);const before=calls;await get(path);assert.ok(calls>before);}
});
function seed(){for(const [key,path] of [['annual','/reports/annex-c'],['annual-other','/reports/annex-c'],['hte','/reports/hte-annual/companies'],['profile','/account/user']]) cache.set(key,{path:base+path,userId:key,body:{}});}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
const req={verifiedUser:{id:'admin',role:'admin'},params:{reportId:'r'},body:{academicYear:'2026-2027',degreeProgram:'Computing',entries:[{issue:'Issue'}],status:'draft'}};
test('annual creation, update, submission and deletion invalidate all summaries after commit',async()=>{
  for(const kind of ['create','update','submit','delete']){
    cache.flushAll();seed();existing=kind!=='create';const res=response();
    await (kind==='delete'?reports.deleteProgramAnnualReport:reports.saveProgramAnnualReport)({...req,body:{...req.body,status:kind==='submit'?'submitted':'draft',preparedBy:'Registrar'}},res);
    assert.equal(res.statusCode,200);assert.ok(committed);assert.deepEqual(cache.keys(),['hte','profile']);
  }
});
test('annual rollback, validation, missing and denied writes preserve summaries',async()=>{
  const error=console.error;console.error=()=>{};
  try{
    for(const kind of ['create','update','delete']){cache.flushAll();seed();fail='commit';existing=kind!=='create';const res=response();await(kind==='delete'?reports.deleteProgramAnnualReport:reports.saveProgramAnnualReport)(req,res);assert.equal(res.statusCode,500);assert.equal(cache.keys().length,4);}
    fail='';existing=false;
    for(const [handler,input,status] of [[reports.deleteProgramAnnualReport,req,404],[reports.saveProgramAnnualReport,{...req,body:{}},400],[reports.saveProgramAnnualReport,{...req,verifiedUser:{id:'head',role:'department_head'}},403]]){allowed=false;const res=response();await handler(input,res);assert.equal(res.statusCode,status);assert.ok(cache.has('annual'));}
  }finally{console.error=error;}
});
test('committed annual save invalidates even if response reread fails',async()=>{
  seed();fail='after-commit';const error=console.error;console.error=()=>{};
  try{const res=response();await reports.saveProgramAnnualReport(req,res);assert.equal(res.statusCode,500);assert.ok(committed);assert.equal(cache.has('annual'),false);}finally{console.error=error;}
});
test('report read errors, missing reports and invalid input never cache; empty summaries do',async t=>{
  const get=await client(t);const error=console.error;console.error=()=>{};
  try{fail='read';for(const path of paths)assert.equal((await get(path)).status,500);}finally{console.error=error;}
  assert.equal(cache.keys().length,0);fail='';empty=true;
  assert.equal((await get(paths[2])).status,404);
  assert.equal((await get('/reports/hte-annual/company?academicYear=bad')).status,400);
  assert.equal(cache.keys().length,0);
  for(const path of [paths[0],paths[1],paths[3]]){assert.equal((await get(path)).status,200);const before=calls;await get(path);assert.equal(calls,before);}
});
