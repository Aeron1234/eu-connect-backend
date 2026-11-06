# Evaluation posting and deletion

Employers can submit multiple performance evaluations for the same ongoing
internship, so departments can review progress at their required intervals.
Earlier active evaluations do not block another review. There is no automatic
200-hour gate or department-specific configuration. Each submission has its own
master ID, scores, submitted date, history entry, notification and printable PDF.
The legacy complete-summary endpoint continues to return its latest master;
history and record-detail endpoints include the individual evaluations.

Students can also submit multiple supervisor evaluations during the same ongoing
internship. Earlier evaluations do not need to be deleted first. Both directions
require an accepted supervisor and an ongoing internship; the Philippine
internship-start check applies to employer-authored performance reviews.
Forms post immediately without a confirmation/status step.
Performance evaluations remain confidential from students.

Author deletion sets `deleted_at` and hides only that evaluation from the author's
history and PDF reads. Scores and other evaluations are retained. Staff histories
include deleted entries with a Deleted label. Admins may permanently delete only
already deleted entries; department heads may do so only within their current
database-verified student department. Purge removes that evaluation's scores and
linked notifications transactionally. Successful writes invalidate caches after
commit. Notifications target the internship record and identify each evaluation
with its own `link_uuid`.

Submission locks the ongoing internship row before checking assignment.
Neither direction checks for an existing active evaluation. The supervisor
evaluation unique index `uq_employer_evaluation_active_slot` must be removed
by the November 4 migration. Availability reads are private/no-store
and fail closed on errors; submission remains authoritative. Existing submission
rate limits apply. Legacy confirmation/dispute endpoints remain retired.

## Deployment and SQL

Back up first. For databases with the October 22 soft-delete baseline already
installed (including the latest supplied Layerbase export), run
[`2026-10-29-multiple-performance-evaluations.sql`](../../scripts/2026-10-29-multiple-performance-evaluations.sql),
if not yet applied, followed by
[`2026-11-04-multiple-supervisor-evaluations.sql`](../../scripts/2026-11-04-multiple-supervisor-evaluations.sql),
then deploy the matching backend and frontend. The November migration drops only
`uq_employer_evaluation_active_slot`, first adding a nonunique internship index
so the existing foreign key remains supported. Both migrations preserve rows,
scores and deleted timestamps and are safe
to rerun. No environment or package changes are required. The API reports a
schema-upgrade error if an old index still rejects another evaluation.

For an older schema without soft deletion, apply
[`2026-10-22-evaluation-soft-delete.sql`](../../scripts/2026-10-22-evaluation-soft-delete.sql)
first, following its duplicate-consolidation review, then both upgrades in date
order. Never replay that historical baseline after enabling multiple reviews: it
would archive older active entries and recreate the retired indexes.
The new migration does not restore previously deleted historical entries.
DDL commits implicitly. No live database migration was executed by Codex.
# Department-owned criteria

Run `scripts/2026-11-06-department-evaluation-criteria.sql` after backing up the database and before deploying the paired API and frontend. The migration adds `department_id` to both criteria tables and assigns all existing questions to CCS without changing criterion IDs. Non-Registrar department heads manage only their own department's questions. Students receive supervisor evaluation questions for their latest academic department; employers receive performance questions for the supervised ongoing student's department. Both forms submit stable criterion IDs, and the backend checks that each active question is answered exactly once. Departments without active questions must add them before an evaluation can be submitted. Historical scores retain their existing criterion references. No new environment variables or dependencies are needed.
