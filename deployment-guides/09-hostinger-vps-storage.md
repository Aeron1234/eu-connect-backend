# Move uploaded files to Hostinger VPS storage

Selected deployment target on November 18, 2026. The school wants its uploaded files on the Hostinger VPS. This chapter is a migration and implementation plan. The application currently uses Supabase Storage directly; the existing backend must be adapted and tested before this target can serve uploads.

## What runs where

| Component | Selected location |
| --- | --- |
| Frontend, API, Socket.IO and scheduled jobs | Hostinger VPS |
| Database | School-selected MariaDB service, as described in the backend guide |
| Uploaded documents, DTR photos and report/feedback files | Private persistent directory on the VPS |
| Generated PDF response/browser cache | Existing frontend/Puppeteer runtime; generated responses are separate from stored uploads |
| Off-server file backups | Separate school-controlled backup destination |
| Email delivery | Existing EmailJS service |

Here “VPS storage” means the server's filesystem. It is a different integration from an S3-compatible object storage service. If the school later selects a separate object-storage product, confirm that product's API, credentials and migration requirements.

## Persistent directory and ownership

Use /srv/eu-connect/shared/uploads. It stays outside release directories and survives changing the current release symlink. Keep existing object keys as relative paths under this root so database references can stay stable.

Prepare the directory on the VPS after the euconnect service user exists:

~~~bash
sudo install -d -o euconnect -g euconnect -m 700 /srv/eu-connect/shared/uploads
sudo -u euconnect test -w /srv/eu-connect/shared/uploads
df -h /srv/eu-connect/shared/uploads
df -i /srv/eu-connect/shared/uploads
~~~

Use private file permissions such as 600 and directory permissions such as 700. The supplied backend systemd unit already runs as euconnect and sets UMask=0077. Imported files need the same ownership. Confirm the resolved upload root before any recursive ownership operation.

The storage root must not be inside frontend/public, a release-specific directory, /tmp or node_modules. Deployments and dependency cleanup must not remove uploaded data. Monitor both bytes and inodes and reserve space for the database, builds, Chrome, logs and backups.

## Required application changes before switching

Use the [verified endpoint inventory](10-storage-endpoints.md) to trace each affected route, handler, storage operation and role allowlist, including background cleanup and frontend PDF dependencies.

| Current source | Required work |
| --- | --- |
| config/supabase.js | Replace provider-specific file operations with a storage interface supporting the selected filesystem backend. |
| config/uploadLifecycle.js | Preserve transaction boundaries, upload rollback handling and uncertain-commit behavior using local files. |
| features/documents/controllers/fileControllers.js | Update uploads, previews/downloads, file replacement and deletion. |
| features/dtr/dtrPhoto.js | Persist the backend-stamped JPEG on the private filesystem. |
| features/dtr/controllers/dtrControllers.js | Preserve ownership checks, photo reads and deletion queues. |
| features/feedback/feedbackController.js | Move attachment upload, signed access and deletion. |
| features/summary-reports/controllers/summaryReportControllers.js | Move images, legacy attachments, downloads and removed-file cleanup. |
| features/internship-records/controllers/internshipRecordControllers.js | Replace staff document access/deletion storage calls. |
| features/users/controllers/searchedUserController.js | Replace authorized searched-profile file access. |
| config/dtrPhotoCleanup.js | Remove files from the filesystem with idempotent retries. Its existing queue also handles other private objects. |

Keep the ordinary upload size, file-content/MIME checks, timestamp watermarking and role/department/supervision checks. Maintain existing endpoint response shapes or update all consumers together. Implement atomic writes using a temporary file and rename on the same filesystem. A database rollback must clean only newly staged files; uncertain commits must retain files for reconciliation.

Validate every stored relative key before joining it to the root. Reject absolute paths, parent traversal, unexpected separators and symlink escapes. Keep original user filenames as metadata and generate safe storage keys on the backend.

A storage path setting such as LOCAL_STORAGE_ROOT may be introduced with that implementation. It is a proposed setting, not a supported environment variable today. The current backend.env.example remains accurate for the existing Supabase-dependent application. Removing SUPABASE_URL, SUPABASE_KEY or SUPABASE_BUCKET before replacing their callers will break current features.

