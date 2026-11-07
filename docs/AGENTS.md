# EU Connect backend — agent handoff

## Department-head review navigation (November 7, 2026)

Frontend Internship Records now handles placement decisions, overview and rotations. Department-wide Attendance, Student Submissions and Evaluations lists open focused `/department_head/attendance/[internshipId]`, `/department_head/submissions/[internshipId]` and `/department_head/evaluations/[internshipId]` pages. These pages reuse the existing authorized record-detail API endpoints; do not relax their department or Registrar checks. Old Records tab URLs redirect in the frontend. Request/finished notifications still open the record overview, while evaluation notifications open the focused evaluation when both IDs exist. No backend route, schema or environment change is needed for this navigation split.

## Department-head record review (November 6, 2026)

Frontend staff Records moved to `/department_head/internship-records`. Backend `/internship-records/...` API paths stay unchanged, but staff list, overview, DTR, narratives, summary report, evaluations, documents, downloads, approval, restoration, and completion require a department head. Admins cannot use these APIs or the former admin-only record deletion route. Student-owned record endpoints and separate admin dashboard/search/reporting permissions remain. Rotation reads keep student, assigned employer, and authorized head access but exclude admin. Keep current-department authorization on each read and mutation.

## Employer DTR shift restrictions (November 5, 2026)

The follow-up migration `scripts/2026-11-06-dtr-shift-date-range-notifications.sql` adds nullable inclusive `start_date`/`end_date` and the `dtr_shift_schedule` notification type. Existing rows with both dates NULL remain unbounded. Validate ISO dates and ordering server-side; compare the shift's **start date** against the range so overnight clock-ins after midnight retain the prior day's schedule. Dashboard reads show only currently applicable hours. Set/update/remove writes lock the current employer-owned ongoing internship, persist the schedule change with one student notification and one readable activity log in the same transaction, then invalidate notification/activity/dashboard caches and emit the socket notice after commit. Identical saves and removing an absent schedule create no notice. Prior DTR expected-time snapshots are never rewritten.

Apply `scripts/2026-11-05-dtr-shift-restrictions.sql` after the camera migration. `dtr_shift_restrictions` belongs to an internship and its current supervising employer; only that employer can PUT/DELETE its schedule for an ongoing, nondeleted internship. Admin and ordinary department heads still manage location restrictions; Registrar heads are rejected by current DB department membership. `/dtr-restrictions` is canonical; retain `/dtr-locations` API compatibility. Snapshot expected start/end and late flag at clock-in; clock-out computes undertime/overtime from the snapshot so later schedule changes do not alter history. Use Philippine SQL time. A time earlier than start is overnight; late begins at +10 minutes, overtime at +30 minutes after expected end, undertime before expected end. These are labels, not clock gates or credited-hour changes. Auto-closed shifts are not classified as a student clock-out.

## DTR camera evidence (November 5, 2026)

Apply `scripts/2026-11-05-dtr-attendance-photos.sql` before deploying the camera API. `daily_time_records` stores nullable private `clock_in_photo_path` and `clock_out_photo_path`; existing/auto-closed shifts remain readable without photos. Student clock-in/out require a bounded multipart `photo` plus fresh coordinates. Validate image contents, watermark a normalized JPEG with the same database `+08:00` timestamp saved in `clock_in`/`clock_out`, upload privately, and save the path with the attendance write. On definite rollback remove the staged object; on uncertain commit retain it for reconciliation. Admin manual clock-out remains available without a photo. `/dtr/:dtrId/photo/:kind` must authorize ownership, current assigned supervisor, current department head, or admin before issuing a 120-second signed URL. Do not expose a public bucket URL. Delete owned photos after a DTR deletion; breaks and automatic closure do not require images.

## Environment initialization

Keep `import "dotenv/config"` as the first import in `server.js`, before application/routes. JWT validation and socket-key derivation run during module evaluation; loading dotenv later can crash startup even when `.env` already contains the required values. Do not rely on `config/db.js` loading dotenv incidentally, remove required-secret validation, add fallback keys or rotate secrets to fix import order. Start local processes from the backend directory. `tests/startup-environment.test.js` exercises the actual startup import prefix using only a temporary fixture `.env` and verifies that genuinely missing secrets still fail closed; it opens no listener or live database connection.

- Employer dashboard InternsSupervisedCard now consumes grouped students with a placements array from both the overview seed and paginated intern endpoint. Page five unique students before reading their matching placements, scoped to the logged-in employer and status filter. Show name/course/email/profile once and each position/status/date/hours separately. Keep request actions in Notifications. Dashboard stats retain their existing placement counts. List and employer overview cache keys include a grouping version; deploy frontend/backend together.

## Company analytics and Registrar overview (October 31)

`features/analytics` registers `/analytics/companies` (admin/non-REG head) and `/registrar/dashboard` (current REG head only) on both API prefixes. Resolve current head department/code from DB every request; reject missing scopes and forged department/course filters. Use private/no-store and one repeatable-read transaction; errors roll back/release without partial zero-shaped successes. No live DB access is authorized by the supplied export.

Company counts: nondeleted ongoing/finished linked records and nondeleted users only; latest academic row controls course/department. Normalize company whitespace/case across branches, never conflate aliases. Distinct student/company pairs, ongoing precedence for status breakdown, ties in ranks, positive-only least list, separate zero-match directory from scoped confirmed history + manual alumni names (never count unlinked alumni as students). Date filters are inclusive start dates, intersect AY/term; use the existing SIPP year CASE semantics. Global distinct students and monthly pairs have different/non-additive denominators. All report totals/rankings/charts derive from the same pure model.

Registrar permission audit supports only Annex C draft/submitted reporting/activity and Annex D confirmed population/department/course coverage already available through SIPP. Match existing Annex D course/profile/placement rules, retaining reportable historical accounts; do not add attendance/evaluation/document-verification queues, account totals or company popularity. Default year follows existing SIPP helper. Dashboard frontend removes old REG redirect, keeps filtered year/tab/status links to authorized SIPP tools. Existing regular dashboards and permission checks stay intact.

`scripts/2026-10-31-company-analytics.sql` is a read-only verification migration, not schema/data modification. Existing status/date/user lookup indexes suffice; no new env/packages or view/definer changes. Read feature README for counting caveats and deployment order. In-memory fixture + loopback tests cover roles, transfers, duplicates, dates/years, zeros, Registrar counts and rollback; never substitute fixture results for production DB verification.

## Announcement supervisor targeting (October 31)

School targeting is now explicit via `tagged_students_only`, default0. Apply `scripts/2026-10-31-targeted-announcement-audience.sql` after the tag-table migration. Targeted posts require a tag, allow school reads only for tagged students/current heads/author/admin, and notify students/heads excluding author (not admins). Optional employer sharing still requires current tagged supervision. Use `targetedSchoolAccess` on every feed/count/pinned/direct/calendar and notification read/open path; never rely on category alone for a targeted post. Audience/tag edits are transactional and reconcile recipients, revoke old notices and notify newly included recipients after commit. History/inbox/count now bypass route caches for all roles; category caching remains. Existing broad-school instructions below apply only when `tagged_students_only=0`. Preserve Registrar/admin cross-department tagging and regular-head own-department restrictions. See feature README.

Use `features/announcements/studentTags.js` as the single live employer-visibility predicate across announcement feed/count/pins, direct lookups and all notification reads/open handling. `visible_to_employers=0` denies employers. Checked/no tags uses all-employer mode; checked/tags uses `employer_tagged_only=1` and current ongoing, nondeleted internship supervision for tagged students. Never infer all-employer mode from an empty join table: deleted students/tags must not broaden access. Preserve the school's existing General/Department audience and read-only employer/Calendar restrictions.

Tag search/save scopes use current DB academic/head membership; regular heads tag their department, admins/Registrar heads can tag all ongoing interns. Up to 100 distinct student UUIDs; validate at write, persist tags with the post in the transaction, preserve omitted tags on edit. De-duplicate supervisor recipients, remove old employer notifications when scope shrinks, notify newly eligible employers only, emit after commit. Employer feed/inbox/count reads bypass route caches for live supervision authorization. Apply `scripts/2026-10-31-announcement-student-tags.sql` before backend/frontend deployment; no env/package changes. Read `features/announcements/README.md`; keep role manuals accurate.

The feed and direct-post `tagProjection` includes `tagged_student_ids` and `tagged_students` (ID/name pairs) for posts the caller may already read. The frontend uses these IDs for tagged-name profile links; do not remove the projection or loosen post visibility to support the card. Search Users in `features/search-history/controllers/searchHistoryController.js` collapses repeated query whitespace and matches `CONCAT_WS(' ', first_name, last_name)` as well as either name part and company text. Keep the ten-result limit and separate searched-profile authorization; a search hit alone grants no private tabs. No schema/environment change is needed for these read/UI fixes.

## Bulk DTR locations (October 30, 2026)

Location controller/route ownership is consolidated in `features/dtr-locations`: `individualDtrLocationController.js` holds student lookup and profile lookup/set/remove; `dtrLocationRoutes.js` registers both legacy individual endpoints and bulk endpoints. Preserve `/dtr/setted-location` and `/searched-user/set-dtr-location/...` contracts and original guards/limiters. Do not move clock-in/out, breaks or attendance history out of `features/dtr`. Tests importing individual location handlers must use the new module; route fixtures must mount the location router. No frontend/SQL/environment changes are required for this relocation.

`features/dtr-locations` mounts authenticated/private-no-store students/pins reads and assign writes under canonical `/api/v1/dtr-restrictions` with `/api/v1/dtr-locations` retained as a compatibility alias. Admin: all ongoing nondeleted internships/users, department + dependent course. Head: fresh DB membership via `dept_heads_background_info`/`departments`, reject REG or missing department, latest student academic department only, course filter. Employer: ongoing `ir.employer_id` assignment only, no department/course filters. Only employer student rows include shift hours. Never scope from a JWT department claim or client selection. Pins must group only after applying the same access and search/filter predicates as student rows; no hidden students in counts or membership. Table is ten rows/page; pin groups cover all matching effective custom or company-default locations.

Reuse the existing unique `dtr_locations.internship_id`; no group table or historical DTR edits. `locationRules.js` is shared by bulk and existing profile setter: legal finite eight-decimal coordinates, whole-number 20–2,000 m radius default150, trimmed nullable label/address max255. Bulk selections are 1–100 unique internship UUIDs. Lock/recheck ongoing authorized parents in sorted order; return generic per-ID failures for inaccessible/stale records without names. Identical overrides are unchanged. Commit changed upserts, readable audit and student notices together; admin/head actors also send exactly one grouped notice per supervisor for changed students, skipping missing supervisors. Unexpected database/notification failure rolls back; emit user-room events only after commit and never report post-commit delivery trouble as a failed write. Lost confirmation requires refresh before retry, not automatic mutation retries.

`dtr_location_set` reuses the existing enum. Student links are `/student`, employer links `/dtr-restrictions`; existing legacy notifications remain supported. Verified sockets use only existing user rooms; send `dtr_locations_changed` to the actor. Invalidate notification/activity caches after commit. Existing attendance reads consume the same override/fallback and retain clock-in/out geofence/start-date rules. Run the read-only `scripts/2026-10-30-bulk-dtr-locations.sql` verification migration first; location assignment needs no ALTER/backfill, packages or env changes. The later employer shift feature does require `scripts/2026-11-05-dtr-shift-restrictions.sql` after attendance photos. Read `features/dtr-locations/README.md`; maintain matching frontend/help manuals and deploy both repositories together.

The bulk UI also watches one student's temporary Share location stream at a time through `config/liveDtrLocation.js`. Keep the watched room scoped to the authorized ongoing student/internship and reject Registrar heads even if a department ID matches. Renewed watches recheck current membership/supervision. The live pin is never persisted until a separate individual or bulk assignment succeeds.

## Current documentation status (October 28, 2026)

The optimization reports below are historical. Their test counts, data sizes and next-work lists are not current deployment verification. Use README.md and mounted source for present contracts. Incremental SQL and regression tests now exist; historical database inspection does not authorize live database access.

