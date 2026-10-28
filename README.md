# EU-Connect — Backend

**The API and real-time service for the MSEUF-CI internship management system.**

EU-Connect supports the OJT program of Manuel S. Enverga University Foundation–Candelaria, Inc. This repository provides the Express API, database operations, private document storage integration, authentication, notifications, and scheduled maintenance used by the separate Next.js frontend.

The backend serves students, employers/company supervisors, department heads, registrar staff, and administrators. It enforces role, ownership, department, supervision, and internship-lifecycle rules independently of the frontend.

## Contents

- [Features](#features)
- [Technology](#technology)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database setup and migrations](#database-setup-and-migrations)
- [Authentication and permissions](#authentication-and-permissions)
- [API guide](#api-guide)
- [Files and uploads](#files-and-uploads)
- [Real-time events and location](#real-time-events-and-location)
- [Maps and road routing](#maps-and-road-routing)
- [Caching and request limits](#caching-and-request-limits)
- [Scheduled maintenance](#scheduled-maintenance)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

## Features

- JWT login, access-token verification, refresh-token rotation, logout, password recovery, and temporary-password email delivery.
- Account creation, profile management, account activation/deactivation, and academic reference data.
- Internship record submission, pending edits, approval/rejection, restoration, completion, and authorized record details.
- Daily Time Records (DTR), geofence checks, breaks, duty resumption, clock-out, and automatic stale-shift closure.
- Weekly narratives with coverage dates and authorized data for journal printing.
- One summary report per internship, with memorabilia images and legacy attachment support.
- Student requirement documents, supervisor uploads, document acceptance, and authorized signed access.
- Internship opportunities, employer posting management, and student favorites.
- Supervision requests, acceptance/decline, cancellation, and supervisor removal.
- Confidential performance evaluations, student-authored supervisor evaluations, and one-active-evaluation enforcement.
- Announcements, dated events, calendar schedules, and private student to-dos.
- Student/company map data, saved city/province fields, route preparation, and road-routing integration.
- Alumni placement search and department/academic-year filters.
- SIPP Annex C reports and Annex D host-training-establishment data.
- Private employer Feedback & Concerns, intern mentions, replies, internal notes, attachments, and resolution status.
- Persisted notifications and authenticated Socket.IO delivery.
- Role-specific dashboard data, readable activity logs, response-cache monitoring, and grouped error tracking.

PDF files are generated in the **Next.js frontend's server runtime**. This backend supplies authorized report data and stored-file access.

## Technology

| Area | Implementation |
| --- | --- |
| Runtime | Node.js `>=24.22.1 <25`, JavaScript ES modules |
| HTTP API | Express 5 |
| Database | MySQL-compatible database through `mysql2/promise`; supplied incremental SQL includes MariaDB-specific syntax |
| Authentication | jsonwebtoken, bcryptjs, refresh-token records |
| Real-time updates | Socket.IO 4 |
| Private file storage | Supabase Storage |
| Multipart uploads | Multer memory storage with bounded upload policies |
| Email | Resend and React Email |
| Response caching | node-cache |
| Request limits | express-rate-limit |
| Scheduled jobs | node-cron |
| Testing | Node.js built-in test runner, mocked services, and isolated fixtures |

Dependency ranges and locked versions are recorded in `package.json` and `package-lock.json`.

## Architecture

```text
Next.js frontend / authorized API client
                  │
                  ▼
HTTP + Socket.IO server (server.js)
  ├─ CORS, cookies, request context and error handling
  ├─ Authentication, roles, rate limits and response caching
  ├─ Feature routers and controllers
  └─ Scheduled maintenance
                  │
         ┌────────┼───────────┐
         ▼        ▼           ▼
      MySQL    Supabase     Resend
      records  private     temporary-password
               objects     email
                  │
                  └─ OSRM-compatible provider for road routes
```

Both Express and Socket.IO run on the same HTTP server. The default port is **7000**.

Database connections use a pool with a maximum of 10 connections per process. The connection timezone is configured as `+08:00`, and new database sessions set that timezone and `utf8mb4_general_ci` connection collation.

## Local setup

### Prerequisites

- Node.js matching `engines.node` and npm.
- A compatible MySQL/MariaDB server with the approved EU-Connect base schema and reference data.
- A Supabase project and a **private** storage bucket.
- Resend configuration for temporary-password email delivery.
- The separate EU-Connect frontend for the complete user interface.

### 1. Open the repository

Clone this backend repository and open its root directory.

### 2. Create `.env`

Use placeholders like the following, then replace them with your own local configuration:

```dotenv
NODE_ENV=development
PORT=7000
CLIENT_URL=http://localhost:3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=eu_connect_app
DB_PASSWORD=replace_with_database_password
DB_NAME=eu_connect

ACCESS_TOKEN_SECRET=replace_with_a_strong_access_token_secret
REFRESH_TOKEN_SECRET=replace_with_a_different_refresh_token_secret
TEMP_PASSWORD_SECRET=replace_with_a_different_temporary_password_secret

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=replace_with_backend_storage_key
SUPABASE_BUCKET=your-private-bucket

RESEND_API_KEY=replace_with_resend_api_key
MAIL_FROM=EU-Connect <no-reply@example.com>

# Example attendance policy; set this to the approved maximum duty hours.
MAX_SHIFT_HOURS=8
```

The examples are not working credentials or a statement of the school's attendance policy. Keep the real `.env` file out of Git; it is already listed in this repository's `.gitignore`.

The frontend's server-side `ACCESS_TOKEN_SECRET` must match this backend's value. Keep the refresh, temporary-password, database, storage, and email credentials on the backend.

### 3. Install dependencies

```bash
npm ci
```

### 4. Prepare the database

Import the approved baseline schema/reference data and apply only the applicable incremental migrations described below. No setup command automatically creates the complete database.

### 5. Start the server

```bash
npm run dev
```

Check **http://localhost:7000/**. A responding server returns:

```text
API Service is live.
```

This confirms the HTTP service is responding. Check authenticated database and storage workflows separately.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the server with Nodemon. |
| `npm start` | Run `server.js`. |
| `npm test` | Run the automated backend tests. |

There is no application compilation step or unified `npm run migrate` command in the current package scripts.

## Environment variables

### Main service configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP/Socket.IO listening port; defaults to `7000`. |
| `CLIENT_URL` | Allowed frontend origin for HTTP and Socket.IO CORS. Localhost `http://localhost:3000` is also allowed by the current server configuration. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database connection settings. |
| `ACCESS_TOKEN_SECRET` | Access-token signing and verification; also used to derive the separate socket-ticket signing key. |
| `REFRESH_TOKEN_SECRET` | Refresh-token signing and verification. |
| `TEMP_PASSWORD_SECRET` | One-time temporary-password token signing and verification. |
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET` | Storage project, backend credential, and private bucket name. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email API credential and accepted sender address. |
| `MAX_SHIFT_HOURS` | Positive whole-number maximum duty hours; required by attendance validation and stale-shift cleanup. |
| `NODE_ENV` | Use `production` in production; affects secure authentication-cookie settings. |

All three JWT secrets must be configured. Use a storage credential with the permissions needed by the backend's private upload/download/delete operations.

### Optional settings

| Variable | Default / behavior |
| --- | --- |
| `CACHE_ENABLED` | Response caching is enabled unless set to the exact string `false`. |
| `MAX_SHIFT_WALL_HOURS` | Defaults to `MAX_SHIFT_HOURS + 2`; must exceed `MAX_SHIFT_HOURS`. |
| `BATCH_SIZE` | Stale-shift processing batch size; defaults to `100`. |
| `REFRESH_TOKEN_REVOKED_RETENTION_DAYS` | Revoked-token retention before cleanup; defaults to `1` day. |
| `REFRESH_TOKEN_CLEANUP_BATCH_SIZE` | Token deletion batch size; defaults to `1000`. |
| `MAP_ORIGIN_LAT`, `MAP_ORIGIN_LNG` | Override the default campus route origin when both form a valid coordinate pair. |
| `MAP_ROUTING_BASE_URL` | Override the default OSRM-compatible road-routing base URL. |

Older LocationIQ and API-key middleware files remain in the repository, but they are not part of the active router/authentication setup mounted by `server.js`. Their historical variables are not prerequisites for the current main service.

## Database setup and migrations

The repository contains **incremental migrations and backfills**, rather than a complete database bootstrap. Obtain the approved base schema/export and initial reference/admin data through the project's deployment process.

Review the installed schema, server version, and each script's comments before applying an upgrade. Some scripts are intended for a one-time run or a specific earlier export; others support rerunning. Apply them to a backup/staging copy first where appropriate.

| Area | Script / instructions |
| --- | --- |
| Attendance breaks | [attendance-breaks.sql](docs/attendance-breaks.sql) |
| Historical stale-shift corrections | [attendance-auto-close-backfill.sql](docs/attendance-auto-close-backfill.sql) |
| Calendar | [calendar.sql](docs/calendar.sql) |
| Summary reports | [summary-reports.sql](docs/summary-reports.sql), then [summary-report-images.sql](docs/summary-report-images.sql) |
| Feedback discussions | [feedback-and-concerns.sql](docs/feedback-and-concerns.sql); existing earlier installations also need [feedback-author-actions.sql](docs/feedback-author-actions.sql) |
| Error tracking | [error-tracking.sql](docs/error-tracking.sql) |
| Employer document notifications | [employer-document-notifications.sql](docs/employer-document-notifications.sql) |
| Profile middle initials | [user-profile-middle-initial.sql](docs/user-profile-middle-initial.sql) |
| Password-change dates | [password-change-date.sql](docs/password-change-date.sql) |
| Evaluation category names | [student-evaluation-category-names.sql](docs/student-evaluation-category-names.sql) |
| Evaluation soft deletion and active-slot uniqueness | [2026-10-22-evaluation-soft-delete.sql](scripts/2026-10-22-evaluation-soft-delete.sql) |
| Weekly narrative coverage dates | [2026-10-22-weekly-narrative-date-range.sql](scripts/2026-10-22-weekly-narrative-date-range.sql) |
| Map city/province columns and export-specific backfill | [2026-10-21-map-city-backfill.sql](scripts/2026-10-21-map-city-backfill.sql) |

The evaluation lifecycle script targets the supplied **MariaDB 11.8** schema, consolidates duplicate active evaluations through soft deletion, creates an active-slot uniqueness constraint, and removes the old student-evaluation status column. Do not assume its MariaDB syntax is interchangeable with every MySQL version.

The map script includes backfills tied to specific records from an earlier export. Review those matches when preparing another database.

Two executable migration helpers are also available:

- [applyAnnouncementUuidMigration.js](scripts/applyAnnouncementUuidMigration.js): announcement public UUIDs and existing notification-link backfill.
- [applyErrorTrackingMigration.js](scripts/applyErrorTrackingMigration.js): error-event table creation/check.

Running either helper modifies the database configured in `.env`. Database migrations are a separate deployment step; starting the API does not run them.

## Authentication and permissions

### HTTP authentication

Protected routes accept an access token through:

```http
Authorization: Bearer <access-token>
```

The active middleware also accepts an `access_token` cookie. Next.js normally calls this API server-to-server with the bearer header.

- Access tokens expire after **15 minutes**.
- Refresh tokens expire after **30 days** and have database-backed rotation/revocation records.
- Refresh-token values are stored as hashes.
- Temporary-password tokens expire after **10 minutes** and are checked against the account's current one-time identifier.
- Login, recovery, refresh, and protected routes have their applicable request limits.
- Socket tickets are separate credentials with a **30-second handshake lifetime**.

### Roles and record scope

Role codes are `student`, `employer`, `department_head`, and `admin`. Registrar access uses `department_head` with department code `REG`.

Role checks are supplemented by controller-level ownership, supervision, department, status, and deletion checks. The frontend's visible controls do not replace those checks.

Current workflow rules include:

- Department heads see only Info when searching a student from another department. Private internship tabs and their backend endpoints require matching current department membership.

- Employers are excluded from announcements and the full calendar API.
- Regular department heads post Department announcements; registrar heads and administrators post General announcements.
- Supervision requests are answered through Notifications in the frontend. The employer dashboard's intern list includes assigned interns with `all`, `ongoing`, and `finished` filters.
- Unanswered active supervisor-request notifications cannot be deleted; direct deletion attempts return `409`. Answered, cancelled/superseded, and obsolete requests can be dismissed.
- Employer performance evaluations are hidden from students, including print and notification access.
- Both evaluation directions allow one active evaluation per internship. Author deletion is a soft delete; authorized staff retain deleted history and may permanently remove already-deleted copies.
- Weekly narrative/report writes and employer performance-evaluation submission enforce the applicable internship start-date restriction.
- Feedback audiences and attachment access are checked on the backend, including staff-only internal notes.

## API guide

The canonical base is:

```text
http://localhost:7000/api/v1
```

The same routers are mounted at `/eu-connect/api` for compatibility. Both prefixes share canonical cache identities and request-limit budgets. Use `/api/v1` for new callers.

The health endpoint `GET /` and Socket.IO are outside that API prefix. See [API-VERSIONING.md](API-VERSIONING.md) for rollout details.

### Authentication endpoints

| Method | Relative path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Sign in with username/password or an eligible temporary credential. |
| POST | `/auth/refresh` | Rotate the refresh cookie and issue fresh session tokens. |
| POST | `/auth/logout` | Revoke/clear the session as implemented by the auth controller. |
| GET | `/auth/me` | Return the authenticated account context. |
| POST | `/auth/forgot-password` | Start temporary-password recovery. |
| PATCH | `/auth/set-password` | Set a password in the authorized setup flow. |
| POST | `/auth/socket-ticket` | Issue a short-lived Socket.IO ticket. |

### Feature endpoint index

Paths below are relative to the API base. The linked routers define exact methods, middleware order, and role access; controllers define request/response details and record scope.

| Feature | Representative endpoints | Router |
| --- | --- | --- |
| Accounts and profiles | `/accounts`, `/accounts/new`, `/account/user`, `/account/update`, `/profile/avatar` | [accountRoutes.js](features/accounts/routes/accountRoutes.js) |
| Departments and courses | `/departments`, `/courses`, activation/deactivation paths | [departmentsAndCoursesRoutes.js](features/departments-and-courses/routes/departmentsAndCoursesRoutes.js) |
| Dashboards | `/dashboard-stats`, `/student-dashboard-data`, `/employer-dashboard-data`, `/department-head-dashboard-data`, `/admin-dashboard-data` | [dashboardRoutes.js](features/dashboard/routes/dashboardRoutes.js) |
| Internship records | `/internships/new`, `/internship-records/department`, `/internship-records/overview/:internshipId`, record lifecycle/detail paths | [internshipRecordRoutes.js](features/internship-records/routes/internshipRecordRoutes.js) |
| Attendance | `/dtr/today`, `/dtr/history`, `/dtr/status`, `/dtr/clock-in`, `/dtr/clock-out`, `/dtr/break/start`, `/dtr/break/resume` | [dtrRoutes.js](features/dtr/routes/dtrRoutes.js) |
| Weekly narratives | `/weekly-narratives/history`, `/weekly-narratives/new`, `/weekly-narratives/print/:internshipId` | [weeklyNarrativeRoutes.js](features/weekly-narratives/routes/weeklyNarrativeRoutes.js) |
| Earlier narrative endpoints | `/narratives/history`, `/narratives/new`, record/profile narrative paths | [narrativeRoutes.js](features/narratives/routes/narrativeRoutes.js) |
| Summary reports | `/summary-reports`, `/summary-reports/:internshipId`, authorized attachment and record paths | [summaryReportRoutes.js](features/summary-reports/routes/summaryReportRoutes.js) |
| Documents | `/internships/files`, `/internships/files/new`, `/internships/files/:fileId/download`, `/files/:fileId/accept` | [fileRoutes.js](features/documents/routes/fileRoutes.js) |
| Opportunities and favorites | `/internship-postings`, `/internship-postings/:postingId`, `/internship-postings/toggle-favorite/:postingId` | [internshipPostsRoutes.js](features/internship-posts/routes/internshipPostsRoutes.js) |
| Supervisor requests | `/supervisor-status/:employerId`, `/supervisor-requests`, `/supervisor-requests/respond/:requestId`, `/supervisors/:employerId` | [supervisorRequestRoutes.js](features/supervisor-requests/routes/supervisorRequestRoutes.js) |
| Employer evaluates student | `/student-evaluation/new`, `/student-past-evaluations/:studentId`, `/evaluations/student/:evaluationId/print` | [studentEvaluationRoutes.js](features/evaluations/routes/studentEvaluationRoutes.js) |
| Student evaluates supervisor | `/evaluations/employer`, `/evaluations/submitted`, `/evaluations/eligibility` | [employerEvaluationsRoutes.js](features/evaluations/routes/employerEvaluationsRoutes.js) |
| Evaluation criteria | `/criteria/student-evaluation`, `/criteria/employer-evaluation`, section/criterion activation paths | [evaluationsCriteriaRoutes.js](features/evaluation-criteria/routes/evaluationsCriteriaRoutes.js) |
| Announcements | `/announcements/history`, `/announcements/:announcementId`, `/announcement/new`, pin/delete paths | [announcementRoutes.js](features/announcements/routes/announcementRoutes.js) |
| Calendar | `/calendar`, `/calendar/todos`, `/calendar/schedules` | [calendarRoutes.js](features/calendar/routes/calendarRoutes.js) |
| Notifications | `/notifications`, `/notifications/unread-count`, `/notifications/:notificationId` | [notificationRoutes.js](features/notifications/routes/notificationRoutes.js) |
| User profiles and intern tools | `/searched-user/:searchedUserId`, DTR location and authorized file paths | [searchedUserRoutes.js](features/users/routes/searchedUserRoutes.js) |
| User search/history | `/search-users`, `/search-history`, `/save-search-history`, history deletion paths | [searchhistoryRoutes.js](features/search-history/routes/searchhistoryRoutes.js) |
| Placement map and routing | `/student-map`, `/student-map/route/:internshipId` | [mapRoutes.js](features/map/routes/mapRoutes.js) |
| Alumni placements | `/alumni-internships`, `/company-directory` | [alumniRecordRoutes.js](features/past-internships/routes/alumniRecordRoutes.js) |
| SIPP reporting | `/reports/academic-years`, `/reports/hte-annual/companies`, `/reports/hte-annual/company`, `/reports/annex-c` | [hteReportRoutes.js](features/sipp-reports/routes/hteReportRoutes.js) |
| Feedback discussions | `/feedback`, `/feedback/interns`, reply/status/attachment paths | [feedbackRoutes.js](features/feedback/routes/feedbackRoutes.js) |
| Activity logs | `/activity-logs`, `/activity-logs/mine`, `/activity-logs/batch-delete-preview`, `/activity-logs/batch` | [activityLogsRoutes.js](features/activity-logs/routes/activityLogsRoutes.js) |
| Cache diagnostics | `/cache/metrics` | [cacheMonitoringRoutes.js](features/cache-monitoring/routes/cacheMonitoringRoutes.js) |
| Error tracking | `/errors`, `/errors/:fingerprint` | [errorTrackingRoutes.js](features/error-tracking/routes/errorTrackingRoutes.js) |

Naming reflects existing contracts: `student-evaluation` is an employer's evaluation of a student, while `evaluations/employer` is the student's evaluation of their supervisor.

Older evaluation confirmation/dispute/review URLs remain registered for compatibility, but their controllers reject or retire the former confirmation workflow. They should not be used to restore student access to employer evaluations.

### Notifications and supervision

- `POST /supervisor-requests`: student requests an employer.
- `PATCH /supervisor-requests/respond/:requestId`: targeted employer sends `decision: "accept"` or `"reject"`.
- `DELETE /supervisor-requests/:requestId`: student cancels their pending request.
- `DELETE /supervisors/:employerId`: student removes their current supervisor under the existing rules.
- `PATCH /notifications/:notificationId`: mark one notification read.
- `PATCH /notifications`: mark all read.
- `DELETE /notifications/:notificationId`: delete an owned, deletable notification.

Marking a request notification read does not count as answering it. Inbox records expose `actionable`, `request_status`, and `can_delete` to support the frontend.

### Feedback discussions

Employers create posts with category, subject, description, optional internship tags, and attachments.

- General Feedback: author, administrators, and all department heads.
- Platform Feedback / Technical Issue: author and administrators.
- Internship Feedback & Concerns: author, administrators, and department heads of tagged students.
- Students and unrelated employers cannot access these discussions.

Post authors alone edit/delete their posts. Reply authors edit/delete their own replies. Authorized school staff manage status and internal notes. Deleting posts or removing attachments queues storage cleanup durably.

See [Feedback & Concerns](docs/feedback-and-concerns.md) for multipart fields, cursor pagination, audience changes, and cleanup details.

### Responses and pagination

Response shapes vary by feature; use the relevant controller and tests as the contract. Common failures include `401` for invalid sessions, `403` for denied access, `404` for missing/inaccessible resources, `409` for conflicts, `413` for upload size limits, and `429` for request limits.

Pagination and filters are endpoint-specific. Preserve their page/limit, totals, status, search, academic-year, and department parameters rather than assuming one universal list shape.

The service returns an `X-Request-ID` header to help correlate failures.

## Files and uploads

Files are stored through the configured **private Supabase bucket**. Controllers authorize the viewer and specific document before returning signed access. Never make the bucket public to work around an authorization failure.

| Upload flow | Multipart field | Parser limit |
| --- | --- | --- |
| Student document | `file` | One file, up to 10 MB |
| Supervisor certificate/document | `file` | One file, up to 50 MB |
| Summary memorabilia | `images` | Up to six images, 5 MB each |
| Feedback attachments | `attachments` | Up to three files, 5 MB each |

These are backend parser limits; frontend rules, storage limits, and controller-specific MIME validation may be stricter. Feedback accepts PDF/JPG/PNG/WebP; summary images use JPG/PNG/WebP.

Storage I/O is bounded through [storageFetch.js](config/storageFetch.js). Upload lifecycle helpers release database connections around external storage work and distinguish validation failure, rollback, and uncertain commit outcomes.

A timed-out upload can have an unknown final outcome. Refresh the saved-file list before repeating the upload.

Feedback file removal uses a database-backed cleanup queue. Objects are deleted after commit, and failed cleanup is retried by the scheduled worker.

## Real-time events and location

Clients obtain a ticket from `POST /auth/socket-ticket`, then connect to Socket.IO using:

```js
const socket = io(backendOrigin, {
  auth: { ticket },
});
```

The frontend already implements ticket acquisition and renewal. The server derives a separate ticket signing key from the access secret, validates ticket purpose/audience/issuer, and joins the authenticated user to their own `user-<id>` room.

A socket is disconnected when its authorizing access session expires. Reconnect with a fresh ticket.

| Event family | Purpose |
| --- | --- |
| `new_notification` | Inform a recipient that their persisted inbox has changed. |
| `supervisor_status_changed` | Refresh supervision-dependent views. |
| `feedback_updated` | Refresh an authorized discussion by ID. |
| `dtr_location:*` | Temporary student location sharing and authorized attendance-location setup. |
| `map_location:update`, `map_location:position`, `map_location:stop` | Viewer location updates scoped to their own authenticated map session. |

Student DTR sharing and staff map location are separate flows. Live student positions are held in process memory with expiry and access checks. Staff map positions are echoed only to the authenticated socket. Neither flow writes a movement history to the database.

Socket events support refreshes; database records remain the source for durable notifications and saved work.

## Maps and road routing

The default campus origin is latitude **13.9304557**, longitude **121.4312752**.

`GET /student-map/route/:internshipId` checks the staff role and resolves the saved destination from an ongoing, non-deleted internship. It accepts a valid optional `origin_lat`/`origin_lng` pair, rather than trusting client-supplied destination/provider URLs.

- The default provider is `https://routing.openstreetmap.de/routed-car/`.
- With `prepare=1` and the default public provider, the backend returns authorized origin/destination data so the frontend can run its browser/provider fallback flow.
- With a configured provider, the backend can request OSRM-compatible geometry itself.
- Responses include Google Maps directions when a destination is available.
- Campus route geometry has bounded process-local reuse. Routes containing the viewer's current position bypass that shared cache.
- Provider calls have bounded deadlines/queueing and safe failure responses.
- Map View shows city groups beside the map, using the same search, region and department filters. Company/route details open in a left slideout inside the map on desktop and mobile. Loading or failure keeps it open; successful routing closes it. A small in-map control reopens it, without a duplicated route panel below the map.

The frontend's internship-record Overview map also provides **See on Google Maps** in the company pin popup. It builds campus-to-company directions from the coordinates already returned by the authorized record overview endpoint; it does not call the ongoing-only road-route endpoint. No additional backend endpoint, database column or environment variable is needed for that link.

Configure `MAP_ROUTING_BASE_URL` only for an appropriate OSRM-compatible service. Public routing availability is best effort; retain the frontend's Google Maps link.

## Caching and request limits

The response cache is **process-local**. Selected authenticated GET routes cache successful JSON responses with feature-specific TTLs. Cache keys include the verified user/role/academic context and full request URL.

Errors and responses marked to skip storage are not saved. Private responses use `Cache-Control: private, no-store` for downstream clients. Successful writes invalidate the relevant cache families, and a generation guard prevents older in-flight reads from repopulating them after a write.

Set `CACHE_ENABLED=false` to disable response caching. See [caching.md](docs/caching.md) for implementation notes; historical test counts in that document are not a deployment status.

Request limits use verified user identities where available, with IP/identifier-based handling for unauthenticated flows. Common configured budgets include:

| Limiter | Budget |
| --- | --- |
| General browsing | 100 requests / 15 minutes |
| Paginated reads | 200 requests / 5 minutes |
| General edits/deletes | 40 requests / 15 minutes |
| Uploads | 30 requests / hour |

Login, recovery, refresh, clock actions, and high-cost submissions have their own policies in [rateLimiter.js](middleware/rateLimiter.js). Canonical and legacy URL prefixes share equivalent budgets.

Cache metrics are available to administrators at `GET /cache/metrics`. They describe this process's response cache, not database query latency.

## Scheduled maintenance

Jobs are registered when `server.js` starts and run while the process remains active.

| Schedule | Job |
| --- | --- |
| Every hour, at minute 0 | Close stale attendance shifts using duty-hour and wall-clock limits. |
| Daily at 03:00 | Remove expired or sufficiently old revoked refresh-token records. |
| Daily at 03:15 | Purge error events older than the configured code retention of 30 days. |
| Every 5 minutes | Retry queued feedback storage-file cleanup. |

Cron schedules use the process/host timezone; the current registrations do not specify an explicit cron timezone. Database sessions separately use `+08:00`. Align the deployment's timezone with the intended operational schedule.

Job failures are reported without deliberately stopping normal API handling. Unhandled process-level failures are written to stderr and exit nonzero so a process supervisor can restart the service.

## Project structure

```text
server.js                 HTTP server, Socket.IO, route mounting and jobs
config/
  api.js                  API prefixes and compatibility normalization
  db.js                   Database pool and session settings
  jwt.js                  Token signing, verification and hashing
  socketAuth.js           Socket tickets and private user rooms
  supabase.js             Private storage client
  mailer.js               Temporary-password email delivery
  cache/                  Response caches, invalidation and metrics
  errorTracking.js        Request context and persisted diagnostics
  uploadLifecycle.js      Upload/storage/transaction lifecycle helpers
  liveDtrLocation.js      Temporary student position sharing
middleware/               Authentication, roles, caching, uploads and limits
features/
  <feature>/routes/       API paths and middleware composition
  <feature>/controllers/  Request handlers and database operations
  feedback/               Feedback controller, storage and discussion rules
  map/                    Routing provider and viewer-location handling
emails/                   React Email template
docs/                     Feature notes and incremental SQL
scripts/                  Migration helpers and dated SQL upgrades
tests/                    Automated API/domain regression checks
API-VERSIONING.md         Canonical and legacy API contracts
```

`copies/`, older `verifyUser-v1/v2` files, and the unmounted location router are not the active route registry. Check `server.js` and the imported feature routers when changing a deployed endpoint.

## Testing

```bash
npm test
```

The suite covers authentication/socket access, ownership and department scope, confidential evaluations, lifecycle locks, uploads, feedback audiences and cleanup, notifications, rate limits, API aliases, caching, pagination, query behavior, attendance, reporting, and map routing.

Tests use database/storage mocks and isolated fixtures; some open temporary localhost HTTP servers. They do not provision the production schema or verify live MySQL, Supabase, email delivery, public routing, or real browser GPS.

Run live service checks separately in the intended staging/deployment environment.

## Deployment

### Shared setup

1. Prepare the approved database schema and applicable upgrades.
2. Configure the private bucket, email service, secrets, and database access.
3. Set `NODE_ENV=production`, `CLIENT_URL` to the frontend origin, and the listening `PORT` expected by the host.
4. Install with `npm ci` and run `npm start`.
5. Deploy the frontend with a matching server-side access secret, `API_BASE_URL=https://backend.example.com/api/v1`, and `NEXT_PUBLIC_SOCKET_URL=https://backend.example.com`.
6. Verify login/refresh, authorized reads, request responses, uploads, signed documents, Socket.IO, and report-data access.

### Render or another managed Node host

Use a long-running Node service with installation command `npm ci` and start command `npm start`. The host must support the persistent HTTP/Socket.IO process and provide access to the configured database and external services.

A sleeping or stopped instance also pauses its in-process scheduled jobs.

### Hostinger VPS / self-hosted deployment

Run the Node service under a process manager and place it behind HTTPS. If using Nginx or another reverse proxy, forward API requests and the Socket.IO path with WebSocket support.

The application currently sets Express `trust proxy` to `1`. Review that value against the actual proxy chain so client-address handling and IP-based request limits remain correct.

The active CORS configuration accepts `CLIENT_URL` plus the localhost frontend origin. Review the origin list when changing domains or deployment policy.

### Process and scaling constraints

The current runtime is designed around one API process:

- Response caches and request-limit stores are in memory.
- Socket.IO rooms and live location state belong to that process.
- Each process registers its own cron jobs.
- The database pool limit applies per process.

For multiple workers or instances, coordinate socket delivery, maintenance-job ownership, and cache invalidation. The cache implementation explicitly calls for disabling response caching until shared invalidation is available. `CACHE_ENABLED=false` alone does not coordinate sockets, jobs, or request-limit stores.

### Operations and diagnostics

The root health response confirms HTTP availability. Also monitor database connectivity, scheduled-job results, storage/email access, and host stderr.

Administrators can inspect activity logs, response-cache metrics, and grouped error events. Error tracking records bounded diagnostic fields and request IDs while avoiding request bodies and credentials; persistence is best effort during outages.

Back up database records and private storage objects through the deployment's normal backup process.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing JWT-secret startup error | Configure all three signing secrets before starting the process. |
| Invalid/expired session after deployment | Check matching frontend/backend access secrets, refresh records, HTTPS, and cookie behavior. |
| Database errors | Check connection settings, database reachability, installed schema, and migration compatibility. |
| Upload or download fails | Check bucket privacy/name, backend storage permissions, MIME/size rules, and service reachability. |
| Temporary-password email fails | Check Resend credentials, sender configuration, and delivery results. |
| Frontend cannot connect | Check `CLIENT_URL`, API base/version, the public origin, and reverse-proxy routing. |
| Socket authentication fails | Obtain a fresh socket ticket and confirm the access session is still valid. |
| Road route fails | Check saved coordinates and provider connectivity; use the returned Google Maps link. |
| Stale-shift job reports configuration errors | Set a positive whole-number `MAX_SHIFT_HOURS`; any wall-hour override must be greater. |
| Feedback file deletion is pending | Check the cleanup queue, private storage access, and five-minute retry job. |
| Missing-table/column errors | Apply the relevant reviewed backend upgrade before the matching application code. |
| Different workers show inconsistent state | Review the single-process cache/socket/job constraints above. |

## Further documentation

- [API versioning and rollout](API-VERSIONING.md)
- [Caching and cache monitoring](docs/caching.md)
- [Feedback & Concerns](docs/feedback-and-concerns.md)
- [Error tracking](docs/error-tracking.md)
- [Database and feature scripts](docs/)
- [Dated migrations and executable helpers](scripts/)

## Optional company rotations

Apply `scripts/2026-10-27-internship-rotations.sql` before deploying both applications. It adds default-off `internship_records.rotations_enabled`, a dated `internship_rotations` table and nullable narrative `rotation_assignments` JSON snapshots. Existing placements/attendance/evaluations and legacy narratives are not rewritten. No new environment variables.

Authenticated routes under `/api/v1/internship-records/:internshipId/rotations`: GET reads timeline/settings/capabilities; PATCH `/settings` toggles tracking; POST creates, PATCH `/:rotationId` edits and DELETE `/:rotationId` soft-deletes. Existing API aliases use the normal router registry.

Only the owning student writes. Pending/ongoing records can toggle; assignments require an enabled, ongoing internship. Reads allow the owner, Admin, the assigned employer and heads whose current database department matches the student. Writes lock the parent before status/date/overlap checks; narrative writes use the same lock. Disabling retains history; finalized records are read-only.

Narrative create/edit accepts optional JSON-array `rotation_ids`. IDs must belong to the internship and overlap coverage; existing saved IDs may retain a removed assignment snapshot. Omitted selections preserve snapshots on edit; [] clears them. Reads and printing use saved `rotation_assignments`, independent of later timeline changes. Overall supervision, hours and evaluation slots stay on the original internship.

Tests: tests/internship-rotations.test.js, plus existing internship update/start-date/narrative/department-access checks.

### Internship rejection reasons

Apply backend `scripts/2026-10-27-internship-rejection-reason.sql` before deploying both applications. Staff must enter a reason (up to 1,000 characters) when rejecting a pending internship record, from either the list or detail confirmation. The saved reason is the student notification message and appears on their rejected record card. Failed submissions retain the reason; restoring clears it on the record, while previous notifications remain historical. Existing rejected records have no reason until a future rejection. No environment changes are required.

### Map department filter

The map supports department acronym filtering alongside search and region. Filtering applies to individual interns at mixed-department company sites, and the same results drive pins, company details, city counts and recommendations. The backend includes department metadata from the latest academic row and availableDepartments in the map response. Deploy both applications; no SQL or environment changes are needed.

### Student-profile rotation visibility

The Company rotations panel in searched student profiles is visible only to the student's current department head. The profile response exposes the rotation internship ID only after a current database department match; the frontend requires explicit permission and the head role. Student My Records management and existing authorized staff record-detail views retain their permissions. Deploy both applications. No SQL or environment changes.
