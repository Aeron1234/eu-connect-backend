# Database and backend

## Database decision and schema

The supplied exports use MariaDB 11.8 conventions. Ubuntu 24.04's default database package may be a different release. Use a supported, compatible MariaDB version and test the actual export, migrations, collation, JSON/window queries and named locks on staging. The application is written for MariaDB/MySQL through mysql2; PostgreSQL needs code changes.

A local MariaDB instance is optional when a compatible database already exists. For a local service, install it using the MariaDB project's instructions for the chosen supported release. Keep the database on loopback/private networking, create the application's database with utf8mb4_general_ci, and use a dedicated account with only required runtime privileges. Use separate migration credentials for DDL. For a remote database, the current config/db.js has no TLS configuration; require a private encrypted tunnel or implement and verify TLS before internet transport.

Import a reviewed full production schema using a protected file outside the web root. A database export may contain personal data, hashes, obsolete data or dummy accounts. Review its contents and choose the clean production dataset before import.

```bash
mariadb --host=127.0.0.1 --user=MIGRATION_USER --password eu_connect < /secure/path/reviewed-baseline.sql
```

Reconcile migration history against the imported schema first. SQL scripts are mostly manual, one-time upgrades. Do not execute every .sql file blindly. Some historical scripts rename/drop evaluation tables or change existing data; a new dump may already include their changes. Keep a migration ledger and a pre-change backup.

Recent schema checkpoints include account invitations, DTR photos, shift restrictions/date ranges, overtime and auto-close review, missed clock out, company evaluations, duty schedules/private absences, and student CSV import. The November 11 notification recovery script is conditional on a partial migration. The November 17 student-account-import migration is required for the new school ID and invitation queue. See scripts/ and feature docs in the backend release.

## Environment and installation

Copy templates/backend.env.example to /srv/eu-connect/shared/backend.env and set every required value. Generate three independent authentication secrets using openssl rand -hex 32. The frontend uses the identical ACCESS_TOKEN_SECRET; refresh and temporary-password secrets stay backend-only. Replacing existing secrets logs users out and invalidates signed credentials, so plan rotations.

Set CLIENT_URL to the final school HTTPS origin. Set MAX_SHIFT_HOURS=10 for the agreed duty credit cap. The separate automatic closure remains 16 elapsed hours in code. Supply actual DB settings, Supabase credentials/private bucket and both EmailJS templates.

```bash
sudo chown euconnect:euconnect /srv/eu-connect/shared/backend.env
sudo chmod 600 /srv/eu-connect/shared/backend.env
# As euconnect, inside this release's backend:
ln -s /srv/eu-connect/shared/backend.env .env
npm ci --omit=dev
```

A development-only nodemon installation is unnecessary for the service. The .env link provides dotenv values from the correct working directory; the systemd EnvironmentFile also supplies them before imports execute. Avoid conflicting values in multiple files.

Install templates/eu-connect-backend.service under /etc/systemd/system using sudo install -m 644 after current points at the tested release. Run systemctl daemon-reload and systemctl enable --now eu-connect-backend. Check status and journald. Its unit starts node server.js directly.

## Scheduled work

| Job | Current schedule |
| --- | --- |
| DTR warning at 12 hours and auto-close at 16 | Hourly at minute zero |
| Refresh-token cleanup | 03:00 process/host timezone |
| Error-event retention | 03:15 process/host timezone |
| Feedback files and DTR/document cleanup | Every five minutes |
| Soft-delete purge older than 30 days | 03:30 Asia/Manila |
| Scheduled absence detection | Every 15 minutes, Asia/Manila |
| Duty-schedule reminders | Sundays hourly 09:00–23:00, Asia/Manila |
| CSV account invitation queue | Every minute, at most five jobs per run |

These jobs are registered by server.js through node-cron. systemd keeps the application alive. An additional OS cron entry for these same functions would duplicate execution. The unit sets TZ=Asia/Manila so jobs using host time align with the school.

New auto-close entries await explanations/review; the 10-hour credit cap is separate. Bulk invitation jobs survive restarts in MariaDB. Failed or uncertain invitation sends require explicit admin resend. After downtime, inspect open shifts, missed detections and reminder/queue progress; cron does not guarantee replay of every missed invocation.

## Provider and health checks

Supabase storage uses SUPABASE_KEY and SUPABASE_BUCKET on the server. Preserve the private-bucket design and authorized short-lived signed links. Database backups do not include object contents. EmailJS uses its existing service, private/public key and two templates. Validate approved sender, delivery and quotas in the school's accounts.

```bash
curl -fsS http://127.0.0.1:7000/
sudo systemctl status eu-connect-backend
sudo journalctl -u eu-connect-backend --since '15 minutes ago'
```

The root response is liveness only. Confirm real login, authorized reads, a reversible upload/download and an invitation to a controlled test recipient. After schema verification, inspect DTR jobs and privacy using the role checklist. Runtime DB users need the privileges required by named locks as supported by the chosen database service.

