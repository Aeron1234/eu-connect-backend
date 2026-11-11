# Account response caching

## Phase 1: isolation and bounded storage

The five existing account GET routes retain their 60-second TTL. Authentication,
role checks and rate limiting run before cache access. Keys include the verified
user ID, role, academic context and full request URL, including query parameters.
Requests without verified identity and non-GET requests bypass caching.

Only HTTP 200 JSON is stored. Errors, responses setting cookies and responses
marked `res.locals.skipCache = true` bypass storage. Private responses carry
`Cache-Control: private, no-store` to prevent downstream caching. The server cache
holds at most 1,000 entries, each with at most 256 KiB of serialized JSON, plus
metadata and JavaScript overhead. Cache failures fall back to normal responses.

## Phase 2: freshness

Invalidation occurs after the database write succeeds (after commit for
transactions). It covers:

| Change | Entries invalidated |
| --- | --- |
| Avatar update/reset, profile update | User entries and all account-list pages |
| Account creation | All account-list pages |
| Account activation/deactivation | Target user entries and all account-list pages |
| Course/department creation or activation changes | All create-account-form-data entries |

Route invalidation matches exact paths across users and query variants. An
invalidation generation prevents earlier in-flight reads from repopulating the
cache. This conservatively skips storage for any read overlapping a write.
The response already in flight may still contain its earlier database snapshot.
Partially loaded account form data is returned as before but is never cached.

## Phase 3: verification and operation

Run `npm test` for the focused regression suite. No live database is needed for
the middleware tests. Restart the server to load the changes and discard entries
created by the old implementation. Set `CACHE_ENABLED=false` to bypass caching.

This cache is process-local. Use it with one API worker; disable it for multiple
workers/replicas until a shared store and cross-worker invalidation are implemented.
Database changes made outside these controllers become visible after TTL expiry.
Existing JWT/account-deactivation semantics are unchanged; caching is not an
authentication or token revocation mechanism.

Future expansion should identify each endpoint's data dependencies and successful
write paths before adding caching. Attendance, authentication,
documents and individual evaluations remain uncached. Dashboard coverage is
described below.

## Activity logs

`GET /activity-logs/mine` and admin-only `GET /activity-logs` use a 30-second
TTL after authentication, authorization and rate limiting. User identity and
the complete query string partition the cache, including page and filter values.

`invalidateActivityLogsCache()` clears both routes for all users, pages and
filters. Call it after a successful commit whenever a controller writes logs.
All current log-producing controllers and log deletion are wired this way.
Profile updates also invalidate these views because the admin list joins actor
names from user_profiles. Failed transactions leave cached data intact.

Invalidation is deliberately broad: new or deleted logs can change totals,
page boundaries and filter choices. Supplementary log inserts that fail may
still cause a harmless invalidation when their surrounding transaction commits.
The same single-process restriction and CACHE_ENABLED switch apply.

Activity-log integration tests exercise the real Express router with signed
test JWTs and mocked database connections. They cover user/page/filter isolation,
authorization on cache hits, deletion, rollback and a cross-controller insert.

## Notifications

`GET /notifications` and `GET /notifications/unread-count` use a 15-second TTL
after authentication, role validation and rate limiting. The count-only route
returns `{ unreadCount }` from a recipient-scoped aggregate, without fetching
or joining inbox rows. Keys include the verified user and full query string, so
page, limit and scope variants cannot mix. The inbox response still includes
the inbox-wide unread count for the full notifications page. Marking one/all as
read or deleting a notification invalidates both routes for that recipient
after the successful database write.

`invalidateNotificationsCache(userId)` targets one recipient; omitting the ID
clears all notification entries. Broadcast and cross-controller transactions use
the latter, conservatively covering all recipients and joined dependencies:

- Announcement creation, updates that notify recipients, and deletion.
- Internship creation, approval and completion.
- Student evaluation submission, deletion, response and dispute restoration.
- Supervisor requests, cancellation, supersession, acceptance and rejection.
- DTR-location assignment and certificate upload notifications.
- Profile updates, because notifications display joined sender names.

Transactional invalidation happens immediately after commit, before socket
delivery. The evaluation-deletion event now follows this ordering too; socket
delivery failure does not roll back an already committed deletion. No successful
commit means no invalidation or evaluation-deletion socket event.

