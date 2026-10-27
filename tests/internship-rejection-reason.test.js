import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/db.js';
import cache from '../config/cache/cache.js';
import { approveInternshipRecord, restoreInternshipRecord, getAllUserInternships } from '../features/internship-records/controllers/internshipRecordControllers.js';
const original = { getConnection: db.getConnection, execute: db.execute };
after(async () => { Object.assign(db, original); cache.close(); await db.end(); });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function setup({ status = 'pending', department = 1 } = {}) {
  const calls = [], events = [];
  db.execute = async (sql, values) => { calls.push({sql,values}); return [[{id:'record',status:'rejected',rejection_reason:'Correct the dates.'}]]; };
  db.getConnection = async () => ({
    async beginTransaction(){}, async rollback(){events.push('rollback');}, async commit(){events.push('commit');}, release(){},
    async execute(sql,values){
      calls.push({sql,values});
      if(sql.includes('FROM user_profiles')) return [[{first_name:'Department',last_name:'Head'}]];
      if(sql.includes('FROM dept_heads_background_info')) return [[{department_id:department}]];
      if(sql.includes('FROM internship_records')) return [[{user_id:'student',company_name:'Company',status,department_id:1}]];
      return [{affectedRows:1}];
    }
  });
  const req = {verifiedUser:{id:'head',role:'department_head',department_id:1},params:{internshipId:'record'},body:{status:'rejected',rejection_reason:'  Correct the dates.  '},app:{get:()=>({to:()=>({emit:(name,data)=>events.push(data)})})}};
  return {calls,events,req};
}
test('rejection requires a nonblank bounded reason without saving',async()=>{
  for(const reason of [undefined,'   ',42,'x'.repeat(1001)]) {
    const {req,calls}=setup();req.body.rejection_reason=reason;const res=response();await approveInternshipRecord(req,res);
    assert.equal(res.code,400);assert.equal(calls.length,0);
  }
});
test('saved rejection reason is the notification and websocket message after commit',async()=>{
  const {req,calls,events}=setup();const res=response();await approveInternshipRecord(req,res);assert.equal(res.code,200);
  const write=calls.find(c=>c.sql.includes('SET updated_at = NOW(), status'));
  assert.deepEqual(write.values,['rejected','Correct the dates.','record']);
  assert.equal(calls.find(c=>c.sql.includes('INSERT INTO notifications')).values[3],'Correct the dates.');
  assert.equal(events[0],'commit');assert.equal(events[1].message,'Correct the dates.');
});
test('other departments and already processed records cannot reject',async()=>{
  for(const [options,code] of [[{department:2},403],[{status:'ongoing'},400]]) {
    const {req,calls}=setup(options);const res=response();await approveInternshipRecord(req,res);assert.equal(res.code,code);
    assert.ok(!calls.some(c=>c.sql.startsWith('UPDATE internship_records')));
  }
});
test('approval remains reason-free and clears any prior reason',async()=>{
  const {req,calls}=setup();req.body={status:'ongoing'};const res=response();await approveInternshipRecord(req,res);assert.equal(res.code,200);
  assert.deepEqual(calls.find(c=>c.sql.includes('SET updated_at = NOW(), status')).values,['ongoing',null,'record']);
});
test('restore clears the saved reason and student list selects it',async()=>{
  const {req,calls}=setup({status:'rejected'});const res=response();await restoreInternshipRecord(req,res);assert.equal(res.code,200);
  assert.ok(calls.some(c=>c.sql.includes("rejection_reason = NULL")));
  req.verifiedUser={id:'student',role:'student'};const student=response();await getAllUserInternships(req,student);
  assert.equal(student.body[0].rejection_reason,'Correct the dates.');assert.ok(calls.some(c=>c.sql.includes('SELECT ir.id, ir.rejection_reason')));
});
