# Weekly duty schedules and absence reporting

Implemented November 11, 2026. This supersedes earlier guidance allowing unscheduled clock-in.

## Deployment order

1. Back up the database. Run `scripts/2026-11-11-dtr-duty-schedules-absence.sql` once, after the existing November 8 DTR review and November 10 company-evaluation migrations.
2. The migration creates `dtr_weekly_schedules`, `dtr_absence_reports`, and `dtr_schedule_reminders`, and adds `dtr_absence` / `dtr_duty_schedule` notification types while preserving the enum values in the latest supplied schema. It widens `notifications.link` to VARCHAR(255) for Attendance query links. Existing employer schedules are seeded from the migration date forward, with all seven days selected because old schedules did not store working days. Employers should review those days. No pre-migration absences are generated; no existing attendance is rewritten.
3. Create a **separate EmailJS reminder template** using `docs/emailjs-duty-reminder-template.html`. Set To Email to `{{to_email}}` and Subject to `{{subject}}`. Use the same connected EmailJS service, sender and backend API security setting as account invitations. The template uses `username`, `week_start`, `dashboard_url`, and `message`.
4. Add **backend** `EMAILJS_DTR_TEMPLATE_ID=<new reminder template ID>`. Existing `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` and trusted `CLIENT_URL` are reused. Account invitations/reset templates are unchanged. No frontend environment variable, package installation, or database credential change is needed.
5. Deploy the backend, then frontend, and keep the backend running for cron. Verify one student schedule submission, the head's notification, scoped Attendance views and a test reminder through EmailJS before enabling production mail. No live emails or migration are sent/run by repository tests.

## Student workflow and schedule policy

The student dashboard contains My duty schedule and absences. An approved ongoing internship whose start date has arrived and an applicable schedule are required for clock-in. Set recurring weekly working days, start/end times and an effective start date; the end date is optional. Initial student schedules may start today; subsequent versions start tomorrow or later (within 90 days). They notify the current regular department head and apply without a separate approval step. Supervisor schedules take priority, including their rest days, while their date range covers a date. Otherwise the student's schedule applies. A previous supervisor's schedules are ignored once they are no longer assigned. Employer schedule changes/removal also start tomorrow; initial employer schedules may start today. Existing DTR snapshots are immutable.

Clock-in opens 30 minutes before start and ends at scheduled shift end; late clock-in remains possible within that interval. Employer and fallback schedules use the same window. The existing location/photo/start-date/rest and credit-cap checks remain. One attendance per shift-start date is checked under the student's lock, including across internships. For a midnight start, the window can open on the previous evening. For a night shift, the start date determines its weekday and absence date. Open-shift clock-out and breaks remain usable if a schedule expires or changes.

Date-specific leave, holiday/no-duty and cancelled-duty exceptions use the report form for that shift date. Temporary changes in duty hours can use a new dated schedule version followed by another version when normal hours resume. Schedule history shows the dates and source. No school-holiday dates are guessed automatically.

## Reporting, detection and review

Report absence beside Clock in is shown only when that scheduled shift has no attendance/report and no open shift. Report another date in the panel supports new reports up to seven days in the past or 30 days ahead. Existing automatically generated missing-reason reports can be explained after the seven-day limit. Dates before the internship start are rejected.

Students choose Absent, Leave, Holiday / No duty, or I worked but missed clock-in and enter 5-2000 characters. A report has zero credit. Submission notifies only current non-Registrar department heads; edits preserve original `reported_at`. Leave/no-duty is a claim pending review, not automatically approved leave. Attendance blocks a same-shift report, and an existing report blocks clock-in for that shift. Clock-out does not re-enable reporting for the same shift.

Every 15 minutes (Asia/Manila), a locked backend job checks scheduled shifts from the last seven days through today for ongoing internships. Only after scheduled end, and only if no attendance exists, it creates one No attendance recorded / reason needed entry and notifies the head. Rest days, dates outside schedule coverage and pre-feature dates are skipped. Unique keys plus student-row locking prevent duplicate reports and attendance races. Missed runs catch up within this seven-day scanning window. The dashboard refreshes every 30 seconds while visible and opens the missing-reason dialog; dismissal leaves the reminder. It does not block a later eligible clock-in.

Absence rows use the shared DTR table in the schedule/absence panel: shift date, zero hours, classification, review status and View reason; time/photo/timing cells are dashes. The original report time and review notes are visible in the dialog. They are stored separately from ordinary attendance, so existing employer/admin attendance queries cannot expose them.

