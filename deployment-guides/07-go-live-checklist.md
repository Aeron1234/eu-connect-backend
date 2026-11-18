# Go-live acceptance checklist

Assign a technical owner and record evidence/date for each item before the school opens production access.

## Infrastructure and data

- [ ] School domain, selected Hostinger VPS plan and Ubuntu image are recorded.
- [ ] Patched Node 24.x satisfies both manifests; frontend/backend commit IDs are recorded.
- [ ] Linux dependencies and frontend production build succeed as the service user.
- [ ] Complete production schema is verified and migration ledger reconciled.
- [ ] Dummy accounts, sample evaluations and personal data have an approved disposition.
- [ ] Separate runtime and migration database credentials are configured.
- [ ] Database and the selected file storage have coordinated encrypted off-host backups and a successful restore test.
- [ ] Services restart after a controlled VPS reboot.
- [ ] Firewall blocks public 3000, 7000 and local DB 3306 for IPv4 and IPv6.
- [ ] HTTPS, redirect and certificate renewal dry run pass.
- [ ] Remaining dependency advisories have a recorded deployment decision.
- [ ] Resource/load test includes attendance, uploads and simultaneous PDFs.

## Frontend/backend integration

- [ ] Login, refresh, logout and password recovery work on the final HTTPS origin.
- [ ] Student, employer, regular head, Registrar and admin land on their permitted pages.
- [ ] A regular head cannot read another department's private attendance reports.
- [ ] Employer/admin/Registrar cannot access private absence reports.
- [ ] Student schedule and supervisor override rules work, including overnight start dates.
- [ ] Clock-in opens at the configured 30-minute lead and requires GPS/photo.
- [ ] Break/resume changes appear promptly in the DTR table.
- [ ] Manual clock-out, review and credited hours match the school policy.
- [ ] Auto-close and missed-clock-out review are tested with controlled staging data.
- [ ] Camera rear/front and zoom work on an actual phone over HTTPS.
- [ ] Upload, authorized preview/download and private signed links work.
- [ ] Word/PDF previews and all report export types work.
- [ ] Real-time notifications and live location connect with a valid socket ticket.

## Account creation and jobs

- [ ] Manual student username and optional school ID work; other roles retain manual usernames.
- [ ] CSV preview rejects invalid courses, duplicate IDs/emails and malformed files.
- [ ] Valid rows create accounts; a retried file skips already-created accounts.
- [ ] Account and duty-reminder emails reach a school-controlled test mailbox.
- [ ] Bulk invitation queue drains and failed sends can be explicitly resent.
- [ ] Scheduled jobs and Asia/Manila timing are verified in staging.
- [ ] Soft-delete purge and storage-cleanup behavior have been demonstrated on test data.
- [ ] The school has an outage contact, maintenance window and rollback procedure.

Use controlled test recipients and staging data for destructive/elapsed-time tests. Do not accelerate the production clock or purge real records to exercise scheduled work.


## Selected VPS file storage

- [ ] Chapter 09 backend storage changes are implemented and tested.
- [ ] Existing objects are copied with relative keys preserved and checksums reconciled.
- [ ] Private downloads, role checks, previews, cleanup queues and legacy URL records work.
- [ ] Off-server backup/restore includes the persistent upload root.
- [ ] Supabase credentials are retired only after approved migration acceptance.
