import {clockOutTiming} from '../shiftTiming.js';
import { getMaxShiftHours } from '../../../config/shiftLimits.js';
import { db } from '../../../config/db.js';
import { reportError } from '../../../config/errorTracking.js';
import { invalidateAllResponseCache } from '../../../config/cache/cache.js';
import { databaseNow, readSchedules, attendanceExists, notifyHeads, resolveDuty, currentDuty, clockAccess } from '../dutyScheduleService.js';
import { validDate, validTime, daysArray, addDays, wallEpoch } from '../dutyScheduleModel.js';
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
async function headDepartment(c, user) {
    if (user.role !== 'department_head')
        throw problem('Department-head access required.', 403);
    const [[head]] = await c.execute(`SELECT h.department_id,d.code FROM dept_heads_background_info h JOIN departments d ON d.id=h.department_id WHERE h.user_id=? LIMIT 1`, [user.id]);
    if (!head || head.code === 'REG')
        throw problem('This feature is available only to regular department heads.', 403);
    return head.department_id;
}
async function studentInternship(c, user, internshipId) {
    const [[row]] = await c.execute(`SELECT id,user_id,company_name,DATE_FORMAT(date_started,'%Y-%m-%d') AS date_started FROM internship_records WHERE user_id=? AND status='ongoing' AND deleted_at IS NULL ${internshipId ? 'AND id=?' : ''} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, internshipId ? [user.id, internshipId] : [user.id]);
    if (!row)
        throw problem('An ongoing internship is required.', 403);
    return row;
}
export async function dutyRead(req, res) {
    let c;
    try {
        c = await db.getConnection();
        res.set('Cache-Control', 'private, no-store');
        if (req.verifiedUser.role === 'student') {
            await c.beginTransaction();
            const internship = await studentInternship(c, req.verifiedUser);
            const now = await databaseNow(c);
            const schedules = await readSchedules(c, internship.id), duty = currentDuty(schedules, now);
            const [reports] = await c.execute(`SELECT *,DATE_FORMAT(shift_date,'%Y-%m-%d') AS shift_date FROM dtr_absence_reports WHERE student_id=? ORDER BY shift_date DESC LIMIT 100`, [req.verifiedUser.id]);
            const access = clockAccess(duty, now);
            const canReport = Boolean(duty?.isDuty && !await attendanceExists(c, internship.id, duty.shift_date) && !reports.some(r => r.internship_id === internship.id && r.shift_date === duty.shift_date));
            if (duty && ((await attendanceExists(c, internship.id, duty.shift_date)) || reports.some(r => r.internship_id === internship.id && r.shift_date === duty.shift_date && r.review_status !== 'corrected'))) {
                access.open = false;
                access.message = 'Attendance or an absence report already exists for this shift.';
            }
            await c.commit();
            return res.json({ internship, schedules, duty, access, reports, now, canReport });
        }
        const department = await headDepartment(c, req.verifiedUser);
        const page = Number(req.query.page || 1), limit = 10;
        if(!Number.isSafeInteger(page)||page<1||page>100000)throw problem('Invalid page.');
        const search = String(req.query.search || '').trim().slice(0, 100);
        const filter = req.query.section === 'schedules';
        const base = `FROM ${filter ? 'dtr_weekly_schedules r' : 'dtr_absence_reports r'} JOIN internship_records ir ON ir.id=r.internship_id AND ir.deleted_at IS NULL
 JOIN users u ON u.id=ir.user_id AND u.deleted_at IS NULL
 LEFT JOIN user_profiles p ON p.user_id=ir.user_id
 JOIN student_academic_info a ON a.id=(SELECT MAX(x.id) FROM student_academic_info x WHERE x.user_id=ir.user_id)
 WHERE a.department_id=? AND CONCAT_WS(' ',p.first_name,p.last_name) LIKE ?`;
        const params = [department, '%' + search + '%'];
        const [[{ total }]] = await c.execute('SELECT COUNT(*) AS total ' + base, params);
        const [rows] = await c.execute(`SELECT r.*,ir.company_name,ir.user_id AS student_id,CONCAT_WS(' ',p.first_name,p.last_name) AS student_name,
 ${filter ? "DATE_FORMAT(r.effective_from,'%Y-%m-%d') AS effective_from,DATE_FORMAT(r.effective_until,'%Y-%m-%d') AS effective_until" : "DATE_FORMAT(r.shift_date,'%Y-%m-%d') AS shift_date"} ${base} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
        return res.json({ rows, page, total: Number(total), totalPages: Math.max(1, Math.ceil(total / limit)) });
    }
    catch (error) {
        if (c)
            await c.rollback().catch(() => { });
        if (!error.status)
            reportError('DTR duty read failed:', error);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not load duty schedules.' });
    }
    finally {
        c?.release();
    }
}
function deliver(req, notices) {
    invalidateAllResponseCache();
    for (const n of notices)
        req.app?.get('socketio')?.to(`user-${n.user_id}`).emit('new_notification', n);
}
export async function dutyWrite(req, res) {
    let c, committed = false;
    const notices = [];
    try {
        c = await db.getConnection();
        await c.beginTransaction();
        const user = req.verifiedUser;
        // All schedule/report/clock-in writes serialize on the same student user row.
        const studentId = user.role === 'student' ? user.id : req.body?.studentId;
        if (!studentId)
            throw problem('Student is required.');
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [studentId]);
        if (user.role === 'student') {
            const ir = await studentInternship(c, user, req.body?.internshipId);
            const now = await databaseNow(c), today = now.slice(0, 10);
            if (req.body.action === 'schedule') {
                const { clockInTime, clockOutTime, effectiveFrom, effectiveUntil } = req.body;
                const days = req.body.workingDays;
                if (!validTime(clockInTime) || !validTime(clockOutTime) || clockInTime === clockOutTime || !validDate(effectiveFrom) || !Array.isArray(days) || !days.length || days.length > 7 || new Set(days).size !== days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || (effectiveUntil && (!validDate(effectiveUntil) || effectiveUntil < effectiveFrom)))
                    throw problem('Choose working days, different valid times and a valid date range.');
                const prior = await readSchedules(c, ir.id);
                const minimum = prior.some(s => s.source === 'student') ? addDays(today, 1) : today;
                if (effectiveFrom < minimum || effectiveFrom > addDays(today, 90))
                    throw problem(`Schedule changes must start on or after ${minimum}, within 90 days.`);
                await c.execute("UPDATE dtr_weekly_schedules SET effective_until=LEAST(COALESCE(effective_until,?),?) WHERE internship_id=? AND source='student' AND (effective_until IS NULL OR effective_until>=?)", [addDays(effectiveFrom, -1), addDays(effectiveFrom, -1), ir.id, effectiveFrom]);
                await c.execute(`INSERT INTO dtr_weekly_schedules (internship_id,source,clock_in_time,clock_out_time,working_days,effective_from,effective_until,created_by) VALUES (?,'student',?,?,?,?,?,?)`, [ir.id, clockInTime, clockOutTime, JSON.stringify(days), effectiveFrom, effectiveUntil || null, user.id]);
                notices.push(...await notifyHeads(c, user.id, 'Duty schedule submitted', `A student submitted a duty schedule for ${ir.company_name}, effective ${effectiveFrom}: ${clockInTime} to ${clockOutTime} (Philippine time). Review it in Attendance ? Duty schedules.`, user.id, 'dtr_duty_schedule'));
            }
            else if (req.body.action === 'absence') {
                const { date, category } = req.body, reason = String(req.body.reason || '').trim();
                if (!ir.date_started || !validDate(date) || date > addDays(today, 30) || date < ir.date_started || !['absent', 'leave', 'no_duty', 'worked'].includes(category) || reason.length < 5 || reason.length > 2000)
                    throw problem('Choose a shift date within the past 7 or next 30 days, a category, and a reason of 5-2000 characters.');
                const [[existing]] = await c.execute('SELECT id FROM dtr_absence_reports WHERE internship_id=? AND shift_date=? FOR UPDATE', [ir.id, date]);
                if (date < addDays(today, -7) && !existing)
                    throw problem('New past reports must be within seven days.');
                if (category === 'worked' && date > today)
                    throw problem('Future duty cannot be reported as already worked.');
                const duty = resolveDuty(await readSchedules(c, ir.id), date);
                if (!duty?.isDuty)
                    throw problem('No scheduled duty exists on this date.');
                if (await attendanceExists(c, ir.id, date))
                    throw problem('Attendance already exists for this shift.', 409);
                const [[old]] = await c.execute('SELECT id,review_status FROM dtr_absence_reports WHERE internship_id=? AND shift_date=? FOR UPDATE', [ir.id, date]);
                if (old && ['reviewed', 'corrected'].includes(old.review_status))
                    throw problem('Your department head has reviewed this report. Contact them for corrections.', 409);
                await c.execute(`INSERT INTO dtr_absence_reports (internship_id,student_id,shift_date,expected_in,expected_out,category,reason,reported_at,review_status)
 VALUES (?,?,?,?,?,?,?,?, 'pending') ON DUPLICATE KEY UPDATE category=VALUES(category),reason=VALUES(reason),reported_at=COALESCE(reported_at,VALUES(reported_at)),updated_at=NOW(),review_status='pending'`, [ir.id, user.id, date, duty.expectedIn, duty.expectedOut, category, reason, now]);
                notices.push(...await notifyHeads(c, user.id, 'Attendance explanation submitted', `A student submitted an attendance explanation for ${ir.company_name} on ${date}. Review the report in Attendance.`, user.id));
            }
            else
                throw problem('Unknown action.');
        }
        else {
            const department = await headDepartment(c, user);
            const [[row]] = await c.execute(`SELECT r.*,DATE_FORMAT(r.shift_date,'%Y-%m-%d') AS shift_date,DATE_FORMAT(r.expected_in,'%Y-%m-%d %H:%i:%s') AS expected_in,DATE_FORMAT(r.expected_out,'%Y-%m-%d %H:%i:%s') AS expected_out FROM dtr_absence_reports r
 JOIN internship_records ir ON ir.id=r.internship_id AND ir.deleted_at IS NULL
 JOIN student_academic_info a ON a.id=(SELECT MAX(x.id) FROM student_academic_info x WHERE x.user_id=ir.user_id)
 WHERE r.id=? AND r.student_id=? AND a.department_id=? FOR UPDATE`, [req.body.id, studentId, department]);
            if (!row)
                throw problem('Report not found in your department.', 404);
            const note = String(req.body.reviewNote || '').trim(), category = req.body.category;
            if (!['absent', 'leave', 'no_duty', 'worked'].includes(category) || note.length < 5 || note.length > 2000)
                throw problem('Choose a classification and enter a review note of 5-2000 characters.');
            if (row.review_status === 'corrected')
                throw problem('This report has already been corrected.', 409);
            let correction = null;
            if (category === 'worked') {
                const start = req.body.actualIn, end = req.body.actualOut, hours = Number(req.body.hours);
                const now = await databaseNow(c);
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end || '') || !validTime(start.slice(11)) || !validTime(end.slice(11)) || !validDate(start.slice(0, 10)) || !validDate(end.slice(0, 10)) || start.slice(0, 10) !== row.shift_date || end.replace('T', ' ') + ':00' > now || req.body.hours === '' || req.body.hours == null || !Number.isFinite(hours) || hours < 0 || hours > getMaxShiftHours() || wallEpoch(end.replace('T', ' ') + ':00') <= wallEpoch(start.replace('T', ' ') + ':00') || (wallEpoch(end.replace('T', ' ') + ':00') - wallEpoch(start.replace('T', ' ') + ':00')) > 16 * 3600000 || hours > (wallEpoch(end.replace('T', ' ') + ':00') - wallEpoch(start.replace('T', ' ') + ':00')) / 3600000)
                    throw problem('Provide valid actual times and verified net hours (within the daily credit cap, no more than elapsed time).');
                if (await attendanceExists(c, row.internship_id, row.shift_date))
                    throw problem('Attendance already exists for this shift.', 409);
                const actualIn=start.replace('T',' ')+':00',actualOut=end.replace('T',' ')+':00';
                const timing=clockOutTiming(actualOut,row.expected_out,hours);
                const late=wallEpoch(actualIn)>=wallEpoch(row.expected_in)+10*60000;
                const [insert] = await c.execute(`INSERT INTO daily_time_records (internship_id,user_id,clock_in,clock_out,total_hours,status,flagged,flag_reason,expected_clock_in,expected_clock_out,is_late,is_undertime,is_overtime)
 VALUES (?,?,?,?,?,'present',1,'Department-head attendance correction; no camera or GPS verification',?,?,?,?,?)`, [row.internship_id, studentId, start.replace('T', ' ') + ':00', end.replace('T', ' ') + ':00', hours, row.expected_in, row.expected_out,Number(late),Number(timing.undertime),Number(timing.overtime)]);
                correction = insert.insertId;
                await c.execute('UPDATE internship_records SET accumulated_hours=COALESCE(accumulated_hours,0)+? WHERE id=?', [hours, row.internship_id]);
            }
            await c.execute("UPDATE dtr_absence_reports SET category=?,review_note=?,review_status=?,reviewed_by=?,reviewed_at=NOW(),correction_dtr_id=? WHERE id=?", [category, note, correction ? 'corrected' : 'reviewed', user.id, correction, row.id]);
            const notice = { user_id: studentId, sender_id: user.id, type: 'dtr_absence', title: 'Attendance explanation reviewed', message: `Your department head reviewed your attendance report for ${row.shift_date}. Open your dashboard for the result.`, link: '/student' };
            await c.execute('INSERT INTO notifications (user_id,sender_id,type,title,message,link) VALUES (?,?,?,?,?,?)', Object.values(notice));
            notices.push(notice);
        }
        await c.execute('INSERT INTO activity_logs (actor_id,actor_role,action,target_type,target_id,description) VALUES (?,?,?,?,?,?)', [user.id, user.role, user.role === 'student' ? (req.body.action === 'schedule' ? 'duty_schedule_submitted' : 'absence_reason_submitted') : 'absence_reviewed', 'dtr_duty', studentId, user.role === 'student' ? 'Student submitted a duty schedule or attendance explanation.' : 'Department head reviewed an attendance explanation.']);
        await c.commit();
        committed = true;
        try {
            deliver(req, notices);
        }
        catch (error) {
            reportError('Committed duty notice delivery failed:', error);
        }
        return res.json({ success: true, message: 'Saved successfully.' });
    }
    catch (error) {
        if (c && !committed)
            await c.rollback().catch(() => { });
        if (!error.status)
            reportError('Duty write failed:', error);
        res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Could not confirm the save. Refresh before retrying.' });
    }
    finally {
        c?.release();
    }
}
