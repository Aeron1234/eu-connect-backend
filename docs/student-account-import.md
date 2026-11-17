# Student account creation and CSV import

Administrators can use the existing manual form or the optional Import CSV tab at /admin/create-account. Bulk creation currently supports students. Employer, department-head and admin usernames remain manually entered.

## Student names and school IDs

Manual creation displays an automatically generated, read-only username as the administrator enters the first name, last name and optional school ID. Both servers use the same identity helper. Spaces/punctuation are removed from name portions while letters, numbers and original capitalization are retained. School IDs are normalized to uppercase and accept letters, numbers and single hyphens.

Dela Cruz + John Carlo + A24-0483 becomes DelaCruz.JohnCarlo.A24-0483. Without an ID, the username starts as DelaCruz.JohnCarlo. If already taken, the backend assigns .2, .3 and so on, shortening only the name base if needed to stay within 50 characters. The actual saved username is shown after creation and in the invitation. A username including a school ID is rejected when already taken, rather than receiving a suffix.

The canonical new ID is stored as nullable user_profiles.school_id with a unique index and also written to the new student's student_academic_info.student_number for existing readers. Duplicate checks include historical student_number values and all accounts, including inactive ones. Existing usernames and school numbers are preserved. Existing rows have NULL school_id; this migration does not infer or rewrite them. Account profile reads prefer school_id and fall back to the previous student_number. Neither profile editing nor importing changes an existing username or school ID.

First/last names and usernames must fit 50 characters, school IDs 30 characters, and email addresses 50 characters, matching the inspected schema. Keep frontend and backend studentIdentity.mjs files identical. No passwords belong in the CSV.

## CSV workflow

1. Open Import CSV and download the template.
2. Use UTF-8 CSV. Headers are first_name,middle_initial,last_name,email,school_id,course_code,gender. Middle initial and school ID columns may be omitted. All remaining columns are required.
3. Use male or female for gender and exactly one active course's short_name for course_code. An unknown or ambiguous course code must be corrected. The student department is derived from that course.
4. Upload up to 100 students in a file no larger than 256 KB. Validate and preview before confirming. Quoted values, escaped quotes, BOM and CRLF are supported. The displayed CSV row is the nonblank record position including the header; multiline values can span physical lines.
5. Review generated usernames and row errors. Confirm Create accounts to import eligible rows. The backend validates the raw CSV again and repeats creation-time checks; preview usernames can change if another administrator creates accounts meanwhile.
6. Review created, skipped and failed rows. Download rows to correct. Re-uploading a file skips already-created emails or IDs. No existing accounts are overwritten. An interrupted request may have committed some rows, so preview again before retrying.
7. Check invitation status separately. Pending/processing means queued/in progress, sent means delivery accepted, failed means delivery unconfirmed, and cancelled means the account became ineligible. A failed invitation retains the account and offers the existing Resend invitation action.

Each account commits independently. Required writes, profile/academic data, activity log attempt and its durable invitation job use the existing account creation flow. Account creation is serialized with a database named lock to coordinate generated suffixes and duplicate checks across imports/manual requests. Unique username/email/school ID indexes remain authoritative against database races.

## Invitations and operations

Apply scripts/2026-11-17-student-account-import.sql once after the existing account-invitations schema and before deploying both repositories. The SQL adds nullable school_id plus its unique index and creates account_invitation_jobs. Review the existing schema first; the ALTER is a one-time statement.

The backend runs the invitation worker every minute, claiming at most five jobs per run under a MariaDB named lock shared across processes. Existing EmailJS delivery spacing and credentials/template apply. Bulk account creation returns before email delivery. Keep the backend process running for the queue to drain.

Tokens are generated only immediately before delivery and only their hashes are stored in users. The durable queue stores account IDs and statuses, without plaintext passwords/tokens. A crash during sending may leave delivery uncertain. The next worker marks abandoned processing jobs failed and allows an administrator to resend explicitly. Failed jobs are not automatically retried to avoid unconfirmed duplicate delivery. Password recovery/resend waits while an initial invitation is pending or processing; existing cooldown and password setup checks remain.

All import, preview and status endpoints are administrator-only on both API prefixes. They use the authenticated server-action transport and existing limiters. There are no new dependencies or environment variables. The CSV preview/results contain personal information and are visible only to the administrator who is using the account screen.

## Deployment verification

Run the paired account tests with mocked databases and mocked mail. Verify real database migration, CSV import, invitation delivery and both manual roles on staging before rollout. This source update does not run a migration, create real accounts or send real mail.