As with existing caches, use one API process, or disable with
`CACHE_ENABLED=false`. Out-of-band database edits become visible at TTL expiry.
This change does not introduce socket events for operations that had none; it
makes the next inbox fetch fresh after writes, without adding client refreshes.

## Departments and courses

`GET /departments` and `GET /courses` cache successful JSON for 300 seconds,
after their existing authentication, role and rate-limit checks. Entries remain
isolated by user, authorization context and query string. Existing role access
is unchanged: employers may read courses but not departments.

After creation, activation or deactivation commits, the controller invalidates
all users' entries for the affected list and `/create-account-form-data`.
The other list remains cached because these queries read their own table only.
Failed commits, duplicates, missing records and already-active/inactive requests
do not invalidate caches. Database errors are not cached; empty successful lists
are. The existing in-flight read protection and single-process limitation apply.

## Evaluation criteria

Department-head criteria lists (`/criteria/company-evaluation` and
`/criteria/student-evaluation`) and active-form endpoints
(`/company-evaluation/criteria` and `/student-evaluation/criteria`) are not cached by
the backend response cache. Their answers depend on the head's current database
department or the evaluated student's latest academic department. The employer performance form also depends on the target student's ongoing supervisor relationship; the student company form needs an ongoing internship only.

After criterion creation, individual deactivation/reactivation or section
deactivation/reactivation commits, `invalidateCriteriaCache(tableName)` clears
any legacy response-cache entries for the affected family. Failed transactions
do not invalidate. Historical evaluations and submission validation remain
uncached; soft-deletion behavior is unchanged.

## Internship postings

`GET /internship-postings` and the employer-only `GET /posted-jobs` use a
30-second TTL after existing authentication, authorization and rate limits.
User/context/query isolation preserves ownership and favorite flags as well as
page, limit, mine, favorite, courseId, search and workType variants.

Creation, updates (including course-only edits and status changes), and soft
deletion invalidate both routes for all users after commit. Adding/removing a
favorite invalidates only that student's `/internship-postings` variants.
Failed transactions preserve cache entries. Dashboard summary caching is
described below. Posting course names are joined from courses; current course mutations
only create or change active status, neither of which changes those existing
joined values. Any future course-renaming endpoint must invalidate posting lists.
The existing single-process restriction and CACHE_ENABLED switch still apply.

## Dashboard summaries

Six summary and tracker endpoints use a 15-second TTL: `/dashboard-stats`,
`/employer-dashboard-data`, `/department-head-dashboard-data`,
`/department-head-dashboard/hours-tracker`, `/average-shift-hours` and
`/admin-dashboard-data`. Employer, department-head,
and admin dashboard-data responses include a `stats` object, fetched with their
other data through one pooled connection. Their former standalone stats routes
have been removed.
The department dashboard response includes the first 10 active interns plus
an all-intern course aggregate for the chart. Later tracker pages and
course/name filters use the separate hours-tracker route, which is invalidated
with the other dashboard summaries.
`/posted-jobs` retains its existing 30-second policy. `/student-dashboard-data`
stays uncached because it contains live attendance and location information.

Keys retain user, role, academic context and query-string isolation. Existing
authorization executes before every cache lookup. Overview controllers that
catch individual query failures mark the entire fallback response `skipCache`,
so incomplete results cannot be served repeatedly from cache. Time-dependent
charts may lag a date boundary by at most their TTL.

Shared activity-log invalidation also clears dashboard summaries, covering
account/profile, internship, supervisor, alumni, document and evaluation writes,
and the admin activity chart. Criteria and department/course mutations clear
summaries too. Posting writes clear all summary caches; favorites and personal
notification changes clear summaries only for the affected user. Broadcast
notification invalidation clears summaries for everyone.

DTR commits, committed stale-shift batches, internship restoration and internship
soft deletion invalidate summaries explicitly. All hooks run after successful
database writes/commits. Broad invalidation favors correctness across related
roles and departments over retaining entries during frequent writes. New write
paths must reuse the appropriate helper or call `invalidateDashboardCache()`.

Tests use mocked database connections; live database performance and deployed
multi-worker behavior are not verified. Keep the existing single-process
restriction or disable caching with `CACHE_ENABLED=false`.

## Announcements and categories

