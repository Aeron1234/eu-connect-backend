import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDuty, currentDuty, clockAccess, validDate } from '../features/dtr/dutyScheduleModel.js';
import { db } from '../config/db.js';
import { dutyRead, dutyWrite } from '../features/dtr/controllers/dutyScheduleController.js';
import { requireScheduledClockIn } from '../features/dtr/dutyScheduleService.js';
const schedule = (overrides = {}) => ({ id: 1, source: 'student', working_days: '[1,2,3,4,5]', clock_in_time: '08:00', clock_out_time: '17:00', effective_from: '2026-11-09', effective_until: null, ...overrides });
test('clock-in requires a schedule and opens exactly 30 minutes early', () => {
    assert.equal(clockAccess(null, '2026-11-11 08:00:00').open, false);
    const duty = resolveDuty([schedule()], '2026-11-11');
    assert.equal(clockAccess(duty, '2026-11-11 07:29:59').open, false);
    assert.equal(clockAccess(duty, '2026-11-11 07:30:00').open, true);
    assert.equal(clockAccess(duty, '2026-11-11 16:59:59').open, true);
    assert.equal(clockAccess(duty, '2026-11-11 17:00:00').open, false);
});
test('employer rest days take priority; expired employer coverage falls back to student', () => {
    const schedules = [schedule(), schedule({ id: 2, source: 'employer', working_days: '[1]' })];
    assert.equal(resolveDuty(schedules, '2026-11-11').isDuty, false);
    schedules[1].effective_until = '2026-11-10';
    assert.equal(resolveDuty(schedules, '2026-11-11').source, 'student');
});
test('night shifts belong to the start date, including after midnight and rest-day mornings', () => {
    const schedules = [schedule({ working_days: '[5]', clock_in_time: '22:00', clock_out_time: '06:00' })];
    const shift = currentDuty(schedules, '2026-11-14 02:00:00');
    assert.equal(shift.shift_date, '2026-11-13');
    assert.equal(shift.expectedOut, '2026-11-14 06:00:00');
    assert.equal(clockAccess(shift, '2026-11-14 02:00:00').open, true);
    assert.equal(clockAccess(currentDuty(schedules, '2026-11-14 06:00:00'), '2026-11-14 06:00:00').open, false);
});
test('midnight shifts open on preceding date and future edits preserve historical dates', () => {
    const s = schedule({ working_days: '[6]', clock_in_time: '00:10', clock_out_time: '08:10' });
    assert.equal(currentDuty([s], '2026-11-13 23:45:00').shift_date, '2026-11-14');
    const newer = schedule({ id: 2, effective_from: '2026-11-12', clock_in_time: '09:00' });
    assert.equal(resolveDuty([s, newer], '2026-11-11').clock_in_time, '00:10');
    assert.equal(resolveDuty([s, newer], '2026-11-12').clock_in_time, '09:00');
    assert.equal(resolveDuty([s], '2026-11-08'), null);
    assert.equal(validDate('2026-02-30'), false);
});
const res = () => ({ code: 200, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
async function mockRead(role, head) { const old = db.getConnection; const sql = []; db.getConnection = async () => ({ async execute(q) { sql.push(q); if (q.includes('FROM dept_heads_background_info'))
        return [[head].filter(Boolean)]; if (q.includes('COUNT(*)'))
        return [[{ total: 0 }]]; return [[]]; }, release() { }, async rollback() { } }); const response = res(); try {
    await dutyRead({ verifiedUser: { id: 'viewer', role }, query: {} }, response);
    return { response, sql };
}
finally {
    db.getConnection = old;
} }
test('Registrar, admin and employer cannot read private absence lists', async () => {
    for (const [role, head] of [['department_head', { department_id: 1, code: 'REG' }], ['admin', null], ['employer', null]]) {
        const { response, sql } = await mockRead(role, head);
        assert.equal(response.code, 403);
        assert(!sql.some(q => q.includes('FROM dtr_absence_reports')));
    }
});
test('regular department heads always scope absence and schedule queries to latest student department', async () => {
    const { response, sql } = await mockRead('department_head', { department_id: 2, code: 'CCS' });
    assert.equal(response.code, 200);
    assert(sql.filter(q => q.includes('FROM dtr_absence_reports')).every(q => q.includes('a.department_id=?') && q.includes('MAX(x.id)')));
});
test('an absence or existing attendance blocks server-side clock-in', async () => {
    for (const present of [true, false]) {
        const c = { async execute(q) { if (q.includes('FROM dtr_weekly_schedules'))
                return [[schedule()]]; if (q.includes('COUNT(*)'))
                return [[{ total: present ? 1 : 0 }]]; if (q.includes('dtr_absence_reports'))
                return [[{ id: 3 }]]; throw new Error('Unexpected query'); } };
        await assert.rejects(() => requireScheduledClockIn(c, 'ir', '2026-11-11 08:00:00'), e => e.status === 409);
    }
});
test('student cannot rewrite a schedule effective today after initial setup', async () => {
    const old = db.getConnection;
    let rollback = false;
    db.getConnection = async () => ({ async beginTransaction() { }, async rollback() { rollback = true; }, release() { }, async execute(q) { if (q.includes('FROM users'))
            return [[{ id: 'student' }]]; if (q.startsWith('SELECT id,user_id,company_name'))
            return [[{ id: 'ir', user_id: 'student' }]]; if (q.includes('AS now'))
            return [[{ now: '2026-11-11 08:00:00' }]]; if (q.includes('FROM dtr_weekly_schedules'))
            return [[schedule()]]; throw new Error('No write expected'); } });
    try {
        const response = res();
        await dutyWrite({ verifiedUser: { id: 'student', role: 'student' }, body: { action: 'schedule', workingDays: [1, 2], clockInTime: '08:00', clockOutTime: '17:00', effectiveFrom: '2026-11-11' } }, response);
        assert.equal(response.code, 400);
        assert(rollback);
    }
    finally {
        db.getConnection = old;
    }
});

test('head corrections credit verified work once, preserve timing labels, and reject repeat credit', async()=>{
 const original=db.getConnection,oldCap=process.env.MAX_SHIFT_HOURS;process.env.MAX_SHIFT_HOURS='8';
 let corrected=false,credits=0,commits=0;
 db.getConnection=async()=>({async beginTransaction(){},async commit(){commits++;},async rollback(){},release(){},async execute(sql,params){
  if(sql.startsWith('SELECT id FROM users'))return [[{id:'student'}]];
  if(sql.includes('FROM dept_heads_background_info'))return [[{department_id:2,code:'CCS'}]];
  if(sql.includes('SELECT r.*')){assert(sql.includes('a.department_id=?'));assert.equal(params.at(-1),2);return [[{id:1,student_id:'student',internship_id:'ir',shift_date:'2026-11-11',expected_in:'2026-11-11 08:00:00',expected_out:'2026-11-11 17:00:00',review_status:corrected?'corrected':'pending'}]];}
  if(sql.includes('AS now'))return [[{now:'2026-11-11 17:00:00'}]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:0}]];
  if(sql.startsWith('INSERT INTO daily_time_records')){assert.deepEqual(params.slice(-3),[1,1,0]);assert(sql.includes('no camera or GPS verification'));return [{affectedRows:1,insertId:99}];}
  if(sql.startsWith('UPDATE internship_records')){credits+=params[0];return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE dtr_absence_reports')){corrected=true;return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO notifications')||sql.startsWith('INSERT INTO activity_logs'))return [{affectedRows:1}];
  throw new Error('Unexpected query '+sql);
 }});
 const req={verifiedUser:{id:'head',role:'department_head'},body:{action:'review',id:1,studentId:'student',category:'worked',reviewNote:'Verified actual work and break time.',actualIn:'2026-11-11T09:00',actualOut:'2026-11-11T16:00',hours:'7'}};
 try{const first=res();await dutyWrite(req,first);assert.equal(first.code,200);assert.equal(credits,7);assert.equal(commits,1);const second=res();await dutyWrite(req,second);assert.equal(second.code,409);assert.equal(credits,7);assert.equal(commits,1);}finally{db.getConnection=original;if(oldCap===undefined)delete process.env.MAX_SHIFT_HOURS;else process.env.MAX_SHIFT_HOURS=oldCap;}
});
test('a head cannot review a report outside their current department', async()=>{
 const original=db.getConnection;let wrote=false;
 db.getConnection=async()=>({async beginTransaction(){},async rollback(){},release(){},async execute(sql){
 if(sql.startsWith('SELECT id FROM users'))return [[{id:'other-student'}]];
 if(sql.includes('FROM dept_heads_background_info'))return [[{department_id:2,code:'CCS'}]];
 if(sql.includes('SELECT r.*'))return [[]];
 wrote=true;throw new Error('Unauthorized write');
 }});
 try{const response=res();await dutyWrite({verifiedUser:{id:'head',role:'department_head'},body:{id:3,studentId:'other-student',action:'review'}},response);assert.equal(response.code,404);assert.equal(wrote,false);}finally{db.getConnection=original;}
});
