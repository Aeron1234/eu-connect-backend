# Bulk DTR Location Assignment

Individual location controllers also live here in `individualDtrLocationController.js`: student current-location lookup and profile location lookup/set/remove. `dtrLocationRoutes.js` owns their registrations, including the unchanged `/dtr/setted-location` and `/searched-user/set-dtr-location/:studentId` (GET) / `:searchedUserId` (PUT/DELETE) URLs. Preserve each route's original role checks, department guard, multipart parser and limiter. Attendance clock/break/history controllers remain in `features/dtr`; profile/document controllers remain in `features/users`. This is a source organization change, with no frontend, API URL, SQL or environment migration.

Frontend: `/dtr-locations`. Canonical APIs (also mounted under the compatibility prefix):

| Method | Endpoint | Contract |
| --- | --- | --- |
| GET | `/api/v1/dtr-locations/students` | Ten ongoing internship rows/page, current assignment or company fallback, scoped department/course choices |
| GET | `/api/v1/dtr-locations/pins` | All custom locations in the authorized current filters, grouped by eight-decimal coordinates; independent of table pagination |
| POST | `/api/v1/dtr-locations/assign` | 1–100 distinct `internshipIds`, `lat`, `lon`, optional `radius_meter` (150), `address`, `label` |

## Authorization and relationships

All endpoints require a verified admin, department head or employer token. Admin sees all ongoing, nondeleted internships of nondeleted users. Heads are resolved against `dept_heads_background_info` joined to `departments` on every request; missing membership and department code `REG` deny access. A student's **latest** `student_academic_info` row determines their department/course. Employers must match the ongoing record's `employer_id` (the accepted supervision assignment). Student roles cannot use this tool. Both reads and writes apply scope; grouping happens only after authorization, so shared physical sites do not expose other students.

Reads accept `search` (student first/last name, max 100 literal characters). Admin accepts `departmentId` and `courseId`; non-Registrar heads accept only `courseId`; employer accepts neither. Course choices use the selected department within role scope, independent of the name search. Department choices come from accessible ongoing interns. Invalid/unsupported filters return 400. Page numbers are validated, clamped to available pages; ordering is last name, first name, internship ID. Responses are private/no-store, with no server route cache. Pins show custom overrides, not company fallback pins.

## Save, attendance and notifications

Changed overrides and their notifications use bounded multi-row statements, avoiding one remote database round trip per student. Heads' current membership is also locked during writes. Activity logs use action `dtr_locations_assigned` and module `dtr_locations`; the frontend supplies their readable labels. A completely successful/unchanged save clears the draft preview so the updated saved pin can be opened; a partial result keeps the draft for the remaining selections.

`dtr_locations.internship_id` is unique. Bulk and profile editors share `locationRules.js`: finite legal coordinates rounded to the stored eight decimals; whole-number 20–2,000 m radius; default 150; nullable trimmed label/address capped at the actual 255-character database fields. The existing single editor now uses this same validation. No company coordinates, prior DTR rows, dates or hours are changed. Existing attendance reads still prefer the custom location and otherwise use company coordinates with 150 m; both clock-in and clock-out continue their existing distance/start-date/attendance checks.

Inside a transaction, recheck authorized ongoing records and lock in internship-ID order. Inaccessible, transferred, deleted, finished or no-longer-supervised selections receive a generic per-record failure without disclosing hidden names; other authorized selections may succeed. Identical location/radius/note/address returns `unchanged` with no duplicate notices. Upsert changed assignments, create each student's `dtr_location_set` notification with location/radius and attendance instructions, then (only for admin/head actors) group successfully changed students by `employer_id` for one employer notification per action. Missing supervisors are skipped; their students still receive notices. Write one readable activity log for the changed set. All these writes commit together. Unexpected write/notification/commit failure returns a safe error and attempts rollback; no socket success is emitted before commit. A lost response/commit confirmation is an unknown outcome: refresh before retrying, never automatically retry a mutation.

After commit invalidate notification/activity-log server caches; emit `new_notification` only to each verified user's existing room and `dtr_locations_changed` to the actor. New student alerts link to `/student`, supervisor alerts to `/dtr-locations`; legacy location alerts remain readable at `/notifications`. Socket delivery is best effort; persisted notices are authoritative. The frontend refreshes its table/pins after save and relevant events, preserves failed selections and masks stale data on 401/403. It also invalidates the actor's profile/record DTR queries. Reads/focus/manual refresh recover when sockets disconnect.

## Database / deployment

Run the read-only verification migration [2026-10-30-bulk-dtr-locations.sql](../../scripts/2026-10-30-bulk-dtr-locations.sql) on the intended database first. Expected structures are listed in the file. No ALTER/CREATE, backfill, new notification enum, group table, environment variable or dependency is needed for the inspected schema. Existing foreign keys, unique internship index, decimal coordinates and notification fields already support this feature. Do not rerun unrelated historical migrations or rewrite current assignments. If a check differs, inspect that deployment's schema before changing it. Deploy both repositories together.

Regression: `node --test tests/bulk-dtr-locations.test.js tests/dtr-location-notifications.test.js tests/lookup-edit-and-location-removal.test.js`. Tests use an in-memory relational fixture, not the configured database; mounted route tests bind loopback only. SQLite translation tests relationships/transactions, not MySQL locking itself; manually verify concurrent edits and real map/geocoding in a staging environment.

The relevant verification queries are included in the migration file; for example:

```sql
SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dtr_locations'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
  AND COLUMN_NAME IN ('type', 'link', 'link_uuid');
```

Verify the existing unique internship index and `dtr_location_set` type first, deploy the backend second, then deploy the matching frontend and check each permitted role. No UPDATE/backfill is run: saved overrides are immediately available to the new table and pin grouping. Do not add a second location table or rebuild existing records.
