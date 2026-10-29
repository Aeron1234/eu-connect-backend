import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import cache from '../config/cache/cache.js';
import { createUser } from '../features/accounts/controllers/accountControllers.js';
import { prepareAccountSetup, completeAccountSetup, resendAccountInvitation, requestPasswordSetup } from '../features/auth/accountSetup.js';
import { login, refresh } from '../features/auth/controllers/authControllers.js';
import { sendAccountSetupEmail } from '../services/accountSetupMail.js';
import { createSocketTicket } from '../features/auth/controllers/socketAuthController.js';
import { verifyUser, verifyPasswordSetupSession } from '../middleware/verifyUser.js';
import { signPasswordSetupToken, signAccessToken, signTempPassword, signRefreshToken, hashToken } from '../config/jwt.js';

const original = { getConnection: db.getConnection, execute: db.execute, fetch: global.fetch };
after(async () => { Object.assign(db, { getConnection: original.getConnection, execute: original.execute }); global.fetch = original.fetch; cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, set() {}, cookie() {}, clearCookie() {}, status(c) { this.statusCode = c; return this; }, json(body) { this.body = body; return this; } });
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const token = 'a'.repeat(64);
const passwords = { token, newPassword: 'UNIQUE-test-password', confirmPassword: 'UNIQUE-test-password' };
const setupUser = { id: 'new-user', username: 'new.user', email: 'new@example.test', password_setup_required: 1, status: 'active', role: 'student' };

test('creation ignores a submitted password, saves pending setup and commits before delivery; email failure is not creation failure', async () => {
  const calls = []; let committed = false, released = false;
  delete process.env.EMAILJS_SERVICE_ID;
  db.getConnection = async () => ({ async beginTransaction() {}, async rollback() { assert.fail('must not rollback a successful creation'); },
    async commit() { committed = true; }, release() { released = true; }, async execute(sql, params) {
      calls.push({sql,params});
      if (sql.includes('FROM roles')) return [[{role:'employer'}]];
      if (sql.startsWith('SELECT id FROM users')) return [[]];
      return [{affectedRows:1}];
    } });
  const req={verifiedUser:{id:'admin',role:'admin'},body:{username:'new.user',email:'new@example.test',first_name:'New',last_name:'User',role:'3',password:'ATTACKER-chosen-password'}};
  const res=response(); await createUser(req,res);
  assert.equal(res.statusCode,201); assert(committed); assert(released);
  assert.equal(res.body.success,true); assert.equal(res.body.invitation_sent,false); assert.match(res.body.message,/do not create.*again/);
  const insert=calls.find(x=>x.sql.startsWith('INSERT INTO users'));
  assert.match(insert.sql,/password_setup_required.*1\)/); assert.equal(await bcrypt.compare(req.body.password,insert.params[3]),false);
  const stored=calls.find(x=>x.sql.startsWith('UPDATE users SET password_setup_token_hash'));
  assert.equal(stored.params[0].length,64); assert.equal(stored.params[1],1440);
  assert.equal('token' in res.body,false); assert(!JSON.stringify(res.body).includes(stored.params[0]));
});

test('preparing invitations/recovery stores only a digest, replaces previous credentials, and uses distinct expiry periods',async()=>{
  for(const pending of [0,1]){
    const calls=[];const job=await prepareAccountSetup({async execute(sql,params){calls.push({sql,params});return[{affectedRows:1}];}}, {...setupUser,password_setup_required:pending});
    assert.match(job.token,/^[a-f0-9]{64}$/);assert.equal(calls[0].params[0],digest(job.token));assert.notEqual(calls[0].params[0],job.token);
    assert.equal(calls[0].params[1],pending?1440:30);assert.match(calls[0].sql,/temp_password_jti = NULL/);
  }
});

