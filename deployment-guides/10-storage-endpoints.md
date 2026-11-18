# Cloud storage endpoint inventory

Traced November 18, 2026 against the active Express router registrations, their controller functions and shared storage helpers. These are the routes to review when implementing [private Hostinger file storage](09-hostinger-vps-storage.md).

All backend paths below are suffixes mounted under both /api/v1 and /eu-connect/api. For example, POST /dtr/clock-in is publicly addressed as POST /api/v1/dtr/clock-in. Route roles are initial allowlists; controllers and shared guards apply additional ownership, ongoing-internship, supervision, department and Registrar checks. Preserve those checks during migration.

## DTR photos

Route source is features/dtr/routes/dtrRoutes.js; handlers are in features/dtr/controllers/dtrControllers.js and features/dtr/dtrPhoto.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| POST /dtr/clock-in | clockIn | Upload server-stamped JPEG; clean staged object on definite failure | Student |
| PATCH /dtr/clock-out | clockOut | Student photo upload and failure cleanup; admin override can follow the photo-free branch | Student, admin |
| GET /dtr/:dtrId/photo/:kind | getDtrPhoto | Issue authorized 120-second signed URL for in/out photo | Student, employer, department head, admin |
| DELETE /dtr/:dtrId | deleteDTR | Queue both photos in the deletion transaction and attempt object removal after commit | Student, admin |

Break/resume, schedule/absence actions, overtime requests, explanations and automatic closure do not themselves upload photos. Photo access is a separate endpoint from attendance metadata/history.

## Student requirement documents

Route source is features/documents/routes/fileRoutes.js; handlers are in features/documents/controllers/fileControllers.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| POST /internships/files/new | uploadInternshipFile | Upload document and clean staged object on definite rollback | Student, admin |
| GET /internships/files/:fileId/download | downloadInternshipFile | Issue authorized 120-second signed URL | Student, department head, admin |
| DELETE /file/:fileId | deleteFile | Remove the stored object associated with the document | Student, admin |

GET /internships/files and GET /internships/files/requirements read database metadata. PATCH /files/:fileId/accept changes the document decision. Their file-related purpose does not itself imply an object-store operation.

## Employer uploads and searched student files

Route source is features/users/routes/searchedUserRoutes.js; handlers are in features/users/controllers/searchedUserController.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| POST /searched-user/files/:searchedUserId | uploadFileToSearchedStudent | Upload certificate/document and clean staged object on definite failure | Employer, admin |
| GET /searched-user/files/:fileId/:searchedUserId | downloadSearchedStudentInternshipFile | Issue authorized signed URL | Employer, department head, admin |
| DELETE /searched-user/files/:fileId/:searchedUserId | deleteSearchedStudentFile | Remove associated object after the applicable ownership/supervision checks | Employer, department head, admin |

GET /searched-user/files/:searchedUserId and GET /searched-user/employer-uploaded-files/:searchedUserId list database metadata. The separate download route accesses storage.

## Department-head record document download

Route source is features/internship-records/routes/internshipRecordRoutes.js; handler is in features/internship-records/controllers/internshipRecordControllers.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| GET /internship-records/files/download/:internshipId/:fileId | downloadInternshipRecordFile | Issue authorized signed URL for a placement document | Department head |

GET /internship-records/documents/:internshipId lists metadata. Student record deletion soft-deletes the placement; the retention worker performs eventual private-file cleanup after the retention period.

## Summary reports and memorabilia images

