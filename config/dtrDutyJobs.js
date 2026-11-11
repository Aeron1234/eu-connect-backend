import { db } from './db.js';
import { databaseNow, readSchedules, attendanceExists, resolveDuty, notifyHeads } from '../features/dtr/dutyScheduleService.js';
import { addDays } from '../features/dtr/dutyScheduleModel.js';
import { sendEmailJsTemplate } from '../services/accountSetupMail.js';
import { invalidateAllResponseCache } from './cache/cache.js';
import { reportBackgroundError } from './errorTracking.js';
// Scan only scheduled days from the previous week through today. The migration
// and immutable effective dates prevent backfilling pre-feature absences.
export async function detectDtrAbsences(io) {
    const c = await db.getConnection();
    let locked = false;
    try {
        const [[lock]] = await c.execute("SELECT GET_LOCK('eu_connect_absence_scan',0) AS acquired");
        locked = Number(lock.acquired) === 1;
        if (!locked)
            return;
        const now = await databaseNow(c), today = now.slice(0, 10);
        const [internships] = await c.execute("SELECT ir.id,ir.user_id,ir.company_name,DATE_FORMAT(ir.date_started,'%Y-%m-%d') AS date_started FROM internship_records ir JOIN users u ON u.id=ir.user_id AND u.deleted_at IS NULL WHERE ir.status='ongoing' AND ir.deleted_at IS NULL AND ir.date_started<=CURDATE()");
        for (const ir of internships)
            for (let offset = 7; offset >= 0; offset--) {
                const date = addDays(today, -offset);
                if (date < ir.date_started)
                    continue;
                try {
                    await c.beginTransaction();
                    await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [ir.user_id]);
                    const [[active]] = await c.execute("SELECT id FROM internship_records WHERE id=? AND status='ongoing' AND deleted_at IS NULL FOR UPDATE", [ir.id]);
                    if (!active) {
                        await c.rollback();
                        continue;
                    }
                    const duty = resolveDuty(await readSchedules(c, ir.id), date);
                    if (!duty?.isDuty || duty.expectedOut > now || await attendanceExists(c, ir.id, date)) {
                        await c.rollback();
                        continue;
                    }
                    const [result] = await c.execute(`INSERT IGNORE INTO dtr_absence_reports (internship_id,student_id,shift_date,expected_in,expected_out) VALUES (?,?,?,?,?)`, [ir.id, ir.user_id, date, duty.expectedIn, duty.expectedOut]);
                    const notices = result.affectedRows ? await notifyHeads(c, ir.user_id, 'No attendance recorded', `No clock-in was recorded at ${ir.company_name} for the shift starting ${date}. The student must provide an explanation.`, ir.user_id) : [];
                    await c.commit();
                    if (result.affectedRows)
                        invalidateAllResponseCache();
                    for (const n of notices)
                        io?.to(`user-${n.user_id}`).emit('new_notification', n);
                }
                catch (error) {
                    await c.rollback().catch(() => { });
                    reportBackgroundError('absenceDetection', error);
                }
            }
    }
    finally {
        try {
            if (locked)
                await c.execute("SELECT RELEASE_LOCK('eu_connect_absence_scan')");
        }
        finally {
            c.release();
        }
    }
}
// Sunday catch-up runs repeatedly but each student/week is claimed once. Unknown
// delivery failures are retained for inspection rather than duplicated blindly.
export async function sendSundayScheduleReminders() {
    if (!process.env.EMAILJS_DTR_TEMPLATE_ID) {
        console.warn('DTR reminders need EMAILJS_DTR_TEMPLATE_ID.');
        return;
    }
    const c = await db.getConnection();
    let locked = false;
    try {
        const [[lock]] = await c.execute("SELECT GET_LOCK('eu_connect_schedule_mail',0) AS acquired");
        locked = Number(lock.acquired) === 1;
        if (!locked)
            return;
        const now = await databaseNow(c), today = now.slice(0, 10);
        if (new Date(today + 'T00:00:00Z').getUTCDay() !== 0)
            return;
        const [students] = await c.execute(`SELECT DISTINCT u.id,u.email,u.username FROM users u JOIN internship_records ir ON ir.user_id=u.id WHERE ir.status='ongoing' AND ir.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status='active' AND u.email IS NOT NULL AND u.email<>''`);
        const url = new URL('/student', process.env.CLIENT_URL);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
            throw new Error('Invalid reminder CLIENT_URL');
        for (const student of students) {
            const [claim] = await c.execute("INSERT IGNORE INTO dtr_schedule_reminders (student_id,week_date,state) VALUES (?,?,'sending')", [student.id, today]);
            if (!claim.affectedRows)
                continue;
            try {
                await sendEmailJsTemplate(process.env.EMAILJS_DTR_TEMPLATE_ID, { to_email: student.email, username: student.username, subject: 'Review your internship duty schedule', week_start: addDays(today, 1), dashboard_url: url.toString(), message: 'Please set or review your working days and duty hours for the coming week. The supervisor schedule takes priority. An applicable schedule is required before clock-in.' });
                await c.execute("UPDATE dtr_schedule_reminders SET state='sent',updated_at=NOW() WHERE student_id=? AND week_date=?", [student.id, today]);
            }
            catch (error) {
                await c.execute("UPDATE dtr_schedule_reminders SET state='failed',updated_at=NOW() WHERE student_id=? AND week_date=?", [student.id, today]);
                reportBackgroundError('scheduleReminder', error);
            }
        }
    }
    finally {
        try {
            if (locked)
                await c.execute("SELECT RELEASE_LOCK('eu_connect_schedule_mail')");
        }
        finally {
            c.release();
        }
    }
}
