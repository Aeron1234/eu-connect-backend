const DAY = 86400000;
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const wallEpoch = value => Date.parse(String(value).replace(' ', 'T') + 'Z');
export function daysArray(value) { try {
    return Array.isArray(value) ? value : JSON.parse(value);
}
catch {
    return [];
} }
// Employer coverage takes priority even on its rest days. It cannot be bypassed
// by selecting a student schedule. Schedule dates are Philippine calendar dates.
export function resolveDuty(schedules, date) {
    const applicable = schedules.filter(s => s.effective_from <= date && (!s.effective_until || s.effective_until >= date));
    const pick = source => applicable.filter(s => s.source === source).sort((a, b) => Number(b.id) - Number(a.id))[0];
    const s = pick('employer') || pick('student');
    if (!s)
        return null;
    const start = String(s.clock_in_time).slice(0, 5), end = String(s.clock_out_time).slice(0, 5);
    return { ...s, shift_date: date, isDuty: daysArray(s.working_days).includes(new Date(date + 'T00:00:00Z').getUTCDay()),
        expectedIn: date + ' ' + start + ':00', expectedOut: (end <= start ? addDays(date, 1) : date) + ' ' + end + ':00' };
}
export function currentDuty(schedules, now) {
    const today = now.slice(0, 10);
    // Previous overnight shift remains eligible until its scheduled end. Tomorrow's
    // just-after-midnight shift may open during today's final half hour.
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
        const s = resolveDuty(schedules, date);
        if (s?.isDuty && wallEpoch(now) >= wallEpoch(s.expectedIn) - 1800000 && wallEpoch(now) < wallEpoch(s.expectedOut))
            return s;
    }
    return resolveDuty(schedules, today);
}
export function clockAccess(duty, now) {
    if (!duty)
        return { open: false, message: 'Set your duty schedule before clocking in.' };
    if (!duty.isDuty)
        return { open: false, message: 'No duty scheduled for this date.' };
    if (wallEpoch(now) < wallEpoch(duty.expectedIn) - 1800000)
        return { open: false, message: 'Clock in opens 30 minutes before your scheduled start.' };
    if (wallEpoch(now) >= wallEpoch(duty.expectedOut))
        return { open: false, message: 'This scheduled shift has ended. Report an absence or missed attendance.' };
    return { open: true, message: '' };
}