Route source is features/summary-reports/routes/summaryReportRoutes.js; handlers/helpers are in features/summary-reports/controllers/summaryReportControllers.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| GET /summary-reports | listSummaryReports | withReportImages signs image URLs, currently for 3,600 seconds | Student |
| GET /internship-records/:internshipId/summary-report | getInternshipRecordSummaryReport | Same helper signs report image URLs | Department head |
| GET /summary-reports/:internshipId/attachment | getSummaryAttachment | Sign legacy attachment URL for 120 seconds | Student |
| GET /internship-records/:internshipId/summary-report/attachment | getInternshipRecordSummaryAttachment | Sign legacy attachment URL for 120 seconds | Department head |
| POST /summary-reports/:internshipId | saveSummaryReport | Upload images and clean staged files on definite failure; return save confirmation | Student |
| PATCH /summary-reports/:internshipId | saveSummaryReport | Add/remove images, clean removed objects and preserve uncertain-commit handling | Student |
| DELETE /summary-reports/:internshipId | deleteSummaryReport | Attempt removal of report images and legacy attachments after database commit | Student |

Report reads therefore have an object-store dependency when images are present. The current removeStoredFile helper logs best-effort removal failure; it does not durably enqueue its own retries. The migration must preserve or deliberately improve this behavior rather than assume every file family has the same cleanup guarantee.

The frontend summary-report PDF endpoint also depends on these files indirectly. app/_services/reports/summaryReportPdf.js fetches the backend report, then fetches each signed image URL before rendering. The corresponding Next route is GET /api/reports/summary-report. Preserve a working server-side image URL flow after migration. This route is on Next.js, outside the backend API prefixes.

Other PDF generators should be evaluated by their actual inputs; the presence of Puppeteer alone does not establish a Supabase Storage dependency.

## Feedback attachments

Route source is features/feedback/routes/feedbackRoutes.js; handlers are in features/feedback/feedbackController.js, with transactions in feedbackService.js and queued cleanup in feedbackFileCleanup.js.

| Method and path | Handler | Cloud storage dependency | Route roles |
| --- | --- | --- | --- |
| POST /feedback | createFeedback | Upload optional attachments; remove staged files on definite failure | Employer |
| PATCH /feedback/:id | updateFeedback | Upload added attachments and durably queue removal of selected old files; attempt cleanup after commit | Employer |
| DELETE /feedback/:id | deleteFeedback | Durably queue the post's attachments and attempt removal after commit | Employer |
| GET /feedback/:id/attachments/:attachmentId | getFeedbackAttachment | Issue authorized 120-second signed URL | Employer, department head, admin |

GET /feedback and GET /feedback/:id return metadata/attachment descriptors, rather than reading the attachment bytes. Replies and status changes use database operations; they do not add attachment uploads through the current reply endpoints.

## Background work and shared helpers

These operations are part of storage migration even though they have no dedicated public endpoint.

| Source | Trigger | Dependency to migrate |
| --- | --- | --- |
| config/uploadLifecycle.js | Upload handler failure | Best-effort removal of staged keys; retain objects when commit status is uncertain |
| config/dtrPhotoCleanup.js | DTR deletion and five-minute worker in server.js | Durable cleanup queue; removes photos and other private object types from the configured bucket |
| features/feedback/feedbackFileCleanup.js | Feedback edits/deletion and five-minute worker | Durable attachment cleanup and retry bookkeeping |
| config/softDeleteRetention.js | 03:30 Asia/Manila daily worker | Collect document, report and photo keys before purging placements, enqueue cleanup in the transaction, then remove through the cleanup worker |

All use the backend's configured storage project/bucket rather than distinct buckets per API route. The provider is created in config/supabase.js and uses bounded fetch behavior from config/storageFetch.js.

## Migration verification

Test every method/path above with a permitted account and with forbidden ownership/department access. Cover records without files, missing files, invalid uploads, legacy attachments, expired URLs, file replacement, definite rollback, uncertain commit and cleanup retries.

Keep response properties and signed access semantics compatible with frontend previews and server-side PDF image fetching. Reconcile database keys with migrated object bytes before switching. Browser map tiles, static avatar images, EmailJS delivery and SQL metadata are separate service paths.

The inventory contains 22 backend method/path combinations plus the dependent frontend summary-report PDF route and shared/background cleanup work. No runtime implementation or live provider operation was changed while producing this inventory.

