import {test,beforeEach,after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {once} from 'node:events';import cache from '../config/cache/cache.js';import {db} from '../config/db.js';import {invalidateProfileOverviewCache} from '../config/cache/profileOverviewCache.js';
process.env.ACCESS_TOKEN_SECRET='profile-test';process.env.REFRESH_TOKEN_SECRET='profile-refresh';process.env.TEMP_PASSWORD_SECRET='profile-temp';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_KEY='no-network';process.env.CACHE_ENABLED='true';
const {default:searched}=await import('../features/users/routes/searchedUserRoutes.js');const {default:internships}=await import('../features/internship-records/routes/internshipRecordRoutes.js');const {signAccessToken}=await import('../config/jwt.js');const original=db.getConnection;let calls,mode,dept,role;
beforeEach(()=>{cache.flushAll();calls=0;mode='success';dept=1;role='student';db.getConnection=async()=>({release(){},async execute(sql,params){if(sql.includes('SELECT ir.id, ir.deleted_at'))return [[{id:'i',deleted_at:mode==='deleted'?'date':null,department_id:1}]];if(sql.includes('FROM dept_heads_background_info'))return [[{department_id:dept}]];calls++;if(mode==='error')throw Error('offline');if(sql.includes('FROM users u'))return [mode==='missing'?[]:[{user_id:params[0],first_name:'Test',last_name:'User',role_name:role,hours_rendered:20,total_hours:100,student_internship_id:'i',student_internship_employer_id:'supervisor'}]];if(sql.includes('supervisor_requests')){if(mode==='partial')throw Error('supervision failed');return [[{id:'request',employer_id:'employer',request_id:'request'}]];}if(sql.trim().startsWith('SELECT COUNT(*)')){assert.ok(!sql.includes('daily_narratives'));return [[{count:sql.includes('weekly_narratives')?7:2}]];}return [[{student_id:'student',first_name:'Test',last_name:'Student',total_hours:100,accumulated_hours:20,company_name:'Company',dtr_count:2,narrative_count:7,document_count:2}]];}});});
after(async()=>{db.getConnection=original;cache.close();await db.end();});
async function client(t){const app=express();app.use('/api/v1',searched,internships);const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return(path,viewerRole=path.startsWith('/internship-records/')?'department_head':'admin',id='viewer')=>fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{headers:id?{Authorization:`Bearer ${signAccessToken({id,role:viewerRole,department_id:1})}`}:{}});}
test('searched profiles and overviews cache thirty seconds; overview counts weekly entries',async t=>{const get=await client(t);for(const path of ['/searched-user/student','/internship-records/overview/i']){const res=await get(path);assert.equal(res.status,200);const body=await res.json();if(path.includes('overview')){assert.equal(body.narrative_count,7);assert.equal(body.percent_complete,20);}const before=calls;assert.deepEqual(await(await get(path)).json(),body);assert.equal(calls,before);}for(const key of cache.keys())assert.ok(cache.getTtl(key)-Date.now()>28000&&cache.getTtl(key)-Date.now()<=30000);});
test('supervision remains viewer-specific in both directions and partial lookup results never cache',async t=>{const get=await client(t);assert.equal((await(await get('/searched-user/student','employer','supervisor')).json()).user.supervision.status,'accepted');assert.equal((await(await get('/searched-user/student','employer','other')).json()).user.supervision.status,'pending');role='employer';assert.equal((await(await get('/searched-user/employer','student','student')).json()).user.supervision.status,'accepted');cache.flushAll();role='student';mode='partial';const error=console.error;console.error=()=>{};try{for(let i=0;i<2;i++){const before=calls;const res=await get('/searched-user/student','employer','other');assert.equal(res.status,200);assert.ok(calls>before);assert.equal(cache.keys().length,0);}}finally{console.error=error;}});
test('profile targets and queries stay separate and overview hits enforce current record access',async t=>{const get=await client(t);for(const path of ['/searched-user/a','/searched-user/b','/searched-user/a?page=2','/internship-records/overview/i']){const before=calls;assert.equal((await get(path)).status,200);assert.ok(calls>before);assert.equal((await get(path,'unknown')).status,403);assert.equal((await get(path,'admin',null)).status,401);}assert.equal((await get('/internship-records/overview/i','admin')).status,403);await get('/internship-records/overview/i','department_head');dept=2;assert.equal((await get('/internship-records/overview/i','department_head')).status,403);dept=1;mode='deleted';assert.equal((await get('/internship-records/overview/i')).status,404);});
test('profile and overview errors and missing profiles never cache; invalidation excludes nested metadata',async t=>{const get=await client(t),error=console.error;console.error=()=>{};try{mode='error';for(const path of ['/searched-user/student','/internship-records/overview/i'])assert.equal((await get(path)).status,500);}finally{console.error=error;}mode='missing';assert.equal((await get('/searched-user/student')).status,404);assert.equal(cache.keys().length,0);mode='success';await get('/searched-user/student');await get('/internship-records/overview/i');cache.set('metadata',{path:'/api/v1/searched-user/files/student',body:{}});invalidateProfileOverviewCache();assert.deepEqual(cache.keys(),['metadata']);});
test('searched profile retries a dropped read connection once and releases both', async t => {
  const get = await client(t);
  const previous = db.getConnection;
  t.after(() => { db.getConnection = previous; });
  let acquisitions = 0;
  let releases = 0;
  db.getConnection = async () => {
    const attempt = ++acquisitions;
    return {
      release() { releases++; },
      async execute(sql, params) {
        if (attempt === 1) {
          const error = new Error('read ECONNRESET');
          error.code = 'ECONNRESET';
          throw error;
        }
        assert.match(sql, /FROM users u/);
        return [[{ user_id: params[0], first_name: 'Test', last_name: 'User', role_name: 'student' }]];
      },
    };
  };
  const response = await get('/searched-user/student');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.header.first_name, 'Test');
  assert.equal(acquisitions, 2);
  assert.equal(releases, 2);
});

test('searched profile does not retry a non-transient query error', async t => {
  const get = await client(t);
  const previous = db.getConnection;
  t.after(() => { db.getConnection = previous; });
  let acquisitions = 0;
  db.getConnection = async () => {
    acquisitions++;
    return {
      release() {},
      async execute() {
        const error = new Error('bad column');
        error.code = 'ER_BAD_FIELD_ERROR';
        throw error;
      },
    };
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await get('/searched-user/student')).status, 500);
  } finally {
    console.error = originalError;
  }
  assert.equal(acquisitions, 1);
  assert.equal(cache.keys().length, 0);
});
