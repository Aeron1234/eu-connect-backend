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

`GET /notifications` uses a 15-second TTL after authentication, role validation
and rate limiting. Keys include the verified user and full query string, so page,
limit and scope variants cannot mix. The response includes the inbox-wide unread
count, so marking one/all as read or deleting a notification invalidates every
cached page and scope for that recipient after the successful database write.

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

The two admin criteria lists (`/criteria/employer-evaluation` and
`/criteria/student-evaluation`) and both active-form endpoints
(`/evaluation-criterias` and `/student-evaluation/criteria`) use a 300-second TTL.
Authentication, existing role checks and rate limiting still precede caching.
User identity, authorization context and query strings separate entries,
including `includeInactive=true`. Response shapes are unchanged.

After criterion creation, individual deactivation/reactivation or section
deactivation/reactivation commits, `invalidateCriteriaCache(tableName)` clears
both admin and form caches for that criteria table across all users and query
variants. The other evaluation type stays cached. Failed transactions do not
invalidate. Historical evaluations and submission validation remain uncached;
soft-deletion behavior is unchanged. Existing process-local limitations apply.

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

Eight summary endpoints use a 15-second TTL: `/dashboard-stats`,
`/employer-dashboard-stats`, `/employer-dashboard-data`,
`/department-head-dashboard-stats`, `/department-head-dashboard-data`,
`/average-shift-hours`, `/admin-dashboard-stats` and `/admin-dashboard-data`.
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
