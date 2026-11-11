# Evaluations

There are two active evaluation directions:

| Direction | Author | Data tables | Audience |
| --- | --- | --- | --- |
| Performance evaluation | Accepted employer supervisor | `student_evaluation_criteria`, `student_evaluation_masters`, `student_evaluation_scores` | Employer and authorized school staff; confidential from students |
| Company evaluation | Student with an ongoing internship | `company_evaluation_criteria`, `company_evaluation_masters`, `company_evaluation_scores` | Student author and authorized school staff |

Both directions support multiple submissions for the same ongoing internship. Each submission has its own ID, scores, and timestamp. Only employer performance evaluations require the accepted-supervisor relationship and internship start-date check. A student can evaluate their internship company even when no supervisor is assigned. Forms post immediately; no student confirmation or automatic 200-hour milestone applies.

Department heads outside the Registrar manage active questions for their own department through `/criteria/student-evaluation` and `/criteria/company-evaluation`. Company questions are new and empty after migration; heads must add questions before students can submit. The backend validates that each active department question is answered exactly once. Inactive questions remain available to render historical scores.

Authors can soft-delete individual evaluations. Their own history then hides the deleted row. Authorized staff can still review it with a Deleted label and may permanently delete an already soft-deleted row. Performance scores remain inaccessible to students through history, record details, prints, and direct API requests. Department evaluation lists and record detail reads enforce current student-department scope for heads; the Registrar cannot use them.

## Evaluated companies

`GET /evaluations/company/summary` and `/evaluations/company/summary/:companyKey` are for non-Registrar department heads only. Admins are rejected. The head's current department is read from the database; the optional course filter accepts only a course in that department. Date filters use the internship start date, inclusive. Active company evaluations linked to nondeleted ongoing/finished internship records and nondeleted students contribute to ratings across departments.

Company identity is normalized whitespace/case in **both** name and address. Missing addresses are kept separate by internship record, and same-name companies at multiple addresses are flagged for review. Overall and category scores average each evaluation, then average a student's multiple evaluations, then average students equally. Fewer than three distinct reviewers is labeled Limited feedback. The list is sorted highest-to-lowest by default and supports lowest-to-highest. Ties sort by company name and address.

The detail API masks names from other departments and removes their remarks before returning JSON; the frontend does not receive those private fields. The head sees full names and remarks only for students in their current department. No database migration or new environment variable is required for this read-only summary; the existing November 10 company evaluation migration remains a prerequisite.

## Deployment

1. Back up the database. Confirm prior evaluation and department-criteria migrations are already applied for this database.
2. Run [`scripts/2026-11-10-company-evaluations.sql`](../../scripts/2026-11-10-company-evaluations.sql) before deploying the new backend and frontend. It creates the company criteria, master and score tables, then drops old `employer_evaluation_*` tables. **This deletes all previous student-to-supervisor evaluations and questions.** The employer-authored `student_evaluation_*` performance tables are preserved.
3. Deploy the backend and matching frontend together. A department head must enter new company-focused criteria before students can submit company evaluations.

The old October/November supervisor migration scripts are historical and should not be run after this migration. This feature needs no new environment variables or packages. No live database was changed by preparing this migration.