test('successful creation sends only after committing and releasing its connection, without requiring an admin password',async()=>{
  Object.assign(process.env,{EMAILJS_SERVICE_ID:'test-service',EMAILJS_TEMPLATE_ID:'test-template',EMAILJS_PUBLIC_KEY:'test-public',EMAILJS_PRIVATE_KEY:'test-private',CLIENT_URL:'https://frontend.example.test'});
  let committed=false,released=false,delivered=0;
  db.getConnection=async()=>({async beginTransaction(){},async rollback(){assert.fail('must not rollback');},async commit(){committed=true;},release(){released=true;},async execute(sql){
    if(sql.includes('FROM roles'))return[[{role:'employer'}]];
    if(sql.startsWith('SELECT id FROM users'))return[[]];return[{affectedRows:1}];
  }});
  global.fetch=async(_url,options)=>{assert(committed);assert(released);const payload=JSON.parse(options.body);assert.equal(payload.template_params.to_email,'new@example.test');delivered++;return new Response('OK');};
  const res=response();await createUser({verifiedUser:{id:'admin',role:'admin'},body:{username:'new.user',email:'new@example.test',first_name:'New',last_name:'User',role:'3'}},res);
  assert.equal(res.statusCode,201);assert.equal(res.body.invitation_sent,true);assert.equal(delivered,1);
});

test('setup consumes exactly one token and commits password, activation, session revocation and audit together',async()=>{
  let available=true,lock=Promise.resolve();const writes=[];let commits=0;
  db.getConnection=async()=>{let unlock;return{async beginTransaction(){},async commit(){commits++;unlock?.();},async rollback(){unlock?.();},release(){},async execute(sql,params){
    if(sql.includes('SELECT u.id')){const previous=lock;lock=new Promise(resolve=>{unlock=resolve;});await previous;assert.match(sql,/FOR UPDATE/);assert.match(sql,/expires_at > NOW\(\)/);assert.deepEqual(params,[digest(token)]);return[available?[setupUser]:[]];}
    writes.push({sql,params});if(sql.startsWith('UPDATE users SET password_hash')){assert.match(sql,/password_setup_required = 0/);assert.match(sql,/password_setup_token_hash = NULL/);assert.equal(await bcrypt.compare(passwords.newPassword,params[0]),true);available=false;}
    return[{affectedRows:1}];
  }}};
  const a=response(),b=response();await Promise.all([completeAccountSetup({body:passwords},a),completeAccountSetup({body:passwords},b)]);
  assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,400]);assert.equal(commits,1);
  assert.equal(writes.filter(x=>x.sql.startsWith('UPDATE refresh_tokens')).length,1);
  assert.equal(writes.filter(x=>x.sql.startsWith('INSERT INTO activity_logs')).length,1);
});

test('expired/replaced/deactivated or unknown links cannot write; malformed credentials fail before database access',async()=>{
  db.getConnection=async()=>({async beginTransaction(){},async rollback(){},release(){},async execute(sql){assert.match(sql,/status = 'active'.*deleted_at IS NULL/s);assert(sql.includes('SELECT'));return[[]];}});
  const expired=response();await completeAccountSetup({body:passwords},expired);assert.equal(expired.statusCode,400);
  db.getConnection=async()=>assert.fail('invalid input must not acquire a connection');
  for(const body of [{...passwords,token:'bad'},{...passwords,newPassword:'short'},{...passwords,confirmPassword:'different'},{...passwords,newPassword:'🌴'.repeat(30),confirmPassword:'🌴'.repeat(30)}]){
    const res=response();await completeAccountSetup({body},res);assert.equal(res.statusCode,400);
  }
});

test('a setup transaction failure rolls back without claiming completion or invalidating cached data',async()=>{
  cache.set('setup-cache-fixture',{userId:'new-user',path:'/api/v1/accounts',body:{pending:true}});
  let rolledBack=false;
  db.getConnection=async()=>({async beginTransaction(){},async rollback(){rolledBack=true;},async commit(){assert.fail('must not commit');},release(){},async execute(sql){
    if(sql.includes('SELECT u.id'))return[[setupUser]];
    if(sql.startsWith('UPDATE users SET password_hash'))return[{affectedRows:1}];
    throw new Error('test failure');
  }});
  const res=response();await completeAccountSetup({body:passwords},res);assert.equal(res.statusCode,500);assert(rolledBack);assert(cache.has('setup-cache-fixture'));
});

test('resend enforces pending/active state and cooldown without sending or writing on denial',async()=>{
  for(const user of [null,{...setupUser,password_setup_required:0},{...setupUser,status:'inactive'},{...setupUser,cooldown:1}]){
    db.getConnection=async()=>({async beginTransaction(){},async rollback(){},release(){},async execute(sql){assert(sql.includes('SELECT'));return[user?[user]:[]];}});
    const res=response();await resendAccountInvitation({params:{accountId:'new-user'},verifiedUser:{id:'admin',role:'admin'}},res);
    assert.equal(res.statusCode,user?.cooldown?429:409);
  }
});