- Canonical API: `/api/v1`; `/eu-connect/api` remains a compatibility alias sharing handlers, cache identities and limiter budgets.
- Socket rooms require verified short-lived tickets. Identity comes from the ticket, not a client-selected user ID; connections end at access-token expiry.
- Map View has city groups beside the map, with shared search, region and department filters. Company/route controls slide out inside the map on desktop and mobile. Keep the panel open during loading/failure and close only after success; preserve the in-map reopen icon and Google Maps fallback.
- Frontend routing uses authenticated GET `/api/map/route/:internshipId`, not the browser Server Action queue. See features/map/README.md and the frontend routing README for the separate deadlines and caches.
- Activities remains proposed, not implemented.
- Employer supervision history: GET /api/v1/searched-user/:searchedUserId/supervised-interns is authenticated for student/employer/department_head/admin, separate from private student work APIs and the employer dashboard. Target must be a non-deleted employer. Only ongoing/finished non-deleted placements of non-deleted students. Page five distinct students by latest placement date and student ID, then load all their placements in one query. Return one entry per student with a placements array ordered newest first; latest academic row avoids duplicate joins. Basic name/course/placement/date fields only, no contact/hours/scores/files. Validate pagination, bind the target ID, preserve failures and release connections, send private/no-store. Empty history is a successful empty page so the frontend can hide its separate Info card. No SQL/env/package changes.
- Rotation create/edit must not use the estimated internship date_ended as an upper bound or require it to be present. Keep valid ordered date-only ranges, the internship start-date lower bound, inclusive overlap checks, parent locking, owner-only writes and ongoing/enabled-state checks. The frontend removes dateEnded max attributes. No schema migration is required for this policy adjustment.
- Linked rotation contracts are recorded in docs/company-rotations-integrations.md. Narrative selection uses coverage overlap after the end estimate too; narrative snapshots and print history must remain unchanged after live timeline edits/deletion/disable. dateEnded in rotation responses is informational metadata. Preserve finished read-only history, profile restrictions and scoped invalidation; do not add end-estimate caps to connected features.
- Company websites are required for new student placements and pending placement edits. Use features/internship-records/companyWebsite.js for required/text/length/HTTP(S) validation and bare-domain normalization; official social-media pages remain accepted. getInternshipRecordOverview returns company_website, retaining null for legacy records so the frontend can display `-`. Existing records are not backfilled or made NOT NULL. Keep current lifecycle/authorization/cache behavior. No SQL or environment changes; deploy the matching frontend.
- Resend cleanup: obsolete config/mailer.js, services/mailer.js, emails/TempPasswordEmail.js, config/emailAssets.js and tests/temp-password-email.test.js have been removed, together with backend `resend`, `react-email` and email-only `react` dependencies. Active invitations/recovery use native-fetch EmailJS; the frontend's React and resend-invitation UI remain. Updated environments do not require `RESEND_API_KEY` or `MAIL_FROM`; retain them on older deployments until upgraded. Keep `CLIENT_URL`, all `EMAILJS_*` variables and `TEMP_PASSWORD_SECRET` (startup validation still requires it). Restart after environment edits and reinstall with `npm ci` after dependency changes. Do not remove legacy temporary-token verification as part of an email-provider cleanup.
- Invitation/recovery delivery failures use safe backend diagnostics: allowlisted email failure categories and provider HTTP status, without provider bodies, keys, addresses or reset links. Recovery preparation failures report a safe database error code and keep the generic public response. Do not remove these diagnostics or expose delivery/account existence details in the public response. See docs/account-invitations.md.
- Account creation requires a valid email for every new role. Reject missing/blank/non-string/malformed email before database access; trim before checking duplicates and storing. Middle initial stays optional. Existing accounts without email are not modified. Current onboarding uses EmailJS invitations: no administrator password, pending flag, hashed one-use 24-hour link and admin resend; existing-account recovery uses a 30-minute link. Apply scripts/2026-10-29-account-invitations.sql and configure the backend EmailJS variables/CLIENT_URL; see docs/account-invitations.md. Never send before transaction commit or report mail failure as failed account creation. Row-lock token consumption and invalidate caches after commit. Legacy setup-only tokens cannot authorize ordinary APIs, sockets, refresh or frontend sessions.
- Evaluation policy (November 4): employers can post multiple confidential performance reviews and students can post multiple supervisor evaluations per ongoing internship. Keep accepted-supervisor authorization, the employer performance start-date gate, soft deletion/staff purge, per-evaluation scores/printing and department notifications. Apply `scripts/2026-10-29-multiple-performance-evaluations.sql` if needed, then `scripts/2026-11-04-multiple-supervisor-evaluations.sql` to drop the respective single-active unique indexes. Do not rerun the October 22 consolidation afterward. Do not add automatic 200-hour restrictions.

Updated: 2026-10-05 (Asia/Manila).

## Combined dashboard responses

Employer, department-head, and admin dashboard stats now live in the `stats`
field of their respective `*-dashboard-data` responses. Each handler acquires
one pooled database connection for its counts and detail queries. The three
standalone stats routes were removed; update the frontend with this backend.
The data routes retain their 15-second private cache and existing data fields.
Count-query failure returns an error; optional detail-query failures keep their
existing fallbacks and set `res.locals.skipCache`. Student `/dashboard-stats`
remains separate from the uncached, live `/student-dashboard-data` response.

## Department student hours pagination

`/department-head-dashboard-data` now returns the first 10 active internship
rows in `hoursTracker`, with `page`, `pageSize`, `total`, and `totalPages`.
Its `hoursDistribution` field summarizes **all** active department interns by
course, so the donut chart does not change as tracker pages change. The
department-only `GET /department-head-dashboard/hours-tracker` serves later
pages and optional `courseId` and debounced student-name `search` filters.
Both reads use the verified department, stable `date_started DESC, id DESC`
ordering, a 15-second private cache, and dashboard invalidation. The frontend
uses the student's `student_id` for its profile link and displays accumulated
hours with one decimal place. Deploy backend and frontend together.
Both the page rows' `atRisk` flag and the chart's `atRiskCount` use the same
database-time calculation: remaining hours compared with time to the internship
end date at 40 possible duty hours per week. The browser renders the returned
flag rather than recalculating it with its own clock. This keeps the two views
consistent but does not change the underlying 40-hour policy assumption.

## Admin activity-log summary

`GET /eu-connect/api/activity-logs` returns 15 rows per page and includes
`stats` for the same action, actor-role, target-type, and description-search
filters as its pagination total. Stats are total events, distinct active actors,
most common action, and most active target module; ties sort by name. The
frontend `/admin/activity-logs` displays these four cards above the filters.
Stats and list remain behind admin authorization and the existing 30-second
private route cache. The personal `/activity-logs/mine` page size remains 10.

## Cache monitoring

`GET /eu-connect/api/cache/metrics` is an admin-only, read-only endpoint behind
`verifyUser`, `verifyRole` and `generalLimiter`. It sends `private, no-store` and
is never cached. The frontend `/admin/cache-monitoring` page calls it through a
server action with the existing access token, offers manual or optional 30-second
refresh, and compares snapshots only when their `startedAt` process identity
matches. The page keeps the last good snapshot when a refresh fails.

The endpoint reports process-lifetime hit/miss/store, bypass and skip reasons,
cache errors, invalidation/expiry counts, route-template buckets, current key
capacity and approximate storage/process memory. Route labels never include IDs,
queries, tokens or bodies. Metrics are per API process, reset on restart, and do
not measure database latency. A cache flush does not reset the counters. Cache
read/write failures still fall back to the normal controller response.

## Duty breaks

Clock-in locks the student's `users` row to serialize simultaneous attempts, then rejects any open DTR, a prior shift started on the current Philippine date, or a clock-out less than six hours ago. The MySQL pool uses `+08:00`; `CURDATE()` and `NOW()` provide the calendar day and elapsed rest time. A night shift belongs to its start date; `/dtr/today` and the student dashboard include a prior-day shift that is still open or ended today. Keep the same safeguards on DTR deletion so deleting a recent shift cannot permit an extra clock-in. Legacy rows without a clock-in may still be deleted. No schema or environment changes are needed.

Apply `docs/attendance-breaks.sql` before deploying break-enabled backend code.
Student-only `POST /dtr/break/start` and `PATCH /dtr/break/resume` transition the
one open DTR with a non-null `clock_in` between `present` and `on-break`. Both
endpoints reject requests without an active clock-in, and the dashboard shows
the break button only when that record exists. The row stores the current
`break_started_at` and accumulated `break_total_seconds`; all timestamps and
duration calculations use database time. A student must resume before manual
clock-out. Clock-out subtracts completed breaks before the `MAX_SHIFT_HOURS`
credit cap. Auto-close uses elapsed wall time, including breaks and overnight
hours, at the fixed 16-hour safety limit. The dashboard's live state
uses `ON_BREAK`; the historical `status` field stays `present` once closed.
Overtime approval does not change the credit cap.

## Attendance shift cap and auto-close

`config/shiftLimits.js` parses and validates `MAX_SHIFT_HOURS` as a positive
whole number as the maximum creditable hours for manual clock-out and review. Keep the
cap numeric: a string cap previously made clock-out commit the shift, then fail
while formatting `shiftHours`. At exactly the cap, a manual clock-out is not
flagged; a longer shift is capped and flagged. Auto-close starts after 16 wall
hours by default, sets `status = 'present'`, `flagged = 1` and `auto_closed = 1`,
and proposes break-adjusted duty without crediting it. It preserves a null
clock-out photo and requires student explanation and scoped staff review before
hours are credited. The job rechecks and locks rows before writing, so a manual
clock-out after the initial scan is not overwritten.
`docs/attendance-auto-close-backfill.sql` is an optional, narrowly scoped
one-time correction for historical eight-hour rows marked invalid by the old
job; review its count before running it against a live database.

## Header notification count and lazy inbox

`GET /eu-connect/api/notifications/unread-count` returns only
`{ unreadCount }` for the verified recipient using one count query. It has the
same auth, role, limiter, and 15-second private cache policy as the inbox.
`invalidateNotificationsCache` clears both the count route and the existing
`/notifications` route after successful writes and committed cross-controller
changes. The inbox response still carries its count for `/notifications`.
The frontend header no longer awaits an inbox fetch. Its bell requests the
count on mount and on relevant events; the full inbox is fetched when the
desktop dropdown opens or the mobile link navigates to `/notifications`.
The dropdown shows skeleton rows while loading and a retry on read failure.

## Live notification socket authentication

Socket.IO connections now require a 30-second, socket-only ticket from
`POST /eu-connect/api/auth/socket-ticket`. That endpoint requires a verified
access token and derives the ticket's user ID from it. `config/socketAuth.js`
verifies the ticket on every handshake, joins only `user-<verified ID>`, and
disconnects the socket when the underlying access token expires. There is no
client-selected `join` event. The frontend `ims` project obtains tickets through
its same-origin `POST /api/socket-ticket` route, which refreshes the HttpOnly
session if needed and never returns the API access token to browser JavaScript.
The client requests a new ticket for each reconnection. Keep the frontend and
backend changes deployed together; older clients cannot join notification rooms.

## Purpose and scope

This file records the backend analysis and caching work completed in the prior
chat. Read the actual checkout before editing: this handoff does not install the
implementation, and another project may have different files or dependencies.
Merge these instructions with an existing AGENTS.md rather than overwriting it.

Activity-log user-name fixes, Priority-1 query phases 1-9, Priority-2
phases 1-9, and Priority-3 phase 1 (evaluation reads) are installed.
Priority-3 phase 2 reviewed evaluation printing and added a contract test;
Priority-3 phase 3 optimized the personal student profile lookup and reviewed
searched profiles. Priority-3 phase 4 consolidated internship overview
counts, phase 5 simplified search-history's academic join, and phase 6
optimized grouped document lists. Priority-3 phase 7 optimized saved annual
report pagination; the full suite passed **181 tests** in the backend checkout.
Narrative work remains weekly-only.

## System overview

- Project: `ims-backend`, the EU Connect internship management backend.
- Original checkout: `C:\Users\Admin\Desktop\Dev-Projects\Nextjs-Workspace\ims-backend`.
- Node.js ES modules, Express 5, MySQL through `mysql2/promise`.
- `server.js` mounts the same routers under canonical `/api/v1` and legacy `/eu-connect/api`.
- Controllers contain business logic, SQL queries and transaction handling.
- Roles: `student`, `employer`, `department_head`, `admin`.
- JWT authentication accepts bearer tokens or access-token cookies and populates
  **`req.verifiedUser`**, not `req.user`.
