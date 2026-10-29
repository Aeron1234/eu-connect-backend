# Evaluation posting and deletion

Employers can submit multiple performance evaluations for the same ongoing
internship, so departments can review progress at their required intervals.
Earlier active evaluations do not block another review. There is no automatic
200-hour gate or department-specific configuration. Each submission has its own
master ID, scores, submitted date, history entry, notification and printable PDF.
The legacy complete-summary endpoint continues to return its latest master;
history and record-detail endpoints include the individual evaluations.

Student-authored supervisor evaluations still allow one active entry per
internship. Soft-deleting that entry frees its slot for a replacement. Accepted
supervision and Philippine internship-start checks remain enforced on submission
in both directions. Forms post immediately without a confirmation/status step.
Performance evaluations remain confidential from students.

Author deletion sets `deleted_at` and hides only that evaluation from the author's
history and PDF reads. Scores and other evaluations are retained. Staff histories
include deleted entries with a Deleted label. Admins may permanently delete only
already deleted entries; department heads may do so only within their current
database-verified student department. Purge removes that evaluation's scores and
linked notifications transactionally. Successful writes invalidate caches after
commit. Notifications target the internship record and identify each evaluation
with its own `link_uuid`.

Submission locks the ongoing internship row before checking assignment and start
date. Only student-authored supervisor feedback checks for an existing active
evaluation, protected by `uq_employer_evaluation_active_slot`. Performance posting
does not check for an existing master. Availability reads are private/no-store
and fail closed on errors; submission remains authoritative. Existing submission
rate limits apply. Legacy confirmation/dispute endpoints remain retired.

## Deployment and SQL

Back up first. For databases with the October 22 soft-delete baseline already
installed (including the latest supplied Layerbase export), run only
[`2026-10-29-multiple-performance-evaluations.sql`](../../scripts/2026-10-29-multiple-performance-evaluations.sql),
then deploy the matching backend and frontend. This MariaDB 11.8 migration drops
only `uq_student_evaluation_active_slot`, preserving all evaluation rows, scores,
deleted timestamps, the nonunique internship foreign-key index and the harmless
generated active flag. It is safe to rerun. No environment or package changes
are required. The API reports a schema-upgrade error if the old index still
rejects a subsequent performance evaluation.

For an older schema without soft deletion, apply
[`2026-10-22-evaluation-soft-delete.sql`](../../scripts/2026-10-22-evaluation-soft-delete.sql)
first, following its duplicate-consolidation review, then the October 29 upgrade.
Never replay that historical baseline after enabling multiple reviews: it would
archive older active performance entries and recreate the retired index.
The new migration does not restore previously deleted historical entries.
DDL commits implicitly. No live database migration was executed by Codex.
