# Daily time records

Attendance uses verified location and timestamped camera evidence, breaks, employer/fallback schedules, timing labels, credited-hour limits and separate missed-clock-out review. Route registration is in `routes/dtrRoutes.js`.

## Weekly duty and absence API

`GET /api/v1/dtr/duty` (also under the existing legacy prefix): students receive their ongoing internship, versioned schedules, current duty/access result and up to 100 most recent private reports. Regular department heads receive a same-department paginated list; `section=schedules|absences`, `page` and `search` are supported. Latest academic membership supplies department scope. Registrar, admin and employer viewers are denied.

`POST /api/v1/dtr/duty`: student `action=schedule` submits workingDays (0=Sunday through 6=Saturday), clockInTime/clockOutTime (HH:mm), effectiveFrom and optional effectiveUntil (YYYY-MM-DD). Student `action=absence` submits date, category (absent/leave/no_duty/worked) and reason. Regular department-head review supplies report id, studentId, category and reviewNote; verified worked corrections also require actualIn/actualOut (Manila datetime-local) and net hours. A submitted fallback schedule becomes effective on its allowed date without a separate approval state; heads receive a notification.

All schedule/report/clock-in writes serialize on the student's user row. Current employer coverage has priority even on its rest days. The fixed schedule window is thirty minutes before start through scheduled end. Open-shift clock-out and break behavior is independent of later schedule expiry. Absence data is kept out of ordinary employer/admin attendance queries and exports.

See [deployment, policy and reminder setup](../../docs/dtr-duty-schedules.md), [migration](../../scripts/2026-11-11-dtr-duty-schedules-absence.sql), and [EmailJS reminder template](../../docs/emailjs-duty-reminder-template.html). No database changes or real email sends occur in tests.
