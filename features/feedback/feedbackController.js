import { randomUUID } from "node:crypto";
import { createFeedbackFileCleanup } from "./feedbackFileCleanup.js";
import { db } from "../../config/db.js";
import { supabase } from "../../config/supabase.js";
import { cleanupUploadPaths } from "../../config/uploadLifecycle.js";
import { reportError } from "../../config/errorTracking.js";
import { invalidateNotificationsCache } from "../../config/cache/notificationsCache.js";
import { createFeedbackService } from "./feedbackService.js";
import { validatePost, attachmentType, fail } from "./feedbackPolicy.js";
const BUCKET = process.env.SUPABASE_BUCKET;
export const cleanupFeedbackFiles = createFeedbackFileCleanup({ db, storage: supabase.storage, bucket: BUCKET, report: error => reportError("Feedback attachment cleanup failed:", error) });
function service(req) {
  return createFeedbackService({ db, afterCommit(result) {
    for (const userId of result.recipients || []) {
      invalidateNotificationsCache(userId);
      try {
        req.app.get("socketio")?.to("user-" + userId).emit("new_notification", {
          type: result.type, title: result.title, message: result.message, link_uuid: result.id,
        });
      } catch (error) { reportError("Feedback notification delivery failed:", error); }
    }
    // Refresh events carry only the post ID, not discussion text or attachments.
    // Recipients must independently authorize their next read.
    for (const userId of new Set([req.verifiedUser.id, ...(result.recipients || []), ...(result.refreshRecipients || [])])) {
      invalidateNotificationsCache(userId);
      try { req.app.get("socketio")?.to("user-" + userId).emit("feedback_updated", { id: result.id }); }
      catch (error) { reportError("Feedback refresh delivery failed:", error); }
    }
  } });
}
function handler(work) {
  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const result = await work(req, service(req));
      let cleanupPending = false;
      // The database mutation is already committed. Try queued object removal now;
      // cleanup failure reports pending retry without undoing the post/reply action.
      if (result.cleanupIds?.length) {
        try { cleanupPending = (await cleanupFeedbackFiles(result.cleanupIds)).pending > 0; }
        catch (error) { cleanupPending = true; reportError("Feedback cleanup retry queued:", error); }
      }
      if (result.recipients) return res.json({
        success: true, id: result.id, detail: result.detail, reply: result.reply, replyVersion: result.replyVersion, deletedReplyId: result.deletedReplyId,
        deleted: result.deleted, cleanupPending,
        message: result.deleted ? (cleanupPending ? "Feedback deleted. Attachment removal will retry automatically." : "Feedback and attachments deleted.") : "Discussion updated.",
      });
      return res.json(result);
    }
    catch (error) {
      if (!error.status || error.status >= 500) reportError("Feedback request failed:", error);
      return res.status(error.status || 500).json({
        success: false, error: error.status && error.status < 500 ? error.message :
          error.commitUncertain ? "Confirmation was interrupted. Refresh the feed before posting again." : "Could not complete the feedback request. Please try again.",
      });
    }
  };
}
export const listFeedback = handler((req, s) => s.list(req.verifiedUser, req.query));
export const getFeedback = handler((req, s) => s.detail(req.verifiedUser, req.params.id));
export const getFeedbackReplies = handler((req, s) => s.replies(req.verifiedUser, req.params.id, req.query.before));
export const getFeedbackInterns = handler(async (req, s) => ({ interns: await s.interns(req.verifiedUser) }));
export const replyFeedback = handler((req, s) => s.reply(req.verifiedUser, req.params.id, req.body));
export const setFeedbackStatus = handler((req, s) => s.status(req.verifiedUser, req.params.id, req.body.status));
export const getFeedbackAttachment = handler(async (req, s) => {
  // Authorize the post/attachment pair before minting the 120-second storage URL.
  const attachment = await s.attachment(req.verifiedUser, req.params.id, req.params.attachmentId);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(attachment.storage_path, 120);
  if (error || !data?.signedUrl) fail(503, "Attachment is temporarily unavailable.");
  return { url: data.signedUrl, filename: attachment.filename, mime: attachment.mime_type };
});
export const createFeedback = uploadFeedback(false);
export const updateFeedback = uploadFeedback(true);
function uploadFeedback(editing) { return handler(async (req, s) => {
  const input = validatePost(req.body);
  let previous = null;
  if (editing) {
    previous = await s.detail(req.verifiedUser, req.params.id);
    if (previous.post.author_id !== req.verifiedUser.id || req.verifiedUser.role !== "employer") fail(403, "Only the author can edit this feedback.");
  }
  const incoming = req.files || [];
  const types = incoming.map(attachmentType);
  // Reject forged new tags before storage I/O, then recheck them in the transaction.
  // Edits may retain existing mention snapshots even after supervision changes.
  if (input.ids.length) {
    const eligible = new Set((await s.interns(req.verifiedUser)).map(row => row.id));
    if (input.ids.some(id => !eligible.has(id) && !previous?.mentions?.some(m => m.internship_id === id))) fail(403, "You can tag only your own supervised internships.");
  }
  const paths = []; const attachments = [];
  try {
    for (const [index, file] of incoming.entries()) {
      const id = randomUUID(); const path = "feedback/" + req.verifiedUser.id + "/" + id + "." + types[index];
      paths.push(path);
      const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
      if (error) fail(503, "Attachment upload failed. Please try again.");
      const filename = file.originalname.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "attachment." + types[index];
      attachments.push({ id, path, filename, mime: file.mimetype, size: file.size });
    }
    const result = editing ? await s.update(req.verifiedUser, req.params.id, req.body, attachments) : await s.create(req.verifiedUser, req.body, attachments);
    return editing ? result : { success: true, id: result.id, detail: result.detail, message: "Feedback posted. Relevant school staff have been notified." };
  } catch (error) {
    // Discard staged objects only on a definite save failure. A lost COMMIT reply
    // can leave committed attachment rows, so retain their paths for reconciliation.
    if (!error.commitUncertain) await cleanupUploadPaths(paths);
    throw error;
  }
}); }

export const deleteFeedback = handler((req, s) => s.remove(req.verifiedUser, req.params.id));
export const updateFeedbackReply = handler((req, s) => s.changeReply(req.verifiedUser, req.params.id, req.params.replyId, req.body));
export const deleteFeedbackReply = handler((req, s) => s.changeReply(req.verifiedUser, req.params.id, req.params.replyId, null, true));