- Access tokens last 15 minutes; refresh tokens rotate and have database-backed
  hashed records. This historical section predates EmailJS invitations; current onboarding/recovery contracts are in docs/account-invitations.md.
- Supabase stores uploaded files. Socket.IO delivers notifications to user rooms.
- Background jobs close stale attendance shifts and clean up refresh tokens.
- Main flows: internship submission/approval/completion, supervisor requests,
  geofenced attendance, weekly narratives (daily feature dropped), documents, evaluations/disputes,
  announcements, alumni records, reporting and role-specific dashboards.

The initial analysis was source-level. The frontend and live database schema
were not comprehensively reviewed. No schema/migration files or working test
suite were found initially; focused caching tests were added during this work.

## Current state and collaboration rules

- Preserve existing user work. The original checkout has many modified and
  untracked files; no commits or pushes were made by this work.
- Account caching changes already existed when the review began. They were
  corrected and extended rather than discarded.
- Priority-1 phases 1-9, Priority-2 phases 1-9 and Priority-3 phase 1 are
  installed. Priority-3 phase 2 found no justified print-query rewrite and
  added a contract test. Priority-3 phase 3 optimized the personal student
  profile lookup and reviewed searched profiles. Priority-3 phase 4
  consolidated internship overview counts, and phase 5 simplified
  search-history's academic join. Priority-3 phase 6 optimized grouped
  document lists, and phase 7 optimized saved annual report pagination. The
  current suite passed **181 tests**. Daily narrative caching remains out of
  scope.
- Tests use mocked database connections and real Express routing where relevant.
  Passing tests do not establish production performance, live database behavior,
  frontend refresh behavior, or multi-instance consistency.
- Work in focused phases, preserve response shapes and existing permissions,
  and report exactly what was changed and verified.
- Never read or copy `.env` secrets into handoffs, patches or output messages.
- Keep unrelated security findings separate from the requested caching scope.

## Cache foundation

Core files:

- `config/cache.js`
- `middleware/cache-middleware.js`
- `docs/caching.md`

The implementation uses the existing `node-cache` dependency:

- In-memory, **one API process only**. Restarts clear entries.
- Maximum 1,000 entries; cached JSON bodies limited to 256 KiB each, plus key,
  metadata and JavaScript overhead. Cloning is enabled.
- `CACHE_ENABLED=false` bypasses response caching. Disable it when using multiple
  workers/replicas until shared storage and cross-worker invalidation exist.
- `cacheRoute(ttlSeconds)` is opt-in and must run **after authentication, existing
  authorization and rate limiting**.
- Only authenticated GETs with a verified user ID and role participate.
- Keys include user ID, role, username, department/course context and the full
  original URL. Query strings partition filters, scopes and pagination.
- Only status-200 JSON is stored. Errors, Set-Cookie responses, oversized bodies
  and `res.locals.skipCache = true` responses are not stored.
- Null, false, zero, empty strings and empty arrays are valid cached responses.
- Private cached routes send `Cache-Control: private, no-store` to prevent
  downstream browser/proxy caching. This does not disable the server cache.
- Cache read/write failures fall back to the ordinary controller response.
- `invalidateUserCache(userId)` clears that user's entries.
- `invalidateRouteCache(path, userId?)` matches an exact full API path across
  query variants, optionally targeting one user. Do not use substring/regex
  invalidation or omit `/eu-connect/api` from paths.
- Invalidation increments a global generation. A read started before a write
  cannot repopulate cleared cache entries afterward. Its already-running
  response may still contain its earlier database snapshot.
- Invalidate only after a successful write, and **after commit** for transactions.
  Failed transactions must not invalidate.
- If a controller catches individual query failures and returns partial data
  with HTTP 200, set `res.locals.skipCache = true` in those catch paths.

The original bug was reading `req.user` in the cache while auth set
`req.verifiedUser`, causing private profiles to share an `anon` cache key.
Do not reintroduce anonymous or cross-user response sharing.

## Completed caching coverage

All paths below are relative to `/eu-connect/api`.

| Area                 | Cached GET endpoints                                                            | TTL         |
| -------------------- | ------------------------------------------------------------------------------- | ----------- |
| Accounts             | `/avatars`, `/account/user`, `/accounts`, `/create-account-form-data`, `/roles` | 60 seconds  |
| Activity logs        | `/activity-logs/mine`, `/activity-logs`                                         | 30 seconds  |
| Notifications        | `/notifications`, `/notifications/unread-count`                                 | 15 seconds  |
| Departments/courses  | `/departments`, `/courses`                                                      | 300 seconds |
| Criteria management and forms | Department-scoped criteria and active-form endpoints | Not response-cached |
| Internship postings  | `/internship-postings`, `/posted-jobs`                                          | 30 seconds  |
| Dashboard summaries  | Six endpoints listed below                                                      | 15 seconds  |
| Announcements | `/announcements/history` | 30 seconds |
| Announcement categories | `/announcements/categories` | 300 seconds |

| Alumni and company directory | `/alumni-internships`, `/company-directory` | 60 seconds |

| HTE and annual summaries | `/reports/academic-years`, `/reports/hte-annual/companies`, `/reports/hte-annual/company`, `/reports/annex-c` | 60 seconds |

| Past internship records | `/internships/my-past-internships` | 60 seconds |

| Reference lookups | `/regions`, `/internships/files/requirements` | 300 seconds |

| Staff internship lists | `/internship-records/department`, staff `/internships/all`, `/internships/active/all` | 30 seconds |

| Document metadata | Own files, grouped student files/counts, employer uploads, record documents | 30 seconds |

| Evaluation history | Past student, combined, disputed, submitted and record summaries | 30 seconds |

| Weekly narratives | Personal history/statistics, searched-student and record views | 30 seconds |

| Searched profiles and overviews | `/searched-user/:searchedUserId`, `/internship-records/overview/:internshipId` | 30 seconds |

| Attendance history | Personal, searched-student and record DTR views; closed-row responses only | 30 seconds |

| Saved annual details | `/reports/annex-c/:reportId` | 60 seconds |

### Saved annual report details

GET /reports/annex-c/:reportId (under /eu-connect/api) now caches for 60 seconds,
using reportCacheHit only after the controller's database-backed Registrar/admin
access check. That check still runs on hits; revoked Registrar assignment or
permission-query errors cannot receive cached details. Keys separate viewers,
role/department context, report IDs and query variants. Report fields and entry
ordering are preserved. Missing reports and read errors never populate cache.

invalidateAnnualReportsCache now clears both summary and one-segment detail paths
for all viewers after creation, update, submission or deletion commits. Existing
save/delete hooks run before response rereads; a failed reread after commit still
leaves entries invalidated. Failed commits preserve both summaries and details.
Nested/export and similarly named routes are excluded. Generation advances even
when no entries exist. No new write endpoints, permissions or schema changes.

Three new tests and expanded annual write/rollback checks cover detail TTLs,
viewer/report/query separation, current Registrar access, missing/error reads,
post-commit invalidation and exact route matching. Full staged suite: 126 passed,
0 failed. User confirmed this phase installed with 126 passing tests.

### Historical attendance

Three GET views use a 30-second TTL under /eu-connect/api: /dtr/history,
/searched-user/dtrs/:studentId and /internship-records/dtr/:internshipId.
cacheAttendanceHistory only stores successful results when every returned row
has a non-null clock_out. Any open shift bypasses storage for the entire response;
empty results remain cacheable. No SQL row filtering or pagination/count change
was introduced. A page of closed shifts can be cached even if another page holds
an open shift; clock-in/out invalidation keeps page boundaries and counts fresh.

Today/status/location endpoints and clock-in/out validation remain uncached.
User identity, role/context and full URL separate targets, internshipId, limit
and offset. Record-specific reads run verifyRecordAccess before each cache lookup.
Searched-student reads preserve existing role checks and ongoing/non-deleted
internship filters; their controller has no supervisor/department ownership check.
Existing access and geofence rules are not redesigned by caching.

invalidateAttendanceHistoryCache clears all users/variants after clock-in,
clock-out, deletion, automatic stale-shift batch commits and all six internship
lifecycle commits. Failed commits preserve entries. Exact dynamic target matching
excludes live and similarly named paths; generation always advances to prevent
stale in-flight refill. No frontend refresh or socket mechanism was added.

Six new mocked-database tests cover TTL, closed/open/empty/error results,
pagination/isolation, current record permissions, live-route bypass, all three DTR
writes and rollback, and geofence rejection. Existing lifecycle and cron tests also
assert attendance invalidation. User confirmed installation with 123 passing tests.
Live database behavior/performance is unverified. Single-process limits apply.

### Searched-user profiles and internship overviews

GET /searched-user/:searchedUserId and /internship-records/overview/:internshipId
(under /eu-connect/api) cache for 30 seconds. Keys include viewer identity, role,
academic context and full URL, preserving viewer-specific supervision tags in
both employer-to-student and student-to-employer directions. Profile supervision
lookup failures retain the existing fallback response but set skipCache so partial
results cannot be repeatedly served. Missing/error results are not cached.

Overview caching runs after verifyRecordAccess on every request, including hits.
Profiles retain existing authenticated role access without adding ownership rules.
The overview narrative_count now counts weekly_narratives, following the user's
weekly-only requirement; the response field name remains narrative_count.

config/profileOverviewCache.js supplies invalidators for profiles, overviews,
and both together. Account profile/avatar/activation changes, all six internship
lifecycle commits, supervisor request/cancel/accept/reject commits, DTR commits and
stale-shift batches clear both families. Document metadata and weekly narrative
invalidators also clear overviews for document/narrative counts. Writes invalidate
after success/commit; rollback preserves cache. Avatar writes are autocommit.
These helper dependencies are intentionally broad and preserve unrelated caches.

Dynamic families match exactly one target segment, leaving nested searched-user
metadata paths untouched. Generation advances even with no entries. Future
course/department renaming or academic reassignment must invalidate joined profile
and overview data. Existing course/department active toggles do not change joins.
Current overview attendance totals are cached summaries; attendance validation
and live location endpoints are unchanged. No new frontend refresh events added.

Four new tests and extensions of account/profile, supervision, lifecycle,
attendance/cron, document and weekly tests cover TTLs, viewer isolation, current
access, partial failures, counts and invalidation. All 117 staged tests pass;
database and storage are mocked. User confirmed installation with 117 passing
tests. Production performance
has not been benchmarked. Existing single-process restrictions apply.

### Weekly narratives

User requirement: daily narratives were dropped; school requires weekly only.
Do not implement daily-narrative caching or restore that feature. Legacy daily
source files still exist in this checkout; this phase does not delete them.

Three GET views use a 30-second TTL under /eu-connect/api:
/weekly-narratives/history, /searched-user/weekly-narratives/:searchedUserId,
and /internship-records/weekly-narratives/:internshipId. Identity, authorization
context and the full URL separate users, targets, internshipId, page and limit.
History statistics and response shapes are unchanged. This-week statistics can
lag the week boundary by at most the TTL; oversized narratives bypass caching.

Record-specific reads call weeklyNarrativesCacheHit after verifyRecordAccess on
every request, including hits. Searched-student reads retain the existing role
check and ongoing/non-deleted internship filter; they do not currently verify
supervisor or department ownership. Personal reads retain user_id filtering.
This phase changes no existing ownership, pagination or validation business rule.

invalidateWeeklyNarrativesCache clears all three views across users and filters.
Creation and edits are autocommit writes: invalidate only after nonzero affected
rows. Deletion invalidates only after transaction commit. All six internship
lifecycle commits also invalidate because ongoing status and deletion affect
searched results and record access. Zero-row writes, errors and failed commits
preserve entries. No review endpoint exists for weekly narratives.

The helper uses exact paths for personal history and one-segment dynamic target
families; similar names and nested paths are excluded. It always advances the
generation to prevent stale in-flight cache refill. It does not clear daily data.
No frontend refresh/socket events were added. Single-process constraints apply.

Six added mocked-database tests cover TTLs, statistics, pagination, isolation,
current record access, all three writes, failed commits/zero-row writes, errors,
empty results and exact invalidation. Existing lifecycle tests cover weekly
invalidation too. All 113 staged tests passed; files are present in the checkout. Production
performance and live database behavior have not been verified.

