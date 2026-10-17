import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import cache from '../config/cache/cache.js';
import { db } from '../config/db.js';
process.env.ACCESS_TOKEN_SECRET='past-test';process.env.REFRESH_TOKEN_SECRET='past-refresh';process.env.TEMP_PASSWORD_SECRET='past-temp';
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_KEY='test-no-network';process.env.CACHE_ENABLED='true';
const {default:routes}=await import('../features/internship-records/routes/internshipRecordRoutes.js');
const {signAccessToken}=await import('../config/jwt.js');
const files=await import('../features/documents/controllers/fileControllers.js');
const searched=await import('../features/users/controllers/searchedUserController.js');
const {supabase}=await import('../config/supabase.js');
const originalExecute=db.execute,originalConnection=db.getConnection,originalFrom=supabase.storage.from;
const path='/api/v1/internships/my-past-internships';
let calls,mode,committed,emitted,activityLogs;
beforeEach(()=>{
 cache.flushAll();calls=0;mode='success';committed=false;emitted=0;activityLogs=[];
 db.execute=async(sql,params)=>{calls++;if(mode==='read-error')throw Error('offline');return [mode==='empty'?[]:[{id:params[0],company_name:'Company',status:'finished',file_count:2}]];};
 db.getConnection=async()=>({release(){},async beginTransaction(){},async rollback(){},async commit(){assert.ok(cache.has('owner'));if(mode==='commit-error')throw Error('commit');committed=true;},async execute(sql,params){
 if(sql.includes('INSERT INTO activity_logs'))activityLogs.push(params);
 if(!sql.trim().startsWith('SELECT'))return [{affectedRows:1,insertId:1}];
 if(mode==='missing')return [[]];
 if(sql.includes('FROM internship_documents'))return [[{id:'doc',user_id:'owner',file_name:'Completion Certificate',path:'test.pdf',uploaded_by_id:mode==='forbidden'?'other':'actor',uploaded_by_role:'employer',verification_status:'pending'}]];
 if(sql.includes('FROM internship_records'))return [[{id:'internship',employer_id:mode==='forbidden'?'other':'actor'}]];
 if(sql.includes('FROM requirement_types'))return [[{id:1,category:'post'}]];
 return [[{first_name:'Test',last_name:'User'}]];
 }});
 supabase.storage.from=()=>({async upload(){if(mode==='storage-error')return {error:Error('storage')};return {error:null};},async remove(){if(committed)assert.equal(cache.has('owner'),false);return {error:null};}});
});
after(async()=>{db.execute=originalExecute;db.getConnection=originalConnection;supabase.storage.from=originalFrom;cache.close();await db.end();});
async function client(t){const app=express();app.use('/api/v1',routes);const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return (suffix='',id='owner',role='student')=>fetch(`http://127.0.0.1:${server.address().port}${path}${suffix}`,{headers:id?{Authorization:`Bearer ${signAccessToken({id,role})}`}:{}});}
test('past internship lists cache sixty seconds and isolate identity, role and query variants',async t=>{
 const get=await client(t);
 for(const [suffix,id,role] of [['','owner','student'],['?page=2','owner','student'],['','other','student'],['','owner','admin'],['','owner','department_head']]){
 const first=await get(suffix,id,role);assert.equal(first.status,200);const body=await first.json();assert.equal(body[0].id,id);assert.equal(body[0].file_count,2);const before=calls;assert.deepEqual(await(await get(suffix,id,role)).json(),body);assert.equal(calls,before);
 }
 for(const key of cache.keys())assert.ok(cache.getTtl(key)-Date.now()>58000&&cache.getTtl(key)-Date.now()<=60000);
 assert.equal((await get('','owner','employer')).status,403);assert.equal((await get('',null)).status,401);
});
test('past internship errors bypass cache and empty lists are cached',async t=>{const get=await client(t);const error=console.error;console.error=()=>{};try{mode='read-error';assert.equal((await get()).status,500);assert.equal(cache.keys().length,0);}finally{console.error=error;}mode='empty';assert.deepEqual(await(await get()).json(),[]);const before=calls;await get();assert.equal(calls,before);});
function seed(){cache.set("overview",{path:"/api/v1/internship-records/overview/i",userId:"staff",body:{}});cache.set('metadata',{path:'/api/v1/searched-user/files/owner',userId:'admin',body:[]});for(const [key,userId]of [['owner','owner'],['owner-page','owner'],['other','other']])cache.set(key,{path,userId,body:[]});cache.set('unrelated',{path:'/api/v1/account/user',userId:'owner',body:{}});}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function request(employer=false){return {verifiedUser:{id:employer?'actor':'owner',role:employer?'employer':'student'},params:{searchedUserId:'owner',fileId:'doc'},body:{file_name:'Test',company_name:'Company',requirement_type_id:1},file:{mimetype:'application/pdf',size:4,originalname:'test.pdf',buffer:Buffer.from('test')},app:{get:()=>({to:()=>({emit:(_event,payload)=>{assert.ok(committed);assert.equal(cache.has('metadata'),false);assert.equal(cache.has('overview'),false);if(payload.type!=='certificate_accepted')assert.equal(cache.has('owner'),false);emitted++;}})})}};}
const writers=[[files.uploadInternshipFile,false],[files.deleteFile,false],[searched.uploadFileToSearchedStudent,true],[searched.deleteSearchedStudentFile,true]];
test('all four document writers invalidate only owner pages after commit and before socket/storage cleanup',async()=>{
 for(const [handler,employer]of writers){cache.flushAll();seed();committed=false;const res=response();await handler(request(employer),res);assert.ok(res.statusCode<300,JSON.stringify(res.body));assert.ok(committed);assert.equal(cache.has('owner'),false);assert.equal(cache.has('owner-page'),false);assert.ok(cache.has('other'));assert.ok(cache.has('unrelated'));}assert.ok(emitted>0);
});
test('document failed commits preserve owner caches and emit no events',async()=>{const error=console.error;console.error=()=>{};try{for(const [handler,employer]of writers){cache.flushAll();seed();mode='commit-error';const res=response();await handler(request(employer),res);assert.equal(res.statusCode,500);assert.ok(cache.has('metadata'));assert.ok(cache.has('owner'));assert.ok(cache.has('owner-page'));assert.equal(emitted,0);}}finally{console.error=error;}});
test('missing documents, denied uploads and storage failures preserve past lists',async()=>{const error=console.error;console.error=()=>{};try{for(const [handler,employer,failure,code]of [[files.deleteFile,false,'missing',404],[searched.deleteSearchedStudentFile,true,'forbidden',403],[searched.uploadFileToSearchedStudent,true,'forbidden',403],[files.uploadInternshipFile,false,'storage-error',500]]){cache.flushAll();seed();mode=failure;const res=response();await handler(request(employer),res);assert.equal(res.statusCode,code);assert.ok(cache.has('owner'));assert.equal(emitted,0);}}finally{console.error=error;}});

test('document approval clears metadata only after commit',async()=>{const error=console.error;console.error=()=>{};try{for(const failed of [false,true]){cache.flushAll();seed();mode=failed?'commit-error':'success';const res=response();await files.approveInternshipDocument(request(),res);assert.equal(res.statusCode,failed?500:200);assert.equal(cache.has('metadata'),failed);assert.equal(cache.has('overview'),failed);assert.ok(cache.has('owner'));}}finally{console.error=error;}});

test('document approval and both deletion paths log file names with structured IDs',async()=>{
 for(const [handler,employer] of [[files.approveInternshipDocument,false],[files.deleteFile,false],[searched.deleteSearchedStudentFile,true]]){
  cache.flushAll();seed();committed=false;activityLogs=[];
  const res=response();await handler(request(employer),res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));
  assert.equal(activityLogs.length,1);
  assert.match(activityLogs[0][5],/Completion Certificate/);
  assert.doesNotMatch(activityLogs[0][5],/document doc|file doc/);
  assert.equal(activityLogs[0][4],'doc');
 }
});
