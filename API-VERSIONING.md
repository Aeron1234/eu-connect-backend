# API v1

The canonical Express API prefix is `/api/v1`. For example:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/announcements/history
GET  /api/v1/internship-records/overview/:internshipId
```

`config/api.js` owns the prefix and route mounting. Feature routers continue to define relative resource paths. All routers are also mounted at `/eu-connect/api` for compatibility during rollout. The legacy prefix uses the same handlers without redirects, preserving HTTP methods, request bodies, authentication and authorization.

## Caching and request limits

Cache keys and stored paths normalize either prefix to `/api/v1`. Query strings and verified account/role/department context still separate entries. Cache invalidators use canonical paths and recognize legacy paths, including dynamic record/profile families. Writes through either URL invalidate reads through both. Existing TTLs, private/no-store headers and protection against stale reads repopulating the cache remain in place.

Both prefixes share limiter instances. Read-rate keys normalize the prefix so switching URLs cannot create another request budget. Error tracking also uses canonical route patterns to group errors consistently; historical error rows are retained.

During compatibility, login and refresh issue refresh cookies for both `/api/v1/auth` and `/eu-connect/api/auth`. Logout and authentication failures clear both paths. Access cookies remain scoped to `/`, with existing lifetimes and production security settings.

## Frontend configuration and rollout

1. Deploy/restart this backend first so `/api/v1` is available.
2. Set the Next.js server environment variable to the complete API base:

   ```dotenv
   # Local development
   API_BASE_URL=http://localhost:7000/api/v1

   # Production: substitute the actual backend origin
   # API_BASE_URL=https://your-backend.example/api/v1
   ```

3. Deploy/restart the frontend. The frontend helper also accepts the previous base ending in `/eu-connect` or `/eu-connect/api` and converts requests to `/api/v1`, allowing environment settings to be updated gradually.

Next.js proxies both `/api/v1/:path*` and the legacy path to the canonical backend. Its own `/api/reports/*`, `/api/users` and `/api/socket-ticket` handlers retain their URLs. Page routes, the health endpoint `/`, Socket.IO, storage object URLs and database schema are unchanged. No SQL query or data deletion is required.

Keep the compatibility alias until all callers have migrated. When removing it later, remove the legacy rewrite and refresh-cookie scope together, allowing existing sessions to expire or reauthenticate.

## Verification

```sh
npm test
```

The API versioning regressions cover both mounts, authentication/role enforcement, body/query preservation, cache sharing and invalidation, per-user isolation, shared rate limits, and cookie scopes. Existing feature tests exercise the canonical prefix.