### Historical evaluation lists and summaries

Five views cache for 30 seconds under /eu-connect/api:
/student-past-evaluations/:studentId, /evaluations/all, /evaluations/disputed,
/evaluations/submitted and /internship-records/evaluations/:internshipId.
Full URL, identity, role and academic context partition entries. Existing score
aggregation, dates, status labels, reviewer fields and empty response shapes are
preserved. Pending eligibility, current complete-evaluation and print reads remain
uncached; criteria retain their independent five-minute cache.

Record-specific summaries call evaluationHistoryCacheHit only after the existing
verifyRecordAccess database check on every request, including hits. The searched
past-student route retains existing role checks but has no ownership/department
restriction in its controller. This phase does not redesign those permissions.
Personal all/disputed/submitted lists retain identity-scoped SQL filters.

invalidateEvaluationHistoryCache clears all five families for every viewer and
query after both submission types, student-evaluation deletion, response
(completed/disputed), restoration, and staff review commits. Internship lifecycle
commits and profile edits also invalidate joined company/access and actor/reviewer
data. Invalidation precedes socket delivery; failed commits preserve entries.
Dynamic paths match exactly one target segment; print and similar paths are not
matched. Generation advances even with no entries to prevent stale in-flight fill.

Existing criterion writes create or toggle active state, while historical joins
do not filter active state. Future criterion/category renaming or deletion must
invalidate evaluation history; adding criteria does not alter existing scores.
No new refresh/socket mechanism or evaluation business-rule change was added.

Seven new tests cover five reads, score grouping, TTLs, viewer/target/query
isolation, current record access, all six write handlers (including both response
decisions), rollback, rejected writes, empty/error reads and exact invalidation.
Existing profile/lifecycle tests also verify history invalidation. All 107 staged
tests pass using mocked SQL; live database/performance behavior is unverified.
These files are present in the current checkout. Existing process-local limits apply.

### Document metadata and completion counts

Four GET views use a 30-second TTL under /eu-connect/api:
/internships/files, /searched-user/files/:searchedUserId,
/searched-user/employer-uploaded-files/:searchedUserId and
/internship-records/documents/:internshipId. Full URLs, user identity and role/
academic context partition entries. Downloads and signed URLs remain uncached.

Record-specific documents call documentMetadataCacheHit only AFTER the existing
verifyRecordAccess database check on every request, including hits. Revoked
record access or soft-deleted records cannot bypass that check through caching.
The searched-student grouped route retains its existing department-head/admin
role check; it has no department ownership check in its controller. Caching does
not introduce one. Employer-uploaded lists retain their uploader SQL filter.

Grouped completion counts retain existing semantics: only accepted or unmarked
documents count, distinct requirement_type_id values determine submittedCount,
and the count of all requirement types is the denominator. No counting, approval,
visibility or response-shape business rule was changed.

invalidateDocumentMetadataCache clears all four views across viewers, targets
and filters after the five document write commits (two uploads, two deletions,
one approval), six internship lifecycle commits, and account activation changes.
The latter affects grouped lists joining users.deleted_at. Broad invalidation
covers owners, employers and staff. Existing past-list invalidation stays targeted.
Requirement-definition invalidation now clears these views as well as its lookup.
No current requirement-definition mutation endpoint exists.

Dynamic paths are collected by exact family plus one nonempty path segment, then
invalidated using exact paths. Similar prefixes and nested download paths are
excluded. The helper always advances the cache generation even without existing
entries, preventing in-flight reads from refilling stale data after a commit.
Failed commits preserve cache; invalidation precedes existing socket/storage
cleanup. No new socket events or frontend refresh mechanism is introduced.

Five new tests plus existing writer/lifecycle/account test extensions cover the
four reads, counts, TTL, isolation, current record authorization, invalidation,
approval, errors and empty results. All 100 staged tests pass; SQL/storage are
mocked. The user confirmed installation with all 100 tests passing. Existing
single-process restrictions apply.

### Department and admin internship lists

The staff views /internship-records/department, /internships/all and
/internships/active/all cache for 30 seconds (paths under /eu-connect/api).
The department record-review route now allows department heads only; the
separate shared internship-list routes retain their own role rules. Student
/internships/all reads remain uncached. Existing response shapes remain.

The department controller re-resolves the head's department from the database
before every cache lookup. The resolved department replaces the token department
in the cache key without mutating req.verifiedUser. Reassignment with the same
token cannot reuse old department entries; missing profiles return 403 and lookup
errors return 500. Authentication, rate limits and roles precede caching.

The older all/active-all queries currently return shared staff lists and do not
filter departments or soft-deleted rows. This phase preserves that SQL behavior;
the department route retains its department and soft-deletion filters. The all
route already allows employers without a matching controller response branch;
this pre-existing issue is outside this caching change (employers bypass cache).

invalidateStaffInternshipsCache() clears all three paths after all six internship
lifecycle commits and profile changes affecting joined names.
invalidateDepartmentInternshipsCache() clears only the department list after DTR
commits and stale-shift batch commits because it includes accumulated hours.
Failed commits preserve cached data. Future course/region renaming or academic
reassignment must invalidate dependent lists. Current reference definitions have
no mutation endpoints, and course activation does not affect selected fields.

Five added tests plus extensions of lifecycle/profile/DTR/cron tests cover cache
hits, 30-second TTL, queries and users, current department access, errors, empty
results and post-commit invalidation. All 95 staged tests pass. SQL is mocked;
live database behavior and performance have not been verified. User confirmed
this phase was applied with all 95 tests passing.

### Regions and file requirement types

GET /regions and GET /internships/files/requirements (under /eu-connect/api)
cache successful JSON for 300 seconds after authentication, existing role checks
and rate limiting. All four existing roles retain access. Keys include the full
query string (including category), user identity and authorization context.
Response fields and empty-array semantics are unchanged; errors are not cached.

No current backend mutation endpoint writes regions or requirement_types.
config/referenceCache.js supplies invalidateRegionsCache() and
invalidateRequirementTypesCache() for future writers to call after commit.
Each clears only its own lookup across all users/categories. Future writers must
also inspect dependencies in other cached views before adding mutation endpoints.
Direct database edits rely on five-minute expiry or restart. Document writes do
not change requirement definitions and therefore do not clear these lookups.

Four new mocked-database route tests cover TTLs, JSON, category/user/role/context
isolation, authorization, errors, empty arrays and exact invalidation. All 90
staged tests passed; files are present in the current checkout. Existing process-local limits
and CACHE_ENABLED apply. No production query-time benchmark was performed.

### Past internship records

GET /internships/my-past-internships (under /eu-connect/api) caches for 60 seconds
with auth, existing roles and rate limiting before cache access. The signed-in
user, authorization context and full query string partition entries. This phase
covers this personal list only; active/all/department lists and record detail,
DTR, evaluation, document and download endpoints retain their existing behavior.

Existing SQL semantics are preserved: status != ongoing includes pending and
rejected records, the query does not exclude soft-deleted records, and there is
no pagination in the controller. Query strings still partition the cache. The
response includes document counts from internship_documents, not just internship
fields. Changing these business rules requires a separate review.

config/pastInternshipsCache.js exports invalidatePastInternshipsCache(userId).
All six internship lifecycle commit paths clear this route across users. The four
document upload/delete paths in fileControllers and searchedUserController clear
only the document owner's variants after commit, before socket delivery or storage
cleanup. Failed commits leave cache entries intact. Document approval changes no
selected count/field, and DTR hour/profile/supervisor changes do not affect this
list. Future changes to selected columns or document membership must invalidate.

Six added tests verify user/role/query isolation, TTL, errors/empty results,
all lifecycle commit/rollback paths, four document writers, targeted invalidation,
socket/storage ordering and missing/denied/storage-failure paths. Database and
storage are mocked; no live performance or database behavior was verified.
The user confirmed this phase was applied with all 86 tests passing.

### HTE and annual report summaries

Four GET routes cache for 60 seconds: /reports/academic-years,
/reports/hte-annual/companies, /reports/hte-annual/company and /reports/annex-c
(all under /eu-connect/api). Saved /reports/annex-c/:reportId details now also cache for 60 seconds. Full query strings and user/role/department context partition entries.

The three Registrar-restricted controllers call reportCacheHit only AFTER their
existing validation and database-backed isRegistrarHeadOrAdmin check. Never move
these lookups ahead of that check. Department-head hits still query permission;
permission-query failure returns an error rather than cached private report data.
Connections are released on hits as on misses. Academic-year choices retain their
existing broader department-head/admin permissions and use route middleware.

config/reportsCache.js defines invalidateHteReportsCache and
invalidateAnnualReportsCache. All six internship lifecycle commits and profile
updates clear the HTE family, including academic-year choices. Annual creation,
update, submission and deletion clear all summary variants after commit, before
the save response reread; even a failed response reread cannot leave stale cache.
Failed commits preserve entries. Annual writes leave HTE responses intact.

HTE reads join live profile names/gender, latest academic course data and internship
status/dates/location. Existing DTR hour updates and supervisor assignment do not
change selected fields. Current course writes only create/toggle active state;
future course renaming or academic reassignment must invalidate the HTE family.
Annual reports store their own labels/entries and are not computed from alumni.
Default academic-year requests may lag the July boundary by the 60-second TTL.
The existing single-process limit, size limit and CACHE_ENABLED switch apply.

Tests use mocked SQL and real Express routes, not a live MySQL schema or benchmark.
The user confirmed this phase was applied with all 80 tests passing.

### Alumni records and company directory

- Helper: `config/alumniCache.js`, `invalidateAlumniCache()`.
- Both reads retain existing auth/role/rate-limit guards and user/context/query
  isolation, including academicYear, search, page and limit variants.
- All three manual alumni mutations and all six internship lifecycle commit
  paths clear both lists for every user before socket delivery: creation,
  approval/rejection, staff completion, student completion, restoration and deletion.
- Completion can insert system alumni records; directory results combine alumni
  with ongoing/finished internships. Existing grouping and counts are preserved.
- Reads currently return shared lists to students, department heads and admins;
  department ownership checks govern alumni edits/deletes. Caching does not add
  department filtering or change existing filter/grouping SQL semantics.
- Future course renaming or academic reassignment that changes directory joins
  must invalidate these caches. Current course activation does not affect them.
- Failed commits preserve entries. No new client refresh/socket mechanism is added.

### Announcements and categories

- Helper: `config/announcementsCache.js`.
- `invalidateAnnouncementsCache()` clears all history pages and filters for all
  users after creation, editing, deletion, pinning or unpinning commits.
- Profile updates clear feeds because author names are joined from user_profiles.
- Existing notification, activity-log and dashboard invalidation is preserved.
- Preserve SQL visibility: employers never see Department-category posts;
  students/department heads see only their author-department match; admins can
  see all. Keys separate identity, role, department, category, search and page.
- Category lookups preserve the existing null response for an empty table.
- No category write endpoint currently exists. Future category writers must call
  `invalidateAnnouncementCategoriesCache()` after commit to clear both the
  lookup and the feed (which joins category labels/colors). Direct database edits
  rely on TTL expiry or restart; they do not trigger in-process invalidation.
- Future author-role or department reassignment writes must invalidate feeds.
- Existing response shapes and permissions are unchanged.

### Accounts

- Avatar changes/reset invalidate the user's cache and all admin account lists.
- Profile updates invalidate the user's cache and account lists, plus activity
  notification and announcement views that join names from `user_profiles`.
- Creation invalidates account lists; activation/deactivation invalidates the
  target user's entries and account lists.
- Department/course changes invalidate account-creation form choices.
- Partially loaded account-creation form responses are not cached.
- Existing authentication/deactivation semantics were not redesigned; clearing
  response caches is not token revocation.

### Activity logs

- Helper: `config/activityLogsCache.js`, `invalidateActivityLogsCache()`.
- Human-readable `description` values use persisted titles or names, not raw
  record IDs. This includes announcement titles, posting positions and companies,
  document file names, evaluation companies, supervisor-request companies and
  alumni names/companies. Keep IDs in `target_id` and structured `metadata` for
  joins and debugging. Deletion paths read the label before removing the row;
  log-write failures remain supplementary to the business mutation.