test('public recovery returns the same response for missing, inactive, throttled and send-failed accounts',async()=>{
  delete process.env.EMAILJS_SERVICE_ID;
  const bodies=[];
  for(const user of [null,{...setupUser,status:'inactive'},{...setupUser,cooldown:1},setupUser,{...setupUser,password_setup_required:0}]){
    db.getConnection=async()=>({async beginTransaction(){},async commit(){},async rollback(){},release(){},async execute(sql){return sql.includes('SELECT')?[user?[user]:[]]:[{affectedRows:1}];}});
    const res=response();await requestPasswordSetup({body:{email:' new@example.test '}},res);assert.equal(res.statusCode,200);bodies.push(res.body);
  }
  assert(bodies.every(x=>JSON.stringify(x)===JSON.stringify(bodies[0])));
});

test('pending accounts cannot receive login or refresh sessions',async()=>{
  db.execute=async(sql)=>{assert(sql.includes('FROM users'));return[[{...setupUser,user_uuid:'new-user'}]];};
  const logged=response();await login({body:{username:'new.user',password:'any-password'}},logged);assert.equal(logged.statusCode,401);
  const refreshToken=signRefreshToken('new-user','refresh-id');
  db.execute=async(sql)=>sql.includes('FROM refresh_tokens')?[[{jti:'refresh-id',user_id:'new-user',token_hash:hashToken(refreshToken),expires_at:new Date(Date.now()+60_000)}]]:[[{...setupUser,user_uuid:'new-user'}]];
  const renewed=response();await refresh({cookies:{refresh_token:refreshToken}},renewed);assert.equal(renewed.statusCode,403);
});

test('setup-only tokens cannot pass the general API guard; only the dedicated setup guard accepts them',()=>{
  const restricted=signPasswordSetupToken('user','setup-id');
  const req={headers:{authorization:'Bearer '+restricted}};
  const denied=response();verifyUser(req,denied,()=>assert.fail('must not authorize API'));assert.equal(denied.statusCode,403);
  let allowed=false;verifyPasswordSetupSession(req,response(),()=>{allowed=true;});assert(allowed);assert.equal(req.verifiedUser.setup_jti,'setup-id');
  const normal={headers:{authorization:'Bearer '+signAccessToken({id:'user',role:'student'})}};
  const rejected=response();verifyPasswordSetupSession(normal,rejected,()=>assert.fail('normal access is not a setup credential'));assert.equal(rejected.statusCode,401);
  const socket=response();createSocketTicket({headers:{authorization:'Bearer '+restricted},verifiedUser:{id:'user'}},socket);assert.equal(socket.statusCode,403);
});

