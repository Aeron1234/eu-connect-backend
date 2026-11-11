import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/db.js';
import { detectDtrAbsences, sendSundayScheduleReminders } from '../config/dtrDutyJobs.js';
import { notifyHeads } from '../features/dtr/dutyScheduleService.js';
test('head notifications resolve latest department, exclude Registrar and never target employers', async () => {
    const writes = [];
    const c = { async execute(sql, params) { if (sql.includes('SELECT DISTINCT h.user_id')) {
            assert(sql.includes("d.code<>'REG'"));
            assert(sql.includes('MAX(x.id)'));
            return [[{ user_id: 'head' }]];
        } if (sql.startsWith('SELECT CONCAT_WS'))
            return [[{ name: 'Ana Cruz' }]]; writes.push({ sql, params }); return [{ affectedRows: 1 }]; } };
    const notices = await notifyHeads(c, 'student', 'Explanation submitted', 'Review it', 'student');
    assert.equal(notices.length, 1);
    assert.equal(notices[0].user_id, 'head');
    assert.match(notices[0].title, /Ana Cruz/);
    assert.equal(writes[0].params[0], 'head');
});
test('absence cron waits until shift end, skips rest days and creates one report/notification across repeated runs', async () => {
    const original = db.getConnection;
    let inserted = false, created = 0, notified = 0;
    const c = { async beginTransaction() { }, async commit() { }, async rollback() { }, release() { }, async execute(sql) {
            if (sql.includes('GET_LOCK'))
                return [[{ acquired: 1 }]];
            if (sql.includes('RELEASE_LOCK'))
                return [[{ released: 1 }]];
            if (sql.includes('AS now'))
                return [[{ now: '2026-11-11 17:01:00' }]];
            if (sql.includes('SELECT ir.id,ir.user_id'))
                return [[{ id: 'ir', user_id: 'student', company_name: 'Company', date_started: '2026-11-11' }]];
            if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT id FROM internship_records'))
                return [[{ id: 'ir' }]];
            if (sql.includes('FROM dtr_weekly_schedules'))
                return [[{ id: 1, source: 'student', working_days: '[3]', clock_in_time: '08:00', clock_out_time: '17:00', effective_from: '2026-11-11' }]];
            if (sql.includes('COUNT(*) AS total'))
                return [[{ total: 0 }]];
            if (sql.startsWith('INSERT IGNORE')) {
                if (inserted)
                    return [{ affectedRows: 0 }];
                inserted = true;
                created++;
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('SELECT DISTINCT h.user_id'))
                return [[{ user_id: 'head' }]];
            if (sql.startsWith('SELECT CONCAT_WS'))
                return [[{ name: 'Student' }]];
            if (sql.startsWith('INSERT INTO notifications')) {
                notified++;
                return [{ affectedRows: 1 }];
            }
            throw new Error('Unexpected SQL ' + sql);
        } };
    db.getConnection = async () => c;
    try {
        await detectDtrAbsences();
        await detectDtrAbsences();
        assert.equal(created, 1);
        assert.equal(notified, 1);
    }
    finally {
        db.getConnection = original;
    }
});
test('Sunday EmailJS reminders use the reminder template and deliver once per student/week', async () => {
    const original = db.getConnection, fetchOriginal = globalThis.fetch;
    const names = ['EMAILJS_DTR_TEMPLATE_ID', 'EMAILJS_SERVICE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'CLIENT_URL'];
    const old = Object.fromEntries(names.map(n => [n, process.env[n]]));
    let claimed = false, sends = 0, marked = false;
    for (const n of names)
        process.env[n] = 'test-value';
    process.env.CLIENT_URL = 'https://example.test';
    globalThis.fetch = async (url, options) => { sends++; assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send'); const body = JSON.parse(options.body); assert.equal(body.template_id, 'test-value'); assert.equal(body.template_params.dashboard_url, 'https://example.test/student'); assert.equal(body.template_params.week_start, '2026-11-16'); assert.equal(body.template_params.setup_url, undefined); return { ok: true }; };
    db.getConnection = async () => ({ release() { }, async execute(sql) {
            if (sql.includes('GET_LOCK'))
                return [[{ acquired: 1 }]];
            if (sql.includes('RELEASE_LOCK'))
                return [[{ released: 1 }]];
            if (sql.includes('AS now'))
                return [[{ now: '2026-11-15 09:00:00' }]];
            if (sql.includes('SELECT DISTINCT u.id'))
                return [[{ id: 'student', email: 'test@example.test', username: 'student' }]];
            if (sql.startsWith('INSERT IGNORE')) {
                if (claimed)
                    return [{ affectedRows: 0 }];
                claimed = true;
                return [{ affectedRows: 1 }];
            }
            if (sql.includes("SET state='sent'")) {
                marked = true;
                return [{ affectedRows: 1 }];
            }
            throw new Error('Unexpected SQL ' + sql);
        } });
    try {
        await sendSundayScheduleReminders();
        await sendSundayScheduleReminders();
        assert.equal(sends, 1);
        assert(marked);
    }
    finally {
        globalThis.fetch = fetchOriginal;
        db.getConnection = original;
        for (const n of names) {
            if (old[n] === undefined)
                delete process.env[n];
            else
                process.env[n] = old[n];
        }
    }
});
