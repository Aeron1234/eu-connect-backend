# Admin error tracking

Apply `docs/error-tracking.sql` to the backend MySQL database before deploying the
backend and frontend changes together. The included command
`node scripts/applyErrorTrackingMigration.js` uses the backend's configured
database and verifies the table. The migration adds only `error_events`.
No existing table is altered. The admin page is `/admin/error-tracking`.

The backend records unexpected controller errors, uncaught HTTP route errors,
HTTP 5xx responses without an accompanying error log, and failures in the
attendance and refresh-token cleanup jobs. It stores a request ID, method,
route pattern, status, error code, short diagnostic message, and code location.
It does not store request bodies, cookies, access tokens, uploaded files, or
full stack traces. Rows older than 30 days are removed by a daily batch job.

Only administrators can call `GET /eu-connect/api/errors` and
`GET /eu-connect/api/errors/:fingerprint`. There are no error-tracking write
routes. The request ID is also returned in the `X-Request-ID` response header.

Tracking writes are best effort: a database outage also prevents persistence
to the error table. Fatal process crashes are logged synchronously to the host's
stderr and exit with a nonzero status so the host can restart the process;
database persistence cannot be guaranteed during a fatal crash.