## Private download and preview access

Retain authenticated backend authorization before issuing access to a file. Current consumers include images and short-lived signed URLs; replacing them with a public /uploads URL would expose student records.

For compatibility, the new backend can issue short-lived, file-scoped download tokens after its normal role and record checks. A dedicated download endpoint validates the token and maps an opaque ID to a validated storage key. Keep signing secrets server-only and preserve the present expiry policy appropriate to each endpoint. Review caching, logs, inline/content-disposition handling and PDF byte-range support.

Express can stream the file after authorization. Nginx X-Accel-Redirect is an optional optimization after the application supports it. An example for that future implementation is:

~~~nginx
# Optional future location. Backend must authorize and emit X-Accel-Redirect.
location /_private_uploads/ {
    internal;
    alias /srv/eu-connect/shared/uploads/;
}
~~~

The internal directive prevents direct browser access to that location. Nginx also needs permission to traverse/read the chosen files if using this option; the private 700/600 baseline intentionally limits that access to euconnect. Design narrow group/ACL permissions before enabling Nginx file delivery. Keep the existing Express-only Nginx template until this is implemented.

Supabase's current private-bucket model supports limited-time signed access. The new filesystem implementation must preserve equivalent application permissions for these records. [Supabase bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Migrate existing orientation files

1. Inventory the selected Supabase bucket and every database file reference. Include internship_documents.path and legacy url values, both daily_time_records photo paths, feedback_attachments.storage_path, summary_reports.attachment_path and summary_report_images.storage_path. Include paths waiting in feedback_file_cleanup and dtr_photo_cleanup.
2. Export a consistent MariaDB backup and object listing. Record each key, object size and a content checksum calculated while copying. Retain access to the original project during validation.
3. Copy objects into the private upload root, preserving their relative keys and filenames exactly. Use a backend-admin script or authenticated storage tooling with pagination and retry handling. Keep credentials out of command history and logs. A SQL export contains metadata and cannot reconstruct the file bytes.
4. Reconcile database references against copied files. Identify missing objects, unused objects and legacy absolute Supabase URLs separately. Database fields containing relative keys may stay unchanged; URL-only legacy readers may require a mapping/data migration.
5. Test the filesystem storage implementation against a staging copy of the database and files. Verify every file type, authorization boundary and cleanup behavior.
6. During the final transfer, stop frontend and backend writes and scheduled cleanup. Copy changes since the initial transfer, verify checksums/counts again, back up the final state, configure the implemented filesystem provider, then start backend and frontend.
7. Test orientation accounts, documents, DTR photos, report images, feedback attachments, replacements and deletion retries. Verify direct public requests cannot read private files and expired download tokens fail.
8. Retain the original Supabase data for a school-approved recovery period. Retire its credentials/project only after acceptance and successful off-server backup restoration.

For an already-running orientation environment, state the maintenance window to faculty. Deletions may occur during normal use and scheduled retention, so a copy-only operation while both providers continue accepting writes does not establish a consistent migration.

## Backups and rollback

Back up the MariaDB dataset and /srv/eu-connect/shared/uploads together, with a recorded release/provider version. Encrypt off-VPS copies and test a restore to an isolated environment. A VPS disk failure affects both the running application and its local uploads, so an independent backup location is required.

Before switching, keep the previous provider-compatible backend release and Supabase access. If rollback becomes necessary after local writes begin, reconcile those new uploads/deletions and database changes before restoring the previous provider. Reverting only the environment values can leave valid records pointing at files present exclusively on the VPS.

## Acceptance and readiness

- A storage-compatible backend implementation has been deployed and all direct Supabase callers have been addressed.
- Existing relative object keys resolve to byte-identical local files.
- Legacy URL-only records have a tested compatibility path.
- Role restrictions and temporary URL semantics hold across all readers.
- Uploads/replacements, transaction failure cleanup and retry queues work without Supabase.
- Release switching and a reboot preserve the private upload root.
- Storage capacity monitoring and off-server restoration have been demonstrated.
- The faculty-orientation dataset can access its matching migrated files.

This documentation update does not implement the filesystem storage backend, download objects or modify provider settings. The current application can continue using Supabase until the migration implementation is ready.