- Clears both activity-log routes across users, pages and filters, and now
  invalidates dashboard summaries as well.
- Wired after successful commits in all current log-producing controllers and
  log deletion. Profile-name changes also invalidate joined actor names.
- Do not assume a future log insert is covered automatically: explicitly call
  the helper after commit.

### Notifications

- Helper: `config/notificationsCache.js`, `invalidateNotificationsCache(userId?)`.
- Mark-one, mark-all and deletion clear every inbox page/scope for the affected
  recipient. Personal invalidation leaves other recipients' entries intact.
- Broadcast/cross-controller writes conservatively clear all notification
  entries. The helper also clears dashboard summaries for the same scope.
- Related writes include announcements, internship approval/completion,
  evaluations, supervisor requests, DTR-location assignments and certificates.
- Supervisor cancellation, supersession, acceptance and rejection invalidate
  joined request status, which determines whether a notification is actionable.
- Profile updates invalidate sender names joined into notification responses.
- Evaluation-deletion socket delivery was moved **after commit and invalidation**.
  Failed transactions emit no deletion notification; delivery failures do not
  undo an already committed deletion.
- No new frontend refresh mechanism or new socket events were introduced for
  actions that previously had none. Invalidation makes the next fetch fresh.

### Departments and courses

- Files: `controllers/departmentsAndCoursesControllers.js` and
  `routes/departmentsAndCoursesRoutes.js`.
- Local `invalidateLookupCache(tableName)` clears the affected table's list,
  account-creation form data, and dashboard summaries after commit.
- Covers creation, activation and deactivation for both tables.
- The other lookup list remains cached because each list reads its own table.
- Existing permission difference is preserved: employers can read courses but
  cannot read the department list through these routes.

### Evaluation criteria

- Helper: `config/criteriaCache.js`, `invalidateCriteriaCache(tableName)`.
- Tables: `employer_evaluation_criteria`, `student_evaluation_criteria`.
- Clears the corresponding admin list (including `includeInactive` variants)
  and active form endpoint, plus dashboard summaries.
- Covers all ten write paths: creation, individual deactivation/reactivation,
  and section deactivation/reactivation for both criteria types.
- The other criteria type's list/form remains cached.
- Preserve existing response shapes: admin and evaluation-form item fields differ.
- Preserve soft deletion and historical evaluation references. Actual evaluation
  submission validation and historical evaluation records remain uncached.

### Internship postings

- Helper: `config/postingsCache.js`.
- `invalidatePostingsCache()` clears main listings, employer posted-jobs lists,
  and dashboard summaries after creation, edits or soft deletion.
- `invalidatePostingFavoritesCache(studentId)` clears only that student's
  main-list variants and dashboard summaries after either favorite branch.
- Preserve `isOwner` and `isFavorited` isolation. Keys distinguish `mine`,
  `favorite`, `courseId`, `search`, `workType`, `page` and `limit`.
- Course-only edits and status changes invalidate like other posting edits.
- Existing course mutations create rows or change active status; listing joins
  do not filter by active status. A future course-name edit must invalidate
  postings because those responses join course names.

### Dashboard summaries

Helper: `config/dashboardCache.js`, `invalidateDashboardCache(userId?)`.

Cached endpoints:

1. `/dashboard-stats`
2. `/employer-dashboard-data`
3. `/department-head-dashboard-data`
4. `/department-head-dashboard/hours-tracker`
5. `/average-shift-hours`
6. `/admin-dashboard-data`

- `/student-dashboard-data` remains uncached because it includes live attendance
  status and location. `/posted-jobs` keeps its independent 30-second TTL.
- Shared activity-log, notification, posting and criteria invalidation helpers
  also invalidate summaries. Lookup mutations do so through their local helper.
- These hooks cover account/profile, internship, supervisor, alumni, documents,
  evaluations, postings, notifications and the admin activity chart.
- DTR commits, committed stale-shift batches, internship restoration and
  internship soft deletion have explicit dashboard invalidation hooks.
- Personal notification/favorite changes target the affected user. Shared
  writes conservatively clear summaries across roles and departments.
- Partial-query fallback responses are excluded from caching.
- User/department context and month/year query variants stay isolated.
- Date-dependent summaries can lag a date boundary by their TTL.

## Tests and verification

`package.json` now has `"test": "node --test"`. No additional test framework was
installed. On Windows use `npm.cmd test` if PowerShell blocks `npm.ps1`.

Test files:

- `tests/cache.test.js`
- `tests/cache-invalidation.test.js`
- `tests/activity-logs-cache.test.js`
- `tests/notifications-cache.test.js`
- `tests/lookup-cache.test.js`
- `tests/criteria-cache.test.js`
- `tests/postings-cache.test.js`
- `tests/dashboard-cache.test.js`
- `tests/announcements-cache.test.js`
- `tests/alumni-cache.test.js`
- `tests/reports-cache.test.js`
- `tests/activity-log-names.test.js`
- `tests/past-internships-cache.test.js`
- `tests/reference-cache.test.js`
- `tests/staff-internships-cache.test.js`
- `tests/document-metadata-cache.test.js`
- `tests/evaluation-history-cache.test.js`
- `tests/weekly-narratives-cache.test.js`
- `tests/profile-overview-cache.test.js`
- `tests/attendance-history-cache.test.js`

Latest staged result: **130 tests, 130 passed, 0 failed**. Last user-confirmed
installed result: **129 tests, 129 passed, 0 failed**. Report tests cover current
Registrar authorization on hits, query/context isolation, TTLs, saved
detail isolation, annual writes and rollback, and failed post-commit rereads. Existing
profile and internship tests now verify HTE invalidation too. Alumni tests cover both TTLs,
query/context isolation, all nine mutation commit/rollback paths, socket ordering,
ownership checks, read errors and empty results. Announcement tests additionally
cover visibility partitions, feed filters/pages, pin changes, category transitions,
profile-name invalidation, rollback and null/empty reads. Test coverage
includes user/context/query isolation, authorization before hits, TTLs, failures,
partial-response exclusions, relevant mutation paths, commit ordering, rollback,
favorites, notification socket ordering and stale-shift invalidation. The tests
do not exhaustively validate all business logic or replace a live smoke test.

For a new cache area, test its real routes with mocked database calls, successful
invalidation, failed writes, user/role isolation and cross-controller dependencies.
Run the full existing suite afterward. Do not start the production server or
run cron jobs against the live database just to test a cache change.

## Activity-log user names

Reviewed current activity-log writers for user IDs embedded in descriptions.
Account deactivation/reactivation directly interpolated accountId; forced internship
completion used studentId as a fallback. These three paths now resolve first_name
and last_name through config/activityLogNames.js using the transaction connection.
Descriptions persist a name snapshot; actor_id, target_id and metadata IDs stay
unchanged. Whitespace is trimmed; partial names work. Missing names/query failures
use "User name unavailable", never an ID. Lookup failure is supplementary and does
not fail the business write. Existing commit/invalidation behavior is preserved.

Other description IDs identify documents/evaluations/internship/alumni records;
these are not user IDs and were not replaced. Existing persisted descriptions are
not rewritten by this installer. Historical correction requires a separately scoped
backfill with reviewed mappings; current names may differ from names at event time.
Three new tests cover names/fallbacks, persisted account descriptions with intact
IDs, and forced completion metadata. Full staged result: 129 passed, 0 failed.

## Next work

1. Confirm the installed department dashboard query phase passes `node --test`
   in the backend checkout and compare representative live responses if possible.
2. Inspect schema, indexes and query plans for the remaining Priority 1 endpoints
   before rewriting joins, grouping or search behavior.
3. Measure cache effectiveness and database query time before further tuning.

Keep authentication, clock-in/out validation and live attendance reads uncached.
Multiple API instances need shared cache invalidation before relying on the local
cache. Future instructions should update this docs/AGENTS.md handoff after each
phase, including test status and remaining work.

## Known findings outside completed scope

The initial review identified these concerns; they were not fixed by caching:

- Resolved historical finding: socket rooms formerly accepted client-supplied
  identity. Current config/socketAuth.js verifies socket tickets and derives room
  membership from the authenticated user. Do not restore client-selected joins.
- Some internship listing queries appeared to omit department filtering even
  though other record-access helpers enforce it. Revalidate before proposing fixes.
- No live schema/migrations were available to verify constraints and indexes.
- Production cache effectiveness and memory behavior have not been benchmarked.

## Filesystem incident and safe application workflow

The prior chat's writable workspace was under Documents/Codex, while the real
project was under Desktop. Later in the session, permission escalation was
disabled. A direct `git apply` attempt removed several target files before
failing to recreate them. **The user restored all affected files using saved,
tested copies and confirmed passing tests. No recovery is currently pending.**

Do not repeat an apply attempt against a path known to be unwritable. Check the
current session's permissions; old user approval cannot bypass filesystem policy.
Prefer opening the actual project as a writable workspace. If it is read-only,
prepare changes in a writable copy and provide a user-run installer instead.
Do not use another tool to bypass a rejected write.

The established installer workflow:

1. Read the current checkout, preserving all uncommitted changes.
2. Save a baseline and a modified copy in the writable workspace; never copy `.env`.
3. Test the modified copy without live database writes.
4. Bundle only changed files with before/after SHA-256 hashes.
5. Before any writes, validate every source and destination hash; abort if the
   user has edited a target since preparation. Skip already-applied files.
6. Back up existing targets before copying. Restore attempted files if copying
   fails; preserve backups if post-install tests fail.
7. Run `npm.cmd test`; restart the backend if automatic reload is not enabled.

Artifacts from the prior chat are under:
`C:\Users\Admin\Documents\Codex\2026-09-29\analyze-the-project-so-you-can\outputs`.
They are local historical artifacts, not portable dependencies. Install scripts
require their sibling payload folders. Do not reapply older scripts over newer
phases; build a fresh baseline from the destination checkout.

Completed phases include accounts, logs, notifications, departments/courses,
criteria, postings, dashboards, announcements, alumni/company directory, HTE
reports, past internships, reference lookups, staff lists, document metadata,
evaluation history, weekly narratives, searched profiles/overviews and historical
attendance. Latest user-confirmed result: 123 tests after
`Apply-AttendanceHistoryCache.ps1`. `Apply-AnnualDetailsCache.ps1` updates this
handoff and caching.md and awaits application. Preserve weekly-only narrative
scope and uncached live attendance.

Latest code package: Apply-DepartmentDashboardQueryOptimization.ps1 (installed by matching file hashes; backend test output not yet supplied). Last user-confirmed test result: 129 passed after activity-log name fixes.

## Query optimization: Priority 1, phase 1 (2026-09-30)

The department dashboard query optimization has been applied to the backend
checkout: its controller and focused test hashes match the prepared bundle.
The user has not yet supplied the backend test output for this installation.
The separate staging copy passed 130 tests with mocked database connections.

The department-head stats query (now inside `GET /eu-connect/api/department-head-dashboard-data`) obtains total,
ongoing and pending internship counts from one conditional aggregate over the
same latest-academic-record join. It retains separate manual-alumni and unread-
announcement counts and returns the same JSON fields. The internship portion
uses one query rather than three; this does not establish a production speedup.

`GET /eu-connect/api/department-head-dashboard-data` and
`GET /eu-connect/api/average-shift-hours` project only the academic fields used
by their joins. Their filtering, grouping, ordering, and response mapping are
unchanged. No database schema, indexes, cache keys or invalidation were changed.

The focused test is `tests/dashboard-query-optimization.test.js`. Existing
caching tests use mocked SQL results, so they do not prove live MySQL result
or performance equivalence. Before larger rewrites, inspect current schema and
indexes, collect `EXPLAIN ANALYZE` plans against representative data, and compare
old/new JSON responses including types, nulls, duplicates, pagination and order.

This was the phase-1 scope. Later sections record the completed account,
internship, HTE, alumni, search, and map optimizations. Phase 9 addresses the
weekly average calculation while retaining the existing SQL row query.

## Query optimization: Priority 1, phase 2 (accounts list; installed)

`GET /eu-connect/api/accounts` now uses a narrower `UNION ALL` query for its
total count. The page query and all response fields remain unchanged. The count
query retains all three role branches, the same role/status and substring-search
filters, and the academic/background LEFT JOINs that can multiply rows. It omits
course and department detail joins, which are needed only to display rows and
join by their unique IDs. The existing count response therefore keeps the same
`totalRecords` and `totalPages` semantics when a user has multiple academic rows.

