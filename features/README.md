# Backend features

Each feature keeps its HTTP handlers and routes together:

```text
features/
  internship-records/
    controllers/
      internshipRecordControllers.js
    routes/
      internshipRecordRoutes.js
```

Use both subfolders even when a feature has only one controller and one router.
Existing controller and route filenames are preserved. Student and employer
evaluation modules share the `evaluations` feature; socket authentication lives
in `auth`.

Register routers in the root `server.js`. Folder names do not determine endpoint
URLs: those remain defined by router paths and their server registrations.

Shared database/cache configuration, middleware, services, and email helpers
remain in their existing root folders. Feature modules import those shared
dependencies with `../../../`; routes import their feature's controllers with
`../controllers/`.

Backend tests remain in `tests/` and import modules from `features/`. Run the
existing suite from the backend root with `npm test`.


## Weekly duty schedules and private absences (November 11, 2026)

Clock-in now requires an applicable weekly duty schedule. Supervisor schedules take priority; students submit fallback working days/hours in the dashboard. Clock-in opens 30 minutes before start, including overnight shifts, and closes at scheduled end. Schedule versions preserve earlier attendance; edits begin tomorrow. Every 15 minutes the backend detects missing attendance after scheduled end and prompts for an explanation. Students report Absent, Leave, Holiday / No duty, or missed clock-in; new past reports have a seven-day window and future reports a 30-day window. Only the student and their current same-department non-Registrar head can view these private reports. Heads review in Attendance; no employer/admin/Registrar absence access or notifications. Head-verified worked corrections are flagged and credited once within the configured cap. Sunday EmailJS reminders ask ongoing interns to review next week's schedule.

Deploy `scripts/2026-11-11-dtr-duty-schedules-absence.sql` before paired code. Backend needs the new `EMAILJS_DTR_TEMPLATE_ID` and a separate reminder template using existing EmailJS credentials/service; frontend needs no new env/package. See `docs/dtr-duty-schedules.md` for migration order, operational limits, manuals and reminder setup. The shared role help/page manuals are updated. Keep absence data separate from employer-visible DTR reads and derive department scope from current database membership.