`GET /announcements/history` caches successful feeds for 30 seconds;
`GET /announcements/categories` caches category lookups for 300 seconds.
Authentication, existing role checks and rate limits precede cache access.
User, role and department context remain in the key alongside category, search
and page query parameters. Existing pinned/regular response shapes and the
category endpoint's `null` response for an empty table are preserved.

`invalidateAnnouncementsCache()` clears every user's history entries across all
filters/pages after successful creation, editing, deletion, pinning or unpinning.
Profile updates also call it after commit because feeds join author names.
Changing a post's category clears formerly visible copies before any notification
socket event. Existing notification/activity-log/dashboard hooks are preserved.
Failed writes and commits do not clear cached entries.

Department-category announcements remain hidden from employers, visible to
students/department heads only in the author's department, and visible to admins.
The cache preserves the controller's existing SQL visibility rules; it does not
introduce new permissions. Future changes to an author's role or department
assignment must invalidate announcement history after commit.

There are no category mutation endpoints in the current backend.
`invalidateAnnouncementCategoriesCache()` is supplied for future category writes:
it clears both category lookups and feed entries that join category names/colors.
Ordinary announcement writes leave category lookups cached. Out-of-band category
edits currently rely on TTL expiry (30 seconds for feeds, 300 seconds for the
category list) or a process restart. Live database constraints/visibility queries
have not been integration-tested; the regression suite uses mocked SQL results.

## Alumni records and company directory

`GET /alumni-internships` and `GET /company-directory` cache successful JSON for
60 seconds after existing authentication, role and rate-limit checks. User and
authorization context and all query variants remain isolated. Existing grouped
alumni response shapes and merged directory counts are unchanged.

`invalidateAlumniCache()` clears both routes across every user and query after
manual alumni creation, update or deletion and after all six internship lifecycle
commit paths: creation, approval/rejection, staff completion, student completion,
restoration and soft deletion. Completion inserts system alumni records; directory
reads combine alumni with ongoing/finished internships. Invalidation precedes
socket delivery. Failed transactions preserve cached data.

These reads currently serve shared lists to students, department heads and admins;
department restrictions on alumni edits/deletes are preserved. No new read filter
or count deduplication is introduced. Future course renaming or academic
reassignment affecting joined directory fields must call the helper after commit.
Current course active-status changes do not affect the selected directory data.
Out-of-band edits rely on TTL expiry; the existing single-process limitation applies.

Seven additional mocked-database regression tests cover TTLs, filters/context,
authorization, all nine write commit/rollback paths, socket ordering, ownership,
errors and empty reads. The full staged suite passes 72 tests.

## HTE and annual report summaries

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
The staged suite passes 80 tests; application of this phase is pending.

## Past internship records

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
The full staged suite passes 86 tests. This phase awaits installer application.

## Regions and file requirement types

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
staged tests pass; this phase awaits installation. Existing process-local limits
and CACHE_ENABLED apply. No production query-time benchmark was performed.

## Department and admin internship lists

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
live database behavior and performance have not been verified. Application pending.

## Document metadata and completion counts

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

## Historical evaluation lists and summaries

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
This phase awaits installer application. Existing process-local limits apply.

## Weekly narratives

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
invalidation too. All 113 staged tests pass; installation is pending. Production
performance and live database behavior have not been verified.

## Searched-user profiles and internship overviews

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
database and storage are mocked. Installation is pending and production performance
has not been benchmarked. Existing single-process restrictions apply.

## Historical attendance

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
assert attendance invalidation. All 123 staged tests pass; installation pending.
Live database behavior/performance is unverified. Single-process limits apply.

## Saved annual report details

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
0 failed. Database is mocked; live performance is unverified. Installation pending.
# Cache monitoring

The admin-only `GET /eu-connect/api/cache/metrics` reports process-local cache
activity without exposing cache keys, user IDs, query strings or response bodies.
It is read-only and sends `Cache-Control: private, no-store`. Counts are cumulative
since `startedAt`; a flush does not reset them. Compare two snapshots only when
their `startedAt` values match. The frontend `/admin/cache-monitoring` page does
this for its optional 30-second refresh and resets the interval view if the
backend process changes. Storage byte counts are NodeCache estimates, not actual
heap usage. The endpoint does not measure database query latency.
