# Backend features

Each feature keeps its HTTP handlers and routes together:

```text
features/
  internship-records/
    controllers/
      internshipRecordControllers.js
    routes/
      internshipRecordRoutes.js
```

Use both subfolders even when a feature has only one controller and one router.
Existing controller and route filenames are preserved. Student and employer
evaluation modules share the `evaluations` feature; socket authentication lives
in `auth`.

Register routers in the root `server.js`. Folder names do not determine endpoint
URLs: those remain defined by router paths and their server registrations.

Shared database/cache configuration, middleware, services, and email helpers
remain in their existing root folders. Feature modules import those shared
dependencies with `../../../`; routes import their feature's controllers with
`../controllers/`.

Backend tests remain in `tests/` and import modules from `features/`. Run the
existing suite from the backend root with `npm test`.
