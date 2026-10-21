# Weekly narrative coverage dates

Run `scripts/2026-10-22-weekly-narrative-date-range.sql` before deploying the
backend and frontend together. It adds nullable `date_from` and `date_to` DATE
columns and can safely be rerun on MariaDB. No live database changes were made
by Codex. Existing rows stay NULL because submission time and week number do
not establish the actual dates covered.

Creation and editing require both calendar dates in YYYY-MM-DD format and
reject impossible dates, timestamps, partial ranges and reversed ranges with
400. Same-day ranges are valid. The existing owned, ongoing internship lock
and Philippine start-date restriction still apply. Dates are saved in the
same transaction as the narrative, and caches clear only after commit.

Student history, searched-user history, staff internship record history and
the print endpoint all return date-only strings via DATE_FORMAT to prevent
timezone shifts. Old entries remain readable/printable with an unset range.
