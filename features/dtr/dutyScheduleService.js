import { resolveDuty, currentDuty, clockAccess, addDays } from './dutyScheduleModel.js';
export async function databaseNow(c) {
    const [[row]] = await c.execute("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");
    return row.now;
}
export async function readSchedules(c, internshipId) {
    const [rows] = await c.execute(`SELECT id,source,TIME_FORMAT(clock_in_time,'%H:%i') AS clock_in_time,
 TIME_FORMAT(clock_out_time,'%H:%i') AS clock_out_time,working_days,
 DATE_FORMAT(effective_from,'%Y-%m-%d') AS effective_from,
 DATE_FORMAT(effective_until,'%Y-%m-%d') AS effective_until FROM dtr_weekly_schedules WHERE internship_id=? AND (source='student' OR created_by=(SELECT employer_id FROM internship_records WHERE id=dtr_weekly_schedules.internship_id)) ORDER BY id DESC`, [internshipId]);
    return rows;
}
export async function attendanceExists(c, internshipId, date) {
    const [[row]] = await c.execute(`SELECT COUNT(*) AS total FROM daily_time_records d JOIN internship_records ir ON ir.id=? AND ir.user_id=d.user_id
 WHERE DATE(COALESCE(d.expected_clock_in,d.clock_in))=? AND d.clock_in IS NOT NULL`, [internshipId, date]);
    return Number(row.total) > 0;
}
export async function requireScheduledClockIn(c, internshipId, now) {
    const duty = currentDuty(await readSchedules(c, internshipId), now);
    const access = clockAccess(duty, now);
    if (!access.open)
        throw Object.assign(new Error(access.message), { status: 409 });
    if (await attendanceExists(c, internshipId, duty.shift_date))
        throw Object.assign(new Error('Attendance already exists for this shift.'), { status: 409 });
    const [[absence]] = await c.execute("SELECT id FROM dtr_absence_reports WHERE internship_id=? AND shift_date=? AND review_status<>'corrected' LIMIT 1", [internshipId, duty.shift_date]);
    if (absence)
        throw Object.assign(new Error('An absence report exists for this shift. Ask your department head to correct it if you worked.'), { status: 409 });
    return { ...duty, late: now >= addMinutes(duty.expectedIn, 10) };
}
function addMinutes(value, minutes) { return new Date(Date.parse(value.replace(' ', 'T') + 'Z') + minutes * 60000).toISOString().slice(0, 19).replace('T', ' '); }
export async function notifyHeads(c, studentId, title, message, senderId, type = 'dtr_absence') {
    const [heads] = await c.execute(`SELECT DISTINCT h.user_id FROM dept_heads_background_info h
 JOIN departments d ON d.id=h.department_id AND d.code<>'REG'
 JOIN users u ON u.id=h.user_id AND u.deleted_at IS NULL AND u.status='active'
 JOIN student_academic_info a ON a.department_id=h.department_id
 WHERE a.user_id=? AND a.id=(SELECT MAX(x.id) FROM student_academic_info x WHERE x.user_id=a.user_id)`, [studentId]);
    const [[profile]] = await c.execute("SELECT CONCAT_WS(' ',first_name,last_name) AS name FROM user_profiles WHERE user_id=? LIMIT 1", [studentId]);
    const studentName = profile?.name || 'Student';
    const notices = [];
    for (const h of heads) {
        const notice = { user_id: h.user_id, sender_id: senderId || studentId, type, title: studentName + ": " + title, message, link: type==='dtr_duty_schedule'?'/department_head/attendance?section=schedules':'/department_head/attendance?section=absences' };
        await c.execute('INSERT INTO notifications (user_id,sender_id,type,title,message,link) VALUES (?,?,?,?,?,?)', Object.values(notice));
        notices.push(notice);
    }
    return notices;
}
// Called inside the employer's existing transaction. Version future changes so
// today's schedule, open-shift snapshots and historical absences stay stable.
export async function versionEmployerSchedule(c, internshipId, employerId, schedule, workingDays) {
    const today = (await databaseNow(c)).slice(0, 10);
    const [prior] = await c.execute("SELECT id FROM dtr_weekly_schedules WHERE internship_id=? AND source='employer' LIMIT 1", [internshipId]);
    const earliest = prior.length ? addDays(today, 1) : today;
    const effective = schedule?.startDate && schedule.startDate > earliest ? schedule.startDate : earliest;
    if (schedule?.endDate && schedule.endDate < effective)
        throw Object.assign(new Error('An updated schedule must cover tomorrow or a later date.'), { status: 400 });
    await c.execute("UPDATE dtr_weekly_schedules SET effective_until=LEAST(COALESCE(effective_until,?),?) WHERE internship_id=? AND source='employer' AND (effective_until IS NULL OR effective_until>=?)", [addDays(effective, -1), addDays(effective, -1), internshipId, effective]);
    if (schedule)
        await c.execute(`INSERT INTO dtr_weekly_schedules (internship_id,source,clock_in_time,clock_out_time,working_days,effective_from,effective_until,created_by)
 VALUES (?,'employer',?,?,?,?,?,?)`, [internshipId, schedule.clockInTime, schedule.clockOutTime, JSON.stringify(workingDays), schedule.startDate && schedule.startDate > effective ? schedule.startDate : effective, schedule.endDate, employerId]);
}
export { resolveDuty, currentDuty, clockAccess };