The focused test is `tests/accounts-query-optimization.test.js`. The staged suite
passed 131 tests with mocked database connections. Live schema, `EXPLAIN` plans,
and old/new response comparisons have not been supplied, so production speed
and MySQL result equivalence remain unverified. Do not replace `%search%` with
full-text search or deduplicate users as part of this phase; either would change
the current frontend-visible result.

The account controller and focused test match the installed bundle by SHA-256.
Backend test output from this installation has not yet been supplied. Remaining
Priority 1 areas include HTE reports, alumni/company directory, user search,
student map, attendance averages, and department dashboard query plans.

## Query optimization: Priority 1, phase 3 (department internship list; installed)

`GET /eu-connect/api/internship-records/department` now uses one conditional
aggregate for its filtered pagination total and four status cards. It formerly
used separate total and grouped-status scans; the paginated row query remains
unchanged. The aggregate applies status and substring-search filters only to
`total`; cards still count all non-deleted records in the head's department.
Administrators could use this endpoint when the optimization was introduced,
but the current route rejects them. It retains the same latest-academic-record,
profile, and course joins so filtering and row multiplicity stay aligned.

The latest-academic derived table projects only user, department, course, and
student-number columns needed by this endpoint. The response's fields, page
size, ordering, role checks, and cache behavior remain unchanged. The focused
test is `tests/department-internship-query-optimization.test.js`; all 133 staged
tests pass with mocked database connections. Live MySQL equivalence and speed
still require schema/index review, query plans, and representative old/new JSON
comparisons. Install with `Apply-DepartmentInternshipQueryOptimization.ps1` and
record the backend test result after application.

`GET /eu-connect/api/internships/all` and `/internships/active/all` already use
one SELECT each. They return unbounded joined rows, including repeated student
academic matches where those exist. Pagination or deduplication would change
their frontend contract; review indexes and real query plans before altering
those SQL statements.

The department internship controller and focused test match the installed
bundle by SHA-256. Backend test output from that installation was not supplied.

## Query optimization: Priority 1, phase 4 (internship postings; installed)

`GET /eu-connect/api/internship-postings` now computes the requester's
`isFavorited` flag with a correlated `EXISTS` in its paginated postings query.
The separate favorites batch query is removed, reducing a nonempty page from
four database queries to three. The existing favorite/not-favorite filters,
total count, ordering, pagination, ownership flag, course list, and JSON fields
remain the same. The internal `favorite_for_requester` SQL alias is removed
before sending JSON. Course links still load in one batch and are mapped once
by posting ID, preserving their database row order and duplicates.

Only the postings read controller and its read tests changed. Posting writes,
transactions, notifications, cache TTL, and invalidation remain untouched.
The expanded postings test covers filter parameter order, viewer-specific
favorites, JSON field shape, course ordering, and three-query behavior. All
134 staged tests pass with mocked database connections. Live MySQL speed and
exact result equivalence need representative response comparisons and an
index/query-plan review, especially for `(student_id, posting_id)` favorites.
Install with `Apply-InternshipPostingsQueryOptimization.ps1`, then record the
backend test result after application.

The postings controller, test, and handoff match the installed bundle by
SHA-256. The backend test output from that installation was not supplied.

## Query optimization: Priority 1, phase 5 (HTE company reads; installed)

The live MariaDB view `internship_records_with_ay` selects from
`internship_records` and derives `academic_year` from `date_started` and
`semester` with a CASE expression. Every record for a matching four-digit
academic year starts in either its first or second calendar year. The HTE
company count, page, intern-batch, and both detail-mode queries now add a
redundant two-year `date_started` range while retaining the view's exact
`academic_year = ?` test. The range is omitted for years outside 1000-9997,
avoiding invalid date bounds while preserving the original predicate.

Live `EXPLAIN FORMAT=JSON` showed the existing
`idx_internship_records_status_date` used `status` and `deleted_at` before this
change, then also used `date_started` with the bound. The current database has
only three internship records, so this is an index access improvement for
larger data, not a demonstrated speedup today. Eight old/new query pairs over
the available academic year returned exactly equal MySQL rows. The staged
suite passed 137 tests, including focused parameter/response checks.

`GET /eu-connect/api/reports/academic-years` remains unchanged: it already
performs a single DISTINCT read from the view. Its computed-year temporary
sort cannot be removed safely without a schema/index change, which is outside
this read-query phase. Company-key hashing, grouping, search, pagination,
intern ordering, JSON shapes, authorization, caching, and mutations are
unchanged. Install with `Apply-HteQueryOptimization.ps1`; record the backend
test result after application.

## Query optimization: Priority 1, phase 6 (alumni and company directory; installed)

`GET /eu-connect/api/alumni-internships` now gets the total company-group
count from `COUNT(*) OVER()` on each populated grouped page. This removes the
separate `COUNT(DISTINCT LOWER(TRIM(company_name)))` query on normal pages:
three SQL reads rather than four. The live `company_name` column is NOT NULL,
so the window total matches the distinct-company count. Three live filter
cases returned the same group rows and totals. Empty pages still run the old
count as a fallback. A page beyond the end now returns an empty 200 result
with the correct total; previously its empty `IN ()` query returned 500.

`GET /eu-connect/api/company-directory` folds internship rows into the
directory before fetching alumni rows, releasing the first result array before
the second is loaded. The latest-academic derived table now projects only
`user_id` and `course_id`. The existing JavaScript company normalization,
first-seen display spelling, course insertion order, count, and popularity
sort remain unchanged. Both SQL reads are still unbounded; this phase reduces
peak retained result data rather than database row scans. Do not move the
grouping into SQL without proving collation, spelling, and ordering
equivalence against representative data.

Only the alumni read controller, its existing read tests, and this handoff
changed. Mutations, cache TTL/invalidation, authorization, and normal response
shapes remain unchanged. The staged suite passes 138 tests. The live database
has only two manual alumni and three internship rows, so no production-scale
speedup has been measured. Install with
`Apply-AlumniDirectoryQueryOptimization.ps1` and record backend tests after
application.

## Query optimization: Priority 1, phase 7 (user search; installed)

The earlier optimization of `GET /eu-connect/api/search-users` retained its
then-four `%term%` name/company conditions, all joins, latest-academic-row
selection, and `LIMIT 10`. The later full-name fix adds a fifth condition on
`CONCAT_WS(' ', first_name, last_name)` and normalizes repeated query whitespace.
The latest-academic derived table selects only `user_id`, `course_id`, and
`department_id` instead of `sai1.*`. This reduces its intermediate row width
without changing the result. The live schema already has a `(user_id, id)`
academic index. Six old/new live query pairs returned identical ordered rows;
the query plan retained the same join order and estimated cost.

A per-user MAX(id) lookup had a lower estimated cost but changed the optimizer
join order and the first 10 results for a common term, because this endpoint
has no `ORDER BY`. It was not adopted. The leading-wildcard predicates and OR
across joined company tables still require broad search work; ordinary B-tree
indexes cannot make arbitrary substring matches selective. A larger search
redesign needs an explicit ordering/semantic contract and representative data.

Only the read SQL projection, focused test, and this handoff changed. Search
history writes, authorization, query validation, and JSON shape remain the
same. The staged suite passes 139 tests. Install with
`Apply-UserSearchQueryOptimization.ps1`; no measured production speedup is
claimed from the current 17-profile database.

## Query optimization: Priority 1, phase 8 (student map; installed)

`GET /eu-connect/api/student-map` now consumes the existing ordered prepared
query as a mysql2 row stream with a 64-row high-water mark. It groups each row
directly into the final response, so it no longer retains a separate full SQL
result array alongside the map groups. The latest-academic derived table
projects only `user_id` and `course_id`, which are its only used columns.

The internship status/deletion filters, joins, company/location key, first-row
display fields, intern ordering, percentage calculation, region ordering,
permissions, and JSON shape are unchanged. The live old/new controller
responses were identical (two companies, one region), and the old prepared
result rows matched the new prepared stream. The staged suite passes 141
tests, including grouped-response, forbidden-role, and stream-error checks.

This is a peak-memory improvement, not a reduction in database rows. The
endpoint still returns every matching intern, so final response memory and
network size grow with the result. The live database has only two ongoing
internships, so no production-scale memory or latency gain was measured.
Install with `Apply-StudentMapQueryOptimization.ps1`; record backend tests
after application.

## Query optimization: Priority 1, phase 9 (attendance averages; installed)

`GET /eu-connect/api/average-shift-hours` now calculates the UTC Monday-week
bucket directly from the clock-in timestamp rather than scanning every week
for every attendance row. This changes bucketing work from O(rows × weeks) to
O(rows) and avoids allocating a week-end Date for each comparison. The SQL,
row iteration order, 15-second cache, current-week range, empty-week output,
and JavaScript `Number(...).toFixed(2)` rounding are unchanged. Seventy live
department/month old-new response pairs matched exactly; 142 staged tests pass.

Do not replace this calculation with a plain SQL `AVG(total_hours)` without
changing the output contract. `total_hours` is FLOAT. mysql2 returns a parsed
value such as `0.005`, while MariaDB SUM/AVG of the stored FLOAT yields about
`0.004999999888`; the current JavaScript rounding gives 0.01 and SQL-backed
rounding would give 0.00. A value of `3.335` also differs (3.33 versus 3.34).
The current UTC week buckets and mysql2 `+08:00` date conversion need to be
kept in sync if bucketing ever moves to SQL. This phase improves CPU work but
still transfers individual attendance rows; a larger database/contract change
would be needed to guarantee equivalent SQL-side aggregation.

Install with `Apply-AttendanceAverageQueryOptimization.ps1` and record the
backend test result after application.

## Query optimization: Priority 2, phase 1 (other dashboard statistics; installed)

`GET /eu-connect/api/dashboard-stats` now uses one SELECT containing four
independent scalar counts rather than four queued statements. Each count keeps
its original table, joins, and filters, so this reduces database round trips
but not table scans. The employer stats query, now inside `/employer-dashboard-data`, uses
one SELECT rather than five; one conditional aggregate counts ongoing and
finished internships in one employer-scoped scan. The admin dashboard-data
handler includes one stats SELECT rather than four;
one users/roles scan counts employers, students, and inactive/suspended users.
The roles join is LEFT so inactive/suspended users without a matching role
still count, as in the original standalone query. Its ongoing-internship count
remains independent.

The live schema has relevant single-column indexes for these counts. No index
or mutation was changed because the current tables are small and no
production-scale benefit from a new composite index was established. All 37
live old/new controller responses matched. The staging suite passed 145
tests; the checkout before this phase passed 142. Authentication, 15-second
cache behavior, invalidation, error status, and JSON shape remain unchanged.

Install with `Apply-OtherDashboardStatsQueryOptimization.ps1` and record the
backend test result after application.

## Query optimization: Priority 2, phase 2 (dashboard data; installed)

`GET /eu-connect/api/student-dashboard-data` replaces
`DATE(created_at) = CURDATE()` with the equivalent session-day range
`created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY` for its
today-attendance lookup. It keeps the first-row `LIMIT 1`, the independent
latest-status and location reads, and the uncached live response. The live
schema currently has no `created_at` index, so the plan still uses the
internship index. The range makes an appropriate future date index usable.
Twenty stored day/user/internship comparisons selected the same first row.

`GET /eu-connect/api/employer-dashboard-data` keeps its unbounded joined
intern list, including multiple rows where academic records multiply a join.
The first five posted jobs retain their `created_at DESC` order and JSON
fields. An uncorrelated count in that page query supplies `totalPages`,
removing one database statement; an empty first page has total zero. The
internal `total_postings` alias is removed from response jobs. Independent
error fallbacks and the 15-second cache behavior remain intact. A larger
intern-list reduction would require a frontend pagination contract.

`GET /eu-connect/api/admin-dashboard-data` narrows its latest-academic
derived row to `user_id` and `department_id`. User growth, role distribution,
department grouping, recent activity, section fallbacks, and response fields
remain separate and unchanged. No schema, indexes, mutation, or cache rule
changed. All 37 live old/new dashboard-data controller responses matched;
the staged suite passed 149 tests. The live tables are small, so no
production-scale latency gain was measured.

