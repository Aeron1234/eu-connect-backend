# EU Connect backend — agent handoff

Updated: 2026-09-30 (Asia/Manila).

## Purpose and scope

This file records the backend analysis and caching work completed in the prior
chat. Read the actual checkout before editing: this handoff does not install the
implementation, and another project may have different files or dependencies.
Merge these instructions with an existing AGENTS.md rather than overwriting it.

Document metadata caching is implemented in this package. All **100 tests**
pass in staging; installation is pending. The user confirmed **95 tests passed**
after the staff-list phase. Future priorities are recommendations.

## System overview

- Project: `ims-backend`, the EU Connect internship management backend.
- Original checkout: `C:\Users\Admin\Desktop\Dev-Projects\Nextjs-Workspace\ims-backend`.
- Node.js ES modules, Express 5, MySQL through `mysql2/promise`.
- `server.js` mounts routes under `/eu-connect/api`.
- Controllers contain business logic, SQL queries and transaction handling.
- Roles: `student`, `employer`, `department_head`, `admin`.
- JWT authentication accepts bearer tokens or access-token cookies and populates
  **`req.verifiedUser`**, not `req.user`.
- Access tokens last 15 minutes; refresh tokens rotate and have database-backed
  hashed records. Temporary-password emails use Resend and React Email.
- Supabase stores uploaded files. Socket.IO delivers notifications to user rooms.
- Background jobs close stale attendance shifts and clean up refresh tokens.
- Main flows: internship submission/approval/completion, supervisor requests,
  geofenced attendance, daily/weekly narratives, documents, evaluations/disputes,
  announcements, alumni records, reporting and role-specific dashboards.

The initial analysis was source-level. The frontend and live database schema
were not comprehensively reviewed. No schema/migration files or working test
suite were found initially; focused caching tests were added during this work.

## Current state and collaboration rules

- Preserve existing user work. The original checkout has many modified and
  untracked files; no commits or pushes were made by this work.
- Account caching changes already existed when the review began. They were
  corrected and extended rather than discarded.
- User confirmed **95 passing tests** through staff internship lists. Document
  metadata staging passes **100 tests, 0 failed**; application pending.
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
| Notifications        | `/notifications`                                                                | 15 seconds  |
| Departments/courses  | `/departments`, `/courses`                                                      | 300 seconds |
| Criteria admin lists | `/criteria/employer-evaluation`, `/criteria/student-evaluation`                 | 300 seconds |
| Criteria forms       | `/evaluation-criterias`, `/student-evaluation/criteria`                         | 300 seconds |
| Internship postings  | `/internship-postings`, `/posted-jobs`                                          | 30 seconds  |
| Dashboard summaries  | Eight endpoints listed below                                                    | 15 seconds  |
| Announcements | `/announcements/history` | 30 seconds |
| Announcement categories | `/announcements/categories` | 300 seconds |

| Alumni and company directory | `/alumni-internships`, `/company-directory` | 60 seconds |

| HTE and annual summaries | `/reports/academic-years`, `/reports/hte-annual/companies`, `/reports/hte-annual/company`, `/reports/annex-c` | 60 seconds |

| Past internship records | `/internships/my-past-internships` | 60 seconds |

| Reference lookups | `/regions`, `/internships/files/requirements` | 300 seconds |

| Staff internship lists | `/internship-records/department`, staff `/internships/all`, `/internships/active/all` | 30 seconds |

| Document metadata | Own files, grouped student files/counts, employer uploads, record documents | 30 seconds |

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
mocked and installation is pending. Existing single-process restrictions apply.

### Department and admin internship lists

The staff views /internship-records/department, /internships/all and
/internships/active/all cache for 30 seconds (paths under /eu-connect/api).
Only department_head/admin reads participate. Student /internships/all reads
remain uncached. Existing response shapes and route guards are preserved.

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
(all under /eu-connect/api). Saved /reports/annex-c/:reportId detail reads stay
uncached. Full query strings and user/role/department context partition entries.

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
2. `/employer-dashboard-stats`
3. `/employer-dashboard-data`
4. `/department-head-dashboard-stats`
5. `/department-head-dashboard-data`
6. `/average-shift-hours`
7. `/admin-dashboard-stats`
8. `/admin-dashboard-data`

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
- `tests/past-internships-cache.test.js`
- `tests/reference-cache.test.js`
- `tests/staff-internships-cache.test.js`
- `tests/document-metadata-cache.test.js`

Latest staged result: **100 tests, 100 passed, 0 failed**. Last user-confirmed
installed result: **95 tests, 95 passed, 0 failed**. Report tests cover current
Registrar authorization on hits, query/context isolation, TTLs, uncached saved
details, annual writes and rollback, and failed post-commit rereads. Existing
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

## Next work

1. Apply this package with `Apply-DocumentMetadataCache.ps1`, verify all 100 tests,
   and restart the backend if automatic reload is not enabled. Update installation
   status after the user provides the result.
2. Measure current cache effectiveness before selecting further endpoints.
   Trace permissions, joins and mutation dependencies before selecting coverage.
3. Measure cache hit rates and database query time before expanding indefinitely.

Keep authentication, clock-in/out validation and live attendance reads uncached.
Multiple API instances need shared cache invalidation before relying on the local
cache. Future instructions should update this docs/AGENTS.md handoff after each
phase, including test status and remaining work.

## Known findings outside completed scope

The initial review identified these concerns; they were not fixed by caching:

- Socket room membership accepts a client-supplied user ID without identity
  verification in the reviewed `server.js`.
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
reports, past internships, reference lookups and staff internship lists.
Latest user-confirmed result: 95 passing tests after `Apply-StaffInternshipsCache.ps1`.
`Apply-DocumentMetadataCache.ps1` updates this handoff and caching.md and awaits
application. Use verified current files and paths when continuing elsewhere.
