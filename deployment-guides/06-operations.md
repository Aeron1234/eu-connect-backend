# Maintenance, backups and recovery

## Updates and release switching

Prepare a new paired release, install Linux dependencies and build it before switching current. Record commit hashes, Node/npm versions, migrations and the build result. NEXT_PUBLIC changes require rebuilding. Keep production environment files private under shared/ and linked into the new release.

Use a scheduled maintenance window initially. Stop both applications before incompatible migrations or switching a paired release. Back up the database and storage, run only the required reviewed migrations with migration credentials, update the current symlink, then start backend followed by frontend. Verify login, jobs, sockets and reports before ending maintenance.

Example after the new release has been built and approved:

```bash
sudo systemctl stop eu-connect-frontend eu-connect-backend
sudo ln -sfn /srv/eu-connect/releases/REPLACE_RELEASE_ID /srv/eu-connect/current
sudo systemctl start eu-connect-backend
sudo systemctl start eu-connect-frontend
sudo systemctl status eu-connect-backend eu-connect-frontend
```

Check the release path and current symlink first. Preserve both old and new release directories until acceptance. This procedure has a brief outage. Blue/green or zero-downtime release coordination is optional future work and must also coordinate cron execution and migrations.

The school's maintainer should review Node 24.x, Next.js and transitive dependency advisories regularly. Current Next is 16.4.6. The latest local audit found 16 advisories outside Next.js, including high severity entries. Triage them before production approval. Keep lockfiles and avoid a broad automatic npm audit fix without compatibility checks.

## Backups

| Data | Suggested starting policy |
| --- | --- |
| MariaDB | Encrypted daily full backup; more frequent incrementals/binlogs if the school needs less than 24 hours data loss |
| Supabase bucket objects | Versioned or separate secure backup matching the database restore point |
| Environment values and provider configuration | Encrypted school-controlled vault, with access audit |
| Releases/migration ledger | Record both commit IDs and retain working artifacts |
| Logs | Rotate and retain only as long as school policy requires |

The suggested intervals require school approval. Define recovery-point and recovery-time targets, storage capacity and responsible staff. Keep off-VPS copies. A VPS snapshot alone does not establish database/storage consistency.

For a local MariaDB backup, use a protected defaults file containing backup-user credentials, owned by the backup operator and mode 600:

```bash
mariadb-dump --defaults-extra-file=/secure/path/backup.cnf --single-transaction --routines --triggers --events eu_connect > /secure/backup/eu-connect.sql
```

--defaults-extra-file must be the first option. Restrict and encrypt the output before transferring it off-host. Do not put passwords on command lines. Test restoration into an isolated database and storage namespace before declaring backups usable.

Soft-deleted records are permanently purged after more than 30 days and associated files can be removed. Backup retention must account for that recovery window. Restoring old rows without their matching files creates broken records.

## Rollback

For a code-only failure, stop services, point current at the previous compatible release, and restart both services. A database migration can make old code incompatible; consult the migration ledger. Restore a coordinated database/storage backup only under an approved recovery plan because it can discard newer legitimate activity. Preserve incident evidence and reconcile external mail already sent.

## Monitoring

Use systemctl status and journalctl -u eu-connect-frontend / eu-connect-backend. Nginx normally logs under /var/log/nginx. Configure bounded journald storage and log rotation, disk/RAM/CPU monitoring, certificate renewal alerts and private-storage quota alerts. Restrict logs because URLs and error details may contain personal information.

Inspect queue counts and processing age through an authorized database administration session. Check invitation failures, file-cleanup backlogs, open shifts, pending reviews and scheduled reminders. A public root response only shows process liveness.

| Symptom | Check |
| --- | --- |
| 502 | Unit status, port conflicts, current release, missing environment, DB startup dependencies |
| Login loops | Exact shared ACCESS_TOKEN_SECRET, HTTPS, secure cookies, backend URL, account status |
| Server Action origin errors | Public Host/X-Forwarded-Host and canonical domain |
| Socket disconnects | Public socket URL compiled into bundle, CORS CLIENT_URL, upgrade headers, ticket endpoint |
| Camera/GPS denied | HTTPS, phone permissions, browser/device settings, secure context |
| PDF export fails | Service-user Chrome cache, installed browser/libraries, sandbox policy and available memory |
| Missing PDF previews | prepare-pdf-preview hook and public/pdfjs deployed with current version |
| 413 upload response | Nginx, Next transport, Express JSON or feature-specific multipart cap |
| Wrong schedule/cron time | TZ=Asia/Manila in the backend unit, host clock synchronization and DB +08:00 |
| Invitation stays pending | Backend running, job table migration, worker logs, provider connectivity |
| Invitation failed | EmailJS template/credentials/quota and provider history; explicitly resend after investigation |
| Data missing after cleanup | Soft-delete dates, retention logs and backup history |