Install with `Apply-DashboardDataQueryOptimization.ps1` and record backend
tests after application.

## Query optimization: Priority 2, phase 3 (internship lists; installed)

`GET /eu-connect/api/internships/my-past-internships` now counts each record's
documents with a correlated, indexed count. This removes the document join and
temporary `GROUP BY` result. It keeps the same `file_count`, status filter,
ordering, response fields, and 60-second cache behavior. Live old/new SQL
returned identical JSON for the current past-record owner; the database has
only one matching row, so this is a correctness check, not a performance
benchmark. The existing `internship_documents(internship_id)` index supports
the count.

`GET /eu-connect/api/internships/all` removes repeated projections of
`internship_position` and `description` in both student and staff branches.
Those columns were selected twice under the same names, and the driver returned
one JSON field per name. Live old/new JSON matched for both student owners and
the staff list. This reduces transferred SQL fields for an unbounded response
without changing its rows, order, fields, role checks, or cache behavior.

`GET /eu-connect/api/internships/active/all` already uses its status index and
indexed joins, and was left unchanged. Both broad lists remain unbounded and
retain academic join multiplicity; paginating or deduplicating them requires a
frontend contract change. No schema or mutation path changed. The focused test
is `tests/internship-lists-query-optimization.test.js`; all 151 staged tests
pass. No production-scale latency improvement was measured. The changes were
applied with `Apply-InternshipListsQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 4 (posting lists; installed)

`GET /eu-connect/api/internship-postings` now includes the filtered total as
an uncorrelated count in its paginated SELECT. Populated pages use two database
statements instead of three: page plus total, then the existing batch of course
links. An empty first page returns total zero; an empty later page runs a
fallback count to preserve the total and totalPages for out-of-range requests.
The internal `total_postings` field is removed from response rows. Filters,
parameter order, favorites, owner flags, course order, sorting, pagination,
cache behavior, and errors retain their existing response contract.

`GET /eu-connect/api/posted-jobs` applies the same count-in-page pattern. A
populated page uses one statement instead of two, while an empty later page
uses a fallback count. The internal `total_records` field is removed from each
job before JSON serialization; `totalRecords`, `totalPages`, and `currentPage`
remain identical. Live comparisons matched all 33 posting-list and three
posted-job old/new responses. All 154 staged tests passed, including pagination
and cache behavior. Writes, invalidation, and 30-second TTLs did not change.

The current `internship_postings` table has only its primary and employer-ID
indexes. Its general page still scans and sorts rows; employer pages use the
employer index and sort. Indexes on `(deleted_at, created_at)` and
`(employer_id, deleted_at, created_at)` are candidates for a separate schema
phase when table growth or representative measurements justify them. There is
no migration framework in this checkout, and only 50 postings in the live
table, so no index or production-scale latency claim was added here. The
existing posting-course and favorites indexes support those lookups.

Applied with `Apply-PostingListsQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 5 (announcement history; installed)

`GET /eu-connect/api/announcements/history` now carries the original regular
announcement count in the paginated regular-row SELECT. A populated regular
page uses two database statements instead of three: the unchanged pinned read
and the regular page with count. If the regular page is empty, the original
standalone count query still runs. This fallback also applies to page one:
the count query deliberately has fewer joins than the display query, so an
empty display page does not always imply a zero total.

The internal `total_regular` column is removed before JSON serialization.
Pinned ordering, regular pagination and ordering, category/search filters,
author-department visibility for students and department heads, admin access,
employer exclusion from Department posts, response fields, errors, and 30-second
cache behavior remain unchanged. Live old/new controller comparisons matched
84 responses across roles, departments, filters, and pages. All 156 staged
tests passed. Announcement writes and cache invalidation were not changed.

The current announcements table has only its primary, category, and author
indexes. The regular page still scans and sorts its 11-row source table. A
future `(is_pinned, created_at)` index may help a much larger table; no schema
change or production-scale latency claim was made in this phase.

Applied with `Apply-AnnouncementHistoryQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 6 (activity-log lists; installed)

`GET /eu-connect/api/activity-logs/mine` now carries the actor's total in the
paginated row query. Populated pages use one database statement instead of
two. Empty pages still run the original count to preserve pagination totals.
The internal `total_logs` value is omitted from response rows.

`GET /eu-connect/api/activity-logs` likewise carries the filtered total in
its page query, and combines its three unfiltered distinct-value lookups into
one `UNION ALL` statement. Populated admin pages therefore use two statements
instead of five; empty pages use a fallback count for three statements. The
combined lookup still makes three distinct scans, so this is a round-trip
reduction, not a claim that those scans disappeared. Option ordering and null
values remain as before.

The admin filters, joined actor names, page sizes, descending date order,
response JSON, authorization, deletion behavior, and 30-second caches remain
unchanged. Twenty-one live old/new responses matched; all 159 staged tests
passed. The live activity-log table has 75 rows and only primary and actor-ID
indexes. Both lists still sort by date; `(actor_id, created_at)` and a date
index are candidates for a later schema phase when larger data and measurements
justify them. No schema or write path changed.

Applied with `Apply-ActivityLogsQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 7 (notifications; installed)

`GET /eu-connect/api/notifications` now uses one conditional aggregate for
the recipient's all-inbox total, pending-request-scope total, and global unread
count. The inbox row query is unchanged. Every uncached request therefore uses
two database statements instead of three and one recipient count scan instead
of two. The aggregate uses the existing `notifications(user_id)` index.

The `requests` scope still counts only `supervisor_request_submitted` rows;
`unreadCount` still covers the whole inbox. Empty and out-of-range pages retain
their totals and the minimum `totalPages` of one. Sender fields, actionable
supervisor status, ordering, page/limit parsing, response JSON, authorization,
15-second cache, and all mutation invalidation remain unchanged. The separate
counts matched for all 17 current recipients and a missing recipient; 60 live
old/new endpoint responses matched. All 161 staged tests passed.

The live inbox still sorts each recipient's rows by `created_at` using only a
`user_id` index. A composite `(user_id, created_at)` index is a candidate for
a future schema phase if inbox volume grows. No schema or write path changed.

