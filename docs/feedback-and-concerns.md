# Feedback & Concerns

Deploy the backend and frontend together after applying [feedback-and-concerns.sql](./feedback-and-concerns.sql). This is an additive schema migration; there are no existing feedback rows to backfill. It creates four feature tables and appends notification types while preserving the installed enum members.

Use the existing **private** SUPABASE_BUCKET. No new environment variable, API key, storage bucket, or dependency is needed. Feedback objects use a feedback/ prefix. The bucket must not expose public object reads; downloads receive short-lived URLs only after backend authorization. No migration has been executed against the live database. Existing installations must also apply [feedback-author-actions.sql](./feedback-author-actions.sql) once before deploying author edit/delete support. Fresh installations can run feedback-and-concerns.sql alone; it already includes the new fields and cleanup table.

## Workflow and access

- Employers create structured posts: category, subject (160 characters), description (5,000 characters), optional internship tags, and up to three PDF/PNG/JPG/WebP attachments (5 MB each).
- Categories: Platform Feedback, Technical Issue, Internship Feedback & Concerns, General Feedback.
- Tagging is available only for Internship Feedback & Concerns. Only the author's assigned, non-deleted ongoing/finished internships with academic department information are eligible. Maximum 200 per post.
- The author sees their own posts. Admin sees all. General Feedback is visible to every department head, including registrar heads. Technical Issues and Platform Feedback are limited to the author and Admin. Internship Feedback & Concerns includes only heads whose current database department matches a stored mention. These rules apply to the feed, details, replies, status changes and attachments, including legacy posts. Students and unrelated employers are denied on every endpoint.
- Each mention captures the student/company/department labels when posted. The existing internship table has no historical department field; the latest academic department is snapshotted at submission. Later student transfers do not change the stored audience. Post authors can edit tags. Existing selected links retain their snapshots; newly selected internships must still belong to the employer.
- A post with CCS and CITHM interns is one shared discussion visible in full to both heads and Admin. The composer previews this audience.
- Untagged Internship Feedback & Concerns, Technical Issues and Platform Feedback are visible only to the author and Admin. General Feedback includes all department heads without requiring tags. Notifications and audience labels use the same category rules. Existing General Feedback becomes visible under the new policy without a migration; older posts are not retroactively notified.
- Allowed participants reply. Staff can add internal notes that employers cannot read, including through reply pagination. Internal notes notify staff only and do not update employer-visible feed timestamps.
- Staff move discussions between Open, In review, and Resolved. Resolved discussions accept new replies after staff reopen them.
- Each distinct recipient gets one database notification per event after the tag audience has been resolved. Notification creation participates in the post/reply transaction. Socket notifications and cache invalidation run after commit.
- Mention/reply/status notifications open /feedback?post=UUID. Private socket rooms receive a non-sensitive feedback_updated ID and readers reauthorize.
- Frontend: desktop feed plus discussion pane; mobile full-screen discussion with a back button. Search/category/status filters, pagination, bounded loading and retry states, optional attachments, and safe plain-text rendering.

## API (/api/v1 and existing legacy mounting)

All paths require verifyUser and employer/department_head/admin roles, private/no-store, and rate limits.

- GET /feedback: scoped paginated feed (page, category, status, search).
- GET /feedback/interns: employer-only eligible internship picker.
- POST /feedback: employer-only multipart form (category, subject, description, internshipIds JSON array, attachments files). On success returns id plus the saved authorized detail (post, mention snapshots, attachment metadata, empty replies). That detail is returned only after commit and contains no storage paths. The frontend seeds its user/role-scoped cache, reveals the first unfiltered page, cancels stale pre-write reads and refreshes without relying on sockets. Older ID-only responses use an authorized detail read as a fallback.
- GET /feedback/:id: authorized post, mentions, attachment metadata, latest 100 replies.
- GET /feedback/:id/replies?before=REPLY_UUID: older 100 replies, stable timestamp/ID cursor.
- POST /feedback/:id/replies: body and optional staff-only isInternal boolean.
- PATCH /feedback/:id/status: staff-only status transition.
- GET /feedback/:id/attachments/:attachmentId: authorizes the discussion before signing that exact attachment.

The Next.js /api/feedback/:postId/attachments/:attachmentId route uses the existing server session, calls the authorized backend endpoint, and downloads bytes with private/no-store and nosniff headers. Storage paths are not exposed by list/detail endpoints. PDF attachments open in the existing shared React-PDF preview with print/download controls; other attachments retain the download action.

Storage writes happen outside database locks. Tags are rechecked in the transaction. Upload failures clean staged objects; uncertain database commits preserve them to avoid deleting potentially committed attachments. Timeouts are unknown outcomes: refresh before resubmitting.

## Checks

Backend tests/feedback.test.js covers scopes, multi-department snapshots, recipient deduplication, forged tags, internal notes, attachment signatures, rollback and uncertain commit behavior. tests/feedback-routes.test.js exercises authenticated HTTP and multipart boundaries with database/storage mocks.

Frontend tests/feedback.test.mjs covers audience calculation, attachment validation, notification links, mobile/desktop thread rendering, access-denied cache hiding, and draft-preserving reply behavior.

The actual migration and live account workflows require deployment/application by the project owner. Automated tests use placeholders and mocks; they do not query the live database.

## Author updates, deletion and attachment previews

- Only the employer who authored a post can update or permanently delete it. Admin and department heads cannot change another author's post.
- Any permitted participant may edit/delete only their own replies or internal notes. A changed post audience is rechecked for every read and write. Existing intern snapshots can be retained; newly added tags are revalidated against the employer's assigned internships.
- PATCH /feedback/:id accepts the same multipart fields as create, plus removedAttachmentIds (a JSON array). Retained files plus new uploads cannot exceed three. DELETE /feedback/:id permanently removes the post, mentions, replies, attachment metadata and its notifications.
- PATCH /feedback/:id/replies/:replyId accepts body; DELETE at that path removes the author's reply. The internal/public flag cannot be changed through reply editing.
- Storage paths are queued for deletion in the same transaction as post/file removal. After commit the backend removes the actual objects. If storage is unavailable, the durable feedback_file_cleanup queue is retried by the backend every five minutes while running. A delete response reports cleanupPending instead of losing track of those files. No storage request holds a database connection or row lock.
- Files removed from an edited post use the same queue. New staged uploads are cleaned up after a rejected transaction; uncertain commits preserve potentially saved uploads.
- Audience revocation clears old recipients' notifications and emits an ID-only refresh to the old and new audience. Replies/attachments inherit the updated visibility. Internal note changes refresh staff only.
- public_reply_version and staff_reply_version default to zero for all existing posts. Public reply mutations increment both; internal mutations increment only the staff counter. The API exposes only the viewer's reply_version. Updated/deleted history is authoritative when that version changes, including older paginated replies.
- Images display inline through the authenticated, private/no-store Next.js route and can be enlarged. PDFs use the existing React-PDF preview. Downloads occur only through an explicit download=1 action.
- Tests: backend tests/feedback-author-actions.test.js exercises authorization, audience changes, permanent deletion, queue rollback, storage retries and private/public history revisions using an isolated in-memory database.