Only students themselves and **current regular department heads in the same department** can read the private reports. Admins, employers and Registrar heads are rejected by the route/DB scope. Head list and review resolve latest academic department membership in SQL, not token department claims. Heads search/paginate Absence reports or Duty schedules in Attendance. Review confirms a category with a note. Students may edit until reviewed. Review notifies the student.

When the head confirms that work actually occurred, they enter verified past clock times and net hours excluding breaks. The actual start date must match the report date, wall span is at most 16 hours, credit cannot exceed elapsed time or `MAX_SHIFT_HOURS`, and future work is rejected. One flagged DTR correction is created with no photo/GPS claim, credit is added once, and the report becomes corrected. Ordinary employer attendance access may see that correction; the private absence reason remains hidden. Other classifications receive zero credit. Activity logs record the action without the private explanation.

## Sunday reminders

At 09:00 Asia/Manila each Sunday, with hourly catch-up through 23:00, send active ongoing interns with email a reminder to review the coming week's schedule. Existing schedules continue across weeks; the email does not force a resubmission. The sender shares the account EmailJS queue/rate limit. A student/week ledger prevents duplicate delivery across processes/restarts. Provider failures are recorded as failed and logged safely; ambiguous failures are not automatically resent. Missing `EMAILJS_DTR_TEMPLATE_ID` skips mail with a configuration warning. For a confirmed nondelivery, an operator can inspect the ledger and explicitly remove that student's failed claim to retry during Sunday's remaining catch-up hours. Do not reset sent/sending claims without checking delivery.

## Maintenance and validation

Core files: `features/dtr/dutyScheduleModel.js` (pure dates/priority), `dutyScheduleService.js` (locked attendance checks/notifications/versioning), `controllers/dutyScheduleController.js` (student/head API), `config/dtrDutyJobs.js` (absence and reminder cron), `services/accountSetupMail.js` (shared EmailJS transport). Frontend: `DutySchedulePanel`, `AbsenceDetails`, `ReportAbsenceButton`, `duty-queries` and `duty-actions`. HelpManual and /help share the student-duty / department-duty guides.

No absence endpoint accepts employer/admin viewers; never merge raw reports into shared employer attendance or exports. Use private no-store reads and viewer-keyed TanStack queries. Successful writes invalidate duty, attendance and dashboard data; socket notices invalidate recipient queries. The 30-day internship retention worker removes schedule/report children through foreign-key cascades when it purges their parent. Account activation/deactivation remains unrelated.

### Verification performed

The focused backend suites cover schedule priority/window boundaries, night and midnight shifts, department/Registrar denial, duplicate attendance prevention, future-only schedule changes, cron deduplication, Sunday reminder payload/ledger, existing shift/photo/rest behavior, account EmailJS transport and retention. The new frontend tests cover the clock-in/clock-out gate, Report absence visibility and allowed notification destinations. ESLint on changed UI modules and a production webpack build passed. The migration and real EmailJS template delivery were not exercised against the user's database/account.

A wider frontend test run also found existing stale fixtures: the bulk-DTR test still expects `/dtr-locations` rather than the canonical `/dtr-restrictions` and lacks the live-location hook mock; the sidebar/help test assumes every route group item has an href and does not traverse Evaluation dropdown children. These older tests require their own fixture update; their application behavior was not changed to satisfy those outdated expectations.

### Recovery after PREPARE failure

If the three tables and employer schedule seed succeeded but the old session-variable notification update failed, run only `scripts/2026-11-11-dtr-duty-notification-recovery.sql`. Do not rerun the table creation or seed. The replacement uses a direct ALTER TABLE, retains the latest supplied notification enum members, and widens `link` from CHAR(36) to VARCHAR(255) so the new Attendance URLs are not rejected or truncated. A PREPARE error near NULL indicates the generated statement was NULL; separate editor sessions or an unavailable database/column lookup are possible causes. The corrected migration does not depend on session variables.


## EmailJS template designs (November 11, 2026)

Both templates were saved directly in EmailJS with matching maroon EU-Connect headers, compact information panels, Arial typography and a single primary action. Account setup/reset retains `template_0lgvvoe` and the current backend variable contract. Weekly duty reminders use `template_bdj6kry`; configure `EMAILJS_DTR_TEMPLATE_ID=template_bdj6kry` in the deployed backend (the local backend value is set). Existing service credentials and default connected sender are retained. Repository copies are `docs/emailjs-account-template.html` and `docs/emailjs-duty-reminder-template.html`. The To Email field uses `{{to_email}}` and Subject uses `{{subject}}`; reminder parameters are username/message/week_start/dashboard_url. No emails were sent as part of this template editing task. Layout changes do not guarantee inbox placement; investigate sender authentication/reputation if Gmail continues to flag mail.