Applied with `Apply-NotificationsQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 8 (attendance history; installed)

`GET /eu-connect/api/dtr/history` now carries the exact personal,
internship-specific total in its paginated row query. The `dtr.*` projection
preserves the former `SELECT *` fields; the internal `total_dtrs` value is
removed before JSON serialization. Populated pages use one database statement
instead of two. An empty page still runs the original count query.

`GET /eu-connect/api/searched-user/dtrs/:studentId` likewise carries its
total with the paginated rows, retaining the original join to ongoing,
non-deleted internships in both the page and count. Populated pages use one
statement instead of two; empty pages retain the original count fallback.
Thirty live old/new responses matched across users, limits, offsets, and empty
pages. All 164 staged tests passed.

`GET /eu-connect/api/internship-records/dtr/:internshipId` already makes one
bounded `LIMIT 500` history read after `verifyRecordAccess`; its query and
authorization were left unchanged. The three 30-second history cache rules,
open-shift bypass, ordering, response shapes, and mutation invalidation remain
unchanged. No schema or write path changed.

The live `daily_time_records` table has 21 rows and only user-ID and
internship-ID secondary indexes. The current plans still sort dates, and the
record-specific read scans this small table. Composite indexes such as
`(user_id, internship_id, created_at)` and `(internship_id, clock_in)` are
candidates for a later schema phase if larger data justifies their write cost.
No production-scale latency improvement was measured.

Applied with `Apply-AttendanceHistoryQueryOptimization.ps1`.

## Query optimization: Priority 2, phase 9 (weekly narrative history; installed)

`GET /eu-connect/api/weekly-narratives/history` now joins its existing
aggregate statistics to the paginated narrative read. A populated page uses
one database statement instead of two. The count, maximum week, trimmed-space
word calculation, and `YEARWEEK(..., 1)` this-week count remain identical.
Internal aggregate columns are removed from narrative JSON. An empty page
still runs the original aggregate query so stats and pagination remain correct.

`GET /eu-connect/api/searched-user/weekly-narratives/:searchedUserId` carries
its total with the page rows while keeping the ongoing, non-deleted internship
join. A populated page uses one statement instead of two; empty pages retain
the original count fallback. Twenty-four live old/new responses matched
across users, pages, limits, and empty results. All 167 staged tests passed.

`GET /eu-connect/api/internship-records/weekly-narratives/:internshipId`
already makes one `LIMIT 100` read after `verifyRecordAccess`; it was left
unchanged. The three 30-second cache rules, ordering, response shapes,
authorization, and write invalidation remain unchanged. The live table has
only two narratives and already indexes `(user_id, internship_id)` and
`internship_id`; its date/week sorts remain. Composite ordering indexes are
candidates for a later schema phase if table growth justifies them. No schema,
write path, or production-scale latency claim changed here.

Applied with `Apply-WeeklyHistoryQueryOptimization.ps1`.

## Query optimization: Priority 3, phase 1 (evaluation reads; installed)

The seven requested reads now group joined score rows with per-evaluation
category maps instead of searching the accumulated category array for every
row: `/student-evaluations/:studentId`, `/student-past-evaluations/:studentId`,
`/evaluations/all`, `/evaluations/disputed`, `/evaluations/pending`, and
`/internship-records/evaluations/:internshipId`. The submitted list
`/evaluations/submitted` now buckets scores by master once instead of filtering
all scores once per master. Category order, totals, dates, status labels,
reviewer fields, response shapes, SQL filters and record authorization stay
unchanged. Four new tests exercise all seven endpoints with repeated and
interleaved score rows; the full suite passed **171/171**.

No SQL, index, schema, write path, or cache invalidation was changed. Read-only
live schema inspection confirmed indexes on both score tables'
`evaluation_master_id`, student-evaluation masters' `internship_record_id`,
employer-evaluation masters' `internship_record_id` and `student_id`,
internship records' `user_id`, and profiles' `user_id`. The live tables contain
about two student-evaluation masters and one employer-evaluation master.
Composite filter/order indexes are possible future candidates only after
larger representative data and `EXPLAIN` show a real bottleneck. No
production-scale latency improvement was measured.

`/student-evaluations/:studentId` retains its existing first-internship
payload selection and joined-row category behavior. Restricting its query to
one internship could change response data and needs a separate contract review.

## Query optimization: Priority 3, phase 2 (evaluation printing; reviewed)

`GET /eu-connect/api/evaluations/student/:evaluationId/print` already makes a
primary-key header lookup followed by one score lookup only after student
ownership and completed-status checks. Live `EXPLAIN` for an existing
evaluation uses the evaluation and internship primary keys, indexed profile
and academic-user joins, and the department primary key. The score query uses
the existing `student_evaluation_scores(evaluation_master_id)` index and
criteria primary key; it sorts the matching scores by category and criterion
ID. Current data has two scored evaluations with at most 29 scores each.

No SQL, index, controller, route, response, or cache change was justified by
that plan. A new regression test covers print JSON, category/item ordering,
missing evaluations, ownership, incomplete status, and non-student denial.
The full suite passed **172/172**. Revisit the sort only if realistic cohort
data or latency measurements show it is material.

## Query optimization: Priority 3, phase 3 (profiles; installed)

For `GET /eu-connect/api/account/user`, the student branch now selects that
user's maximum academic-record ID through a correlated lookup instead of a
derived table grouping every user's academic records. It retains the exact
latest-ID rule, joins, response columns, 404 behavior, and 300-second cache.
The live schema already has `(user_id, id)` on `student_academic_info`.
Old/new result rows matched for all seven current academic-profile owners;
the new `EXPLAIN` plan uses a keyed user lookup and optimizes the scalar
maximum subquery away. One regression test covers the student projection and
single-ID query parameter.

`GET /eu-connect/api/searched-user/:searchedUserId` was reviewed without a
query change. Its live plan starts from the requested user's primary key and
uses keyed profile, academic, internship, department-head and employer joins.
It returns one target and performs a supplementary supervision lookup only
for relevant viewer/target role pairs. Existing tests cover viewer-specific
supervision, cache isolation, and partial-lookup cache bypass. The current
academic table has seven rows with no per-user history yet; changing the
searched route's unspecific academic-row selection would change its contract
once a student has multiple rows. No index, write path or cache rule changed.
The full suite passed **173/173**; no production-scale speedup was measured.

## Query optimization: Priority 3, phase 4 (internship overview; installed)

`GET /eu-connect/api/internship-records/overview/:internshipId` now returns
the DTR, weekly narrative and document counts as indexed scalar subqueries
in its detail statement. It also selects the latest academic record for the
record's student with a correlated `MAX(id)` lookup using the existing
`student_academic_info(user_id, id)` index. The three separate count queries
and the all-user latest-academic derived table are gone. Each uncached
request executes three fewer database statements; an admin request now uses
the access check and one detail query. Department heads still execute their
additional department-access check.

Read-only old/new query results matched for all three current internship
records. Live `EXPLAIN` shows indexed `internship_id` reads for each count;
the academic maximum subquery is optimized away. The 30-second cache still
runs after `verifyRecordAccess`, including on hits. Count meanings,
percentage rounding, response fields, errors, write invalidation and access
rules are unchanged. One new query-contract test and the updated cache mock
cover the consolidated row; **174/174** tests pass. No schema or write path
changed, and no production-scale latency improvement was measured.

## Query optimization: Priority 3, phase 5 (search history; installed)

`GET /eu-connect/api/search-history` now looks up each searched user's latest
academic row through a correlated `MAX(id)` on the existing
`student_academic_info(user_id, id)` index instead of joining a grouped
derived table. The history viewer/type filter, `updated_at DESC` ordering,
10-row limit, polymorphic non-user rows, response fields and errors are
unchanged. Old/new result arrays matched for all eight current viewer/type
pairs. Two new tests cover the query contract, empty results, and validation;
**176/176** tests pass. No route, write path or cache was changed.

Live `EXPLAIN` uses the existing `search_history(user_id, type, created_at)`
index for filtering but still sorts by `updated_at`. A future
`(user_id, type, updated_at)` index is worth considering only after realistic
history growth and timing evidence; the live table currently has ten rows.
The old derived query was already optimized as a lateral lookup in the
current database, so this simplification is not a measured speedup. No
schema change was made.

## Query optimization: Priority 3, phase 6 (document lists; installed)

`GET /eu-connect/api/searched-user/files/:searchedUserId` now carries the
global requirement-type count in its internship query, eliminating one
statement for every nonempty internship list. It buckets accepted/unmarked
documents by `internship_id` once instead of filtering the full document
array for each internship. Internship order, per-internship file order,
distinct requirement counting (including the original null behavior),
completion rounding, response fields, empty results, and 30-second cache
are unchanged. Read-only old/new results matched for all 17 current users:
two with internship records and 15 empty results.

`GET /eu-connect/api/internships/files`,
`/searched-user/employer-uploaded-files/:searchedUserId`, and
`/internship-records/documents/:internshipId` already use one scoped document
query each. Live plans use existing `internship_documents(user_id)` or
`(internship_id)` indexes and primary-key metadata joins. Their SQL and
response shapes were left unchanged, as were record access checks before
cache hits. Two new tests cover all four endpoint contracts and grouped
counts; the existing cache mock now supplies the count in the internship
row. **178/178** tests pass.

The live document table has 16 rows. Each list still sorts by `created_at`
after its scoped lookup; composite filter/order indexes should be considered
only with representative growth and measured latency. No schema, write path,
cache rule or production-scale performance claim changed here.

## Query optimization: Priority 3, phase 7 (saved annual reports; installed)

`GET /eu-connect/api/reports/annex-c` now carries the filtered report total
with each populated page row. A populated page uses the paginated report and
batched-entry queries instead of a separate count, page, and entries query.
The internal `total_reports` field is removed from JSON. Empty pages run the
original filtered count as a fallback; an out-of-range page now returns an
empty `reports` array with the correct total instead of building invalid
`IN ()` SQL. Year/search filters, degree-program ordering, page/limit rules,
entry grouping and response fields are preserved. Five live old/new SQL
cases matched for nonempty and empty pages; three new tests cover populated,
empty/out-of-range, and detail contracts. **181/181** tests pass.

`GET /eu-connect/api/reports/annex-c/:reportId` remains a primary-key parent
read followed by an indexed `report_id` entries read ordered by `sort_order`.
Live data has two saved reports with three entries each; its sort is small.
No detail query or index change was justified. Both reads retain their
database-backed Registrar/admin check before the 60-second cache lookup,
and annual mutation invalidation is unchanged. The existing
`(academic_year, degree_program)` report index supports the list filter and
order. No schema or write path changed, and no production-scale speedup was
measured.


## Database connection collation

The mysql2 pool explicitly negotiates UTF8MB4_GENERAL_CI, matching the existing utf8mb4_general_ci session setting. Setting only collation_connection while leaving the driver at its unicode_ci default can produce error 1267 (Illegal mix of collations) in prepared parameter/literal comparisons, including announcement visibility checks. Keep both aligned when changing connection configuration. No table conversion or SQL migration is required for this fix; restart/redeploy the backend to replace existing connections. Regression coverage: tests/db-collation.test.js checks configuration without accessing a database; live deployment verification is separate.


## DTR longitude storage

Apply scripts/2026-10-29-dtr-longitude-range.sql to widen daily_time_records.lon_in and lon_out from DECIMAL(10,8) to DECIMAL(11,8). The previous type cannot store valid Philippine longitudes above 99.99999999. Latitude types, GPS validation, geofencing and hour calculations are unchanged. Coordinate storage range failures return a safe actionable 503 message, distinct from the 422 outside-area response; they do not imply the student is outside the attendance radius. Deploy the backend and apply the SQL separately. No live migration was executed.

## Frontend manual contract audit (October 30, 2026)

The companion frontend shares Help/page instructions through role-filtered guides and records feature coverage in docs/manual-audit.md. When changing policies, keep the relevant user guidance aligned with actual API behavior: setup/recovery expiry and generic responses, per-student grouped supervision pagination versus placement stats, student/staff completion differences, author soft-deletion versus staff purge, upload/preview limits and calendar/rotation date rules. Company rotation guidance remains read-only for staff; its manual never grants editing capability. This audit changes frontend guides and documentation only, plus a rotation info button; it does not add the proposed Activities feature or change backend logic.

- Help support contacts: GET /help/admin-contacts in searchedUserRoutes is authenticated and limited to student/department_head (also checked in the handler). Read active, non-deleted admin account email and user_profiles.contact_number; return only name/email/contact_number with usable values. Empty is success, failures remain errors, private/no-store. Never expose the admin account-management response or credentials. Employer Help directs to Feedback & Concerns instead.

- EmailJS invitation/recovery design is maintained in docs/emailjs-account-template.html, with setup instructions in docs/account-invitations.md. Keep the existing heading/username/instructions/expiry_text/setup_url variables, normal double braces and authenticated default sender. Template body is saved separately in the EmailJS dashboard; do not claim that Git deployment updates it or that styling guarantees inbox delivery. No real tokens or recipient details in committed previews.

- Employer announcement access is now opt-in: apply scripts/2026-10-30-announcement-employer-visibility.sql, then deploy matching apps. visible_to_employers defaults to 0 for old/new posts; only allowed authors can change it. Employer feed/pinned/count/direct links and notification opens recheck the current flag, including Department posts. Grant alerts only on first visibility transition; revoke employer alerts and emit announcements_changed after commit. School department scope/category rules and employer Calendar exclusion remain. Never allow employer mutations.

Department-category announcement cards and expanded content show the author department name and acronym to employer and admin viewers. The API adds nullable author_department_name/author_department_code to pinned, regular, direct-link and update responses using the author's current department assignment, consistent with existing feed scope. Missing details display a dash; General posts omit the label. No additional migration or environment changes; deploy both applications.

### Automatic tagged audience

Tags always force tagged_students_only=1 on create/edit using persisted tags, even when a stale client submits broad mode. Existing tagged posts require scripts/2026-10-31-tagged-announcements-default-private.sql after the earlier tag-table and targeted-audience migrations; it updates only the audience flag, with no schema change or new notifications. Live feed/direct/calendar/inbox guards enforce the restricted audience. Keep author/admin viewing, involved student/head notifications and optional current-supervisor sharing. Broad posts must have no tags.


### Announcement mutation reliability

Announcement mutations: edit recipient reconciliation compares live eligible users before and after the write under the announcement lock, independently of existing alerts. Ordinary edits must not recreate dismissed notifications; only newly eligible recipients are notified. Remove out-of-audience UUID and legacy numeric-link alerts. Pin accepts only numeric/string 0 or 1; admin may pin any existing post, heads must pass fresh DB department/Registrar and targeted viewing checks. Pin commits before silent announcements_changed events; socket failures do not report the saved pin as failed. Existing client listeners refresh announcement, notification and calendar queries. No new SQL/schema/env settings are needed for these mutation fixes; earlier tagging migrations remain required.
## Department evaluation criteria (November 6, 2026)

Criteria in both directions belong to `departments` through `department_id`. Run `scripts/2026-11-06-department-evaluation-criteria.sql` before deploying this API; existing questions become CCS questions without changing IDs or historical score references. Management routes allow department heads only, and controllers verify the head's current department in the database and reject Registrar. Student-authored supervisor forms use that student's latest academic department. Employer-authored student forms require the target student's ongoing internship with that employer and use the target's latest academic department. Writes validate every active criterion ID in that department in the same transaction as the evaluation. Do not cache a criteria response across viewers or targets.
## Department Attendance (November 7, 2026)

`GET /dtr/department-attendance` is a paginated read for non-Registrar department heads. Resolve the department from `dept_heads_background_info` on every request and reject REG before querying. Join each student's latest `student_academic_info` row and exclude deleted internships and users; never trust a client department ID. Search, course, internship and clock-in date filters apply to both count and rows. The endpoint returns DTR metadata and photo-path presence; actual photos still require the existing per-record authorized signed-URL route. No schema migration or new environment setting is required.

## Department Student Submissions (November 7, 2026)

`GET /department-submissions` in internship-record routes is non-Registrar department-head only. Resolve the head's current department from the DB, join the student's latest academic row, and exclude deleted internships and users. Apply type, student-name, company, course, internship and submission-date filters to the count and paginated rows alike. Include student-uploaded documents, including legacy rows with NULL `uploaded_by_role` (the student upload path does not set that column), but exclude employer-uploaded documents. Return metadata, not private file paths or report contents; the existing record-detail and download routes remain authoritative for content authorization. No database migration or environment setting is required.

## Department Evaluations (November 7, 2026)

`GET /department-evaluations` in internship-record routes is non-Registrar department-head only. Resolve the head's current department from the DB, join the student's latest academic row, and exclude deleted internships and users. Union employer-authored `student_evaluation_masters` (performance) and student-authored `employer_evaluation_masters` (supervisor) without joining scores, so each evaluation appears once. Apply all filters to both count and page. Return metadata and deleted state only; existing authorized detail endpoints provide scores/comments and staff deletion. Preserve the confidential performance-evaluation boundary. Student-to-supervisor record detail also needs `deleted_at` to label author-deleted evaluations accurately. No schema or environment change is required.
# DTR overtime and auto-close review (2026-11-07)

`scripts/2026-11-07-dtr-overtime-auto-close-review.sql` follows the DTR photo and shift-date migrations. Keep `MAX_SHIFT_HOURS` below 16 as the credit cap. The safety closure is fixed at 16 wall hours; `MAX_SHIFT_WALL_HOURS` is obsolete. The hourly `warnLongShifts` uses `wall_warning_sent_at` to send one reminder at 12 wall hours. `config/autoCloseStaleShifts.js` closes only after 16 wall hours, proposes break-adjusted hours, credits zero, and notifies the student. Historical auto-closed rows are `legacy_credited` and preserve existing credit; they accept an optional student explanation without changing credit or starting a new review. Student overtime request uses an open row and a Manila intended end; assigned employer approves or declines, independent of timing badges. Manual clock-out still requires photo and geofence. Student explanation is required after a new auto-close and before another clock-in, even if the unexplained row is not the latest shift. Employer or non-REG head may then confirm or reduce credit under a row lock; add it to internship accumulated hours exactly once. Keep scoped DTR reads, notification routing, cache invalidation, UI help, and frontend review controls in sync. The frontend dashboard also warns while open after 12 wall hours.