test('legacy temporary credentials are exchanged for a setup-only token without creating a refresh session',async()=>{
  const temporary=signTempPassword('user','old-id');
  db.execute=async(sql)=>{
    if(sql.includes('FROM users'))return[[{user_uuid:'user',username:'legacy.user',role:'employer',status:'active',temp_password_jti:'old-id',failed_login_attempts:0}]];
    assert(!sql.includes('INSERT INTO refresh_tokens'));return[{affectedRows:1}];
  };
  const res=response();await login({body:{username:'legacy.user',password:temporary},get(){return'';}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.refreshToken,null);assert.equal(res.body.mustChangePassword,true);
  const denied=response();verifyUser({headers:{authorization:'Bearer '+res.body.accessToken}},denied,()=>assert.fail('setup bypass'));assert.equal(denied.statusCode,403);
});

test('EmailJS transport sends a trusted HTTPS setup link with backend credentials and rejects provider failure',async()=>{
  Object.assign(process.env,{EMAILJS_SERVICE_ID:'test-service',EMAILJS_TEMPLATE_ID:'test-template',EMAILJS_PUBLIC_KEY:'test-public',EMAILJS_PRIVATE_KEY:'test-private',CLIENT_URL:'https://frontend.example.test'});
  let payload;
  global.fetch=async(url,options)=>{assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');payload=JSON.parse(options.body);assert(options.signal);return new Response('OK');};
  await sendAccountSetupEmail({to:'user@example.test',username:'user',token,invitation:true});
  assert.equal(payload.accessToken,'test-private');assert.equal(payload.template_params.to_email,'user@example.test');
  assert.equal(new URL(payload.template_params.setup_url).origin,'https://frontend.example.test');assert.equal(new URL(payload.template_params.setup_url).searchParams.get('token'),token);
  global.fetch=async()=>new Response('provider error',{status:429});
  await assert.rejects(sendAccountSetupEmail({to:'user@example.test',username:'user',token,invitation:false}),error => {
    assert.match(error.message,/EMAIL_DELIVERY_UNCONFIRMED/);
    assert.equal(error.code,'EMAIL_PROVIDER_REJECTED');assert.equal(error.httpStatus,429);return true;
  });
});

test('recovery logs safe provider/schema diagnostics while keeping its public response generic',async()=>{
  Object.assign(process.env,{EMAILJS_SERVICE_ID:'test-service',EMAILJS_TEMPLATE_ID:'test-template',EMAILJS_PUBLIC_KEY:'test-public',EMAILJS_PRIVATE_KEY:'SENSITIVE-private-key',CLIENT_URL:'https://frontend.example.test'});
  const logged=[], originalError=console.error;
  console.error=(...args)=>logged.push(args);
  try {
    db.getConnection=async()=>({async beginTransaction(){},async commit(){},async rollback(){},release(){},async execute(sql){return sql.includes('SELECT')?[[{...setupUser,password_setup_required:0}]]:[{affectedRows:1}];}});
    global.fetch=async()=>new Response(`new@example.test SENSITIVE-private-key ${token}`,{status:403});
    const delivery=response();await requestPasswordSetup({body:{email:'new@example.test'}},delivery);
    assert.equal(delivery.statusCode,200);assert.match(delivery.body.message,/If that email is registered/);
    assert.equal(logged[0][1].code,'EMAIL_PROVIDER_REJECTED');assert.match(logged[0][1].message,/HTTP 403/);assert.match(logged[0][1].message,/non-browser/);

    db.getConnection=async()=>{throw Object.assign(new Error('SQL includes new@example.test SENSITIVE-private-key '+token),{code:'ER_BAD_FIELD_ERROR',sql:'private query'});};
    const schema=response();await requestPasswordSetup({body:{email:'new@example.test'}},schema);
    assert.deepEqual(schema.body,delivery.body);assert.equal(logged[1][1].code,'ER_BAD_FIELD_ERROR');assert.match(logged[1][1].message,/migration/);
    const diagnostics=logged.map(args=>args.map(value=>value instanceof Error ? `${value.code} ${value.stack} ${JSON.stringify(value)}` : value).join(' ')).join(' ');
    for(const secret of ['new@example.test','SENSITIVE-private-key',token,'private query']) assert(!diagnostics.includes(secret));
    assert(!('cause' in logged[1][1]));assert(!('sql' in logged[1][1]));
  } finally {console.error=originalError;}
});

test('EmailJS transport discards network exception details and normalizes invalid CLIENT_URL',async()=>{
  Object.assign(process.env,{EMAILJS_SERVICE_ID:'test-service',EMAILJS_TEMPLATE_ID:'test-template',EMAILJS_PUBLIC_KEY:'test-public',EMAILJS_PRIVATE_KEY:'test-private',CLIENT_URL:'not-a-url'});
  global.fetch=async()=>assert.fail('invalid configuration must not send');
  await assert.rejects(sendAccountSetupEmail({to:'user@example.test',username:'user',token,invitation:false}),{code:'EMAIL_CONFIGURATION_REQUIRED'});
  process.env.CLIENT_URL='https://frontend.example.test';
  global.fetch=async()=>{throw new Error('SENSITIVE-provider-detail '+token);};
  await assert.rejects(sendAccountSetupEmail({to:'user@example.test',username:'user',token,invitation:false}),error=>{
    assert.equal(error.code,'EMAIL_NETWORK_ERROR');assert(!error.stack.includes('SENSITIVE-provider-detail'));assert(!error.stack.includes(token));assert(!('cause' in error));return true;
  });
});
