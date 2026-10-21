# Direct posting and deletion

Each internship allows one active performance evaluation (employer to student)
and one active supervisor evaluation (student to employer). Author deletion
sets `deleted_at` and frees that direction's active slot for a replacement.
The author no longer sees the deleted scores in histories or PDF reads.
Employer performance evaluations remain confidential from students.

Staff record histories include active and deleted evaluations. Deleted entries
are labeled Deleted. Admins may permanently delete already deleted entries;
department heads may do so only for students in their current department,
checked against current database membership. Staff cannot permanently delete
an active entry. Permanent deletion removes scores and linked evaluation
notifications in the same transaction. All successful writes invalidate history
and dashboard caches after commit.

Posting locks the ongoing internship row before checking for another active
evaluation. The migration's composite unique indexes on
`(internship_record_id, active_evaluation)` also protect
against duplicate concurrent submissions. Client forms check availability,
but authorization, start-date checks and duplicate prevention are server-side.
Legacy confirmation/dispute endpoints cannot change evaluation state.

Run `scripts/2026-10-22-evaluation-soft-delete.sql` before deploying this
backend and frontend together. Pause evaluation writes and back up first;
DDL is not transactional. Existing duplicate groups keep their newest entry
active (created_at, then UUID); older entries and all their scores are retained
as deleted history. The supplied export has duplicates in both tables.
Review the script's duplicate lists and this consolidation rule before running.
No live database migration has been executed by Codex.

The SQL is for MariaDB 11.8, matching the supplied export. It adds `deleted_at`
and a generated numeric active flag to both masters, adds unique indexes, then
drops `status` from `student_evaluation_masters` only. The other table never
had that column. Old review notes are retained, with no confirmation UI.

The corrected migration also resumes a partial run of the earlier script that
failed with MariaDB error #1901. Existing `deleted_at` columns are skipped and
already archived duplicates keep their timestamps. The generated expression
now reads only `deleted_at` and returns 1 for active rows or NULL for deleted
rows; the internship ID stays an ordinary column in the composite index.
This avoids generating a copy of the CHAR foreign-key column. No runtime code
changes or environment variables are required for this SQL correction.
