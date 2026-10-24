import { randomUUID } from "node:crypto";
import { queueFeedbackFiles } from "./feedbackFileCleanup.js";
import { assertRole, validatePost, feedbackScope, departmentFeedbackScope, uniqueRecipients, STATUSES, STAFF, fail } from "./feedbackPolicy.js";

// Department/student labels are captured when the post is created. Future academic
// transfers do not silently change an existing discussion's department audience.
const internsSQL = `
 SELECT ir.id, ir.user_id AS student_id, ir.company_name, ir.internship_position,
   CONCAT_WS(' ', up.first_name, up.last_name) AS student_name,
   sai.department_id, d.code AS department_code, d.name AS department_name
 FROM internship_records ir
 JOIN users u ON u.id = ir.user_id AND u.deleted_at IS NULL
 JOIN user_profiles up ON up.user_id = ir.user_id
 JOIN student_academic_info sai ON sai.user_id = ir.user_id
   AND sai.id = (SELECT MAX(s.id) FROM student_academic_info s WHERE s.user_id = ir.user_id)
 JOIN departments d ON d.id = sai.department_id
 WHERE ir.employer_id = ? AND ir.deleted_at IS NULL AND ir.status IN ('ongoing','finished')`;
const headerSQL = `SELECT p.*, CONCAT_WS(' ', up.first_name, up.last_name) AS author_name
 FROM feedback_posts p LEFT JOIN user_profiles up ON up.user_id = p.author_id`;

export function createFeedbackService({ db, afterCommit = () => {} }) {
  async function read(work) {
    const c = await db.getConnection();
    try { return await work(c); } finally { c.release(); }
  }
  async function transaction(work) {
    const c = await db.getConnection(); let attempted = false;
    try {
      await c.beginTransaction();
      const result = await work(c);
      attempted = true; await c.commit();
      return result;
    } catch (error) {
      try { await c.rollback(); } catch { /* Preserve the original failure. */ }
      if (attempted) error.commitUncertain = true;
      throw error;
    } finally { c.release(); }
  }
  function scopedHeader(user) {
    const version = user.role === "employer" ? "public_reply_version" : "staff_reply_version";
    return headerSQL.replace("p.*", "p.id, p.author_id, p.category, p.subject, p.description, p.status, p.created_at, p.updated_at, p." + version + " AS reply_version");
  }
  async function bumpReplies(c, id, internal) {
    await c.execute("UPDATE feedback_posts SET staff_reply_version = staff_reply_version + 1" +
      (internal ? "" : ", public_reply_version = public_reply_version + 1, updated_at = CURRENT_TIMESTAMP") + " WHERE id = ?", [id]);
  }
  async function visible(c, user, id, lock = false) {
    const scope = feedbackScope(user);
    const [rows] = await c.execute(scopedHeader(user) + " WHERE p.id = ? AND " + scope.sql + (lock ? " FOR UPDATE" : ""), [id, ...scope.params]);
    if (!rows.length) fail(404, "This discussion is unavailable or you do not have access.");
    return rows[0];
  }
  async function detailRows(c, user, id) {
        const post = await visible(c, user, id);
        const [mentions] = await c.execute("SELECT internship_id, student_name, department_id, department_code, department_name, company_name FROM feedback_mentions WHERE post_id = ? ORDER BY student_name", [id]);
        const [attachments] = await c.execute("SELECT id, filename, mime_type, size_bytes FROM feedback_attachments WHERE post_id = ? ORDER BY id", [id]);
        // Return the latest 100 in chronological order, with older replies available separately.
        const [replies] = await c.execute(`SELECT fr.id, fr.author_id, fr.body, fr.is_internal, fr.created_at,
          CONCAT_WS(' ', up.first_name, up.last_name) AS author_name, r.role AS author_role
          FROM feedback_replies fr LEFT JOIN user_profiles up ON up.user_id = fr.author_id
          LEFT JOIN users u ON u.id = fr.author_id LEFT JOIN roles r ON r.id = u.role_id
          WHERE fr.post_id = ?` + (user.role === "employer" ? " AND fr.is_internal = 0" : "") + " ORDER BY fr.created_at DESC, fr.id DESC LIMIT 101", [id]);
        const moreReplies = replies.length > 100;
        return { post, mentions, attachments, replies: replies.slice(0, 100).reverse(), moreReplies };
  }
  async function participants(c, postId, authorId, internal = false) {
    const [rows] = await c.execute(`
      SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id
      JOIN feedback_posts p ON p.id = ?
      WHERE u.deleted_at IS NULL AND (
        r.role = 'admin' OR
        (r.role = 'department_head' AND ` + departmentFeedbackScope("p", "u.id") + ")" +
        (internal ? "" : " OR u.id = ?") + ")", internal ? [postId] : [postId, authorId]);
    return rows;
  }
  async function notify(c, ids, actor, postId, type, title, message) {
    for (const id of ids) await c.execute(
      "INSERT INTO notifications (user_id, sender_id, type, title, message, link_uuid) VALUES (?, ?, ?, ?, ?, ?)",
      [id, actor.id, type, title, message, postId]);
  }
  function deliver(result) {
    try { afterCommit(result); } catch { /* Committed writes must stay successful. */ }
    return result;
  }
  return {
    async interns(user) {
      assertRole(user);
      if (user.role !== "employer") fail(403, "Only employers can create feedback posts.");
      return read(async c => { const [rows] = await c.execute(internsSQL + " ORDER BY up.last_name, up.first_name, ir.id", [user.id]); return rows; });
    },
    async list(user, filters = {}) {
      const scope = feedbackScope(user);
      const page = Math.min(100000, Math.max(1, Number.parseInt(filters.page, 10) || 1));
      const conditions = [scope.sql]; const values = [...scope.params];
      if (filters.category && filters.category !== "all") { conditions.push("p.category = ?"); values.push(filters.category); }
      if (filters.status && filters.status !== "all") { conditions.push("p.status = ?"); values.push(filters.status); }
      const search = String(filters.search || "").trim().slice(0, 160);
      if (search) { conditions.push("(p.subject LIKE ? OR p.description LIKE ?)"); values.push("%" + search + "%", "%" + search + "%"); }
      const where = " WHERE " + conditions.join(" AND ");
      return read(async c => {
        const [[count]] = await c.execute("SELECT COUNT(*) AS total FROM feedback_posts p" + where, values);
        const counts = ", (SELECT COUNT(*) FROM feedback_attachments fa WHERE fa.post_id = p.id) AS attachment_count, (SELECT COUNT(*) FROM feedback_replies fr WHERE fr.post_id = p.id" + (user.role === "employer" ? " AND fr.is_internal = 0" : "") + ") AS reply_count ";
        const listSQL = scopedHeader(user).replace(" FROM feedback_posts", counts + " FROM feedback_posts");
        const [posts] = await c.execute(listSQL + where + " ORDER BY p.updated_at DESC, p.id DESC LIMIT 15 OFFSET " + ((page - 1) * 15), values);
        if (posts.length) {
          const [mentions] = await c.execute("SELECT post_id, student_name, department_code FROM feedback_mentions WHERE post_id IN (" + posts.map(() => "?").join(",") + ") ORDER BY student_name", posts.map(p => p.id));
          for (const post of posts) post.mentions = mentions.filter(m => m.post_id === post.id);
        }
        return { posts, page, total: Number(count.total), totalPages: Math.max(1, Math.ceil(count.total / 15)) };
      });
    },
    async detail(user, id) {
      assertRole(user);
      return read(c => detailRows(c, user, id));
    },
    async replies(user, id, before) {
      assertRole(user);
      if (typeof before !== "string" || !/^[a-f0-9-]{36}$/i.test(before)) fail(400, "Invalid discussion page.");
      return read(async c => {
        const post = await visible(c, user, id);
        const [anchor] = await c.execute("SELECT id, created_at FROM feedback_replies WHERE id = ? AND post_id = ?" + (user.role === "employer" ? " AND is_internal = 0" : ""), [before, id]);
        if (!anchor.length) fail(400, "Invalid discussion page.");
        const [rows] = await c.execute(`SELECT fr.id, fr.author_id, fr.body, fr.is_internal, fr.created_at,
          CONCAT_WS(' ', up.first_name, up.last_name) AS author_name, r.role AS author_role
          FROM feedback_replies fr LEFT JOIN user_profiles up ON up.user_id = fr.author_id
          LEFT JOIN users u ON u.id = fr.author_id LEFT JOIN roles r ON r.id = u.role_id
          WHERE fr.post_id = ? AND (fr.created_at < ? OR (fr.created_at = ? AND fr.id < ?))` +
          (user.role === "employer" ? " AND fr.is_internal = 0" : "") + " ORDER BY fr.created_at DESC, fr.id DESC LIMIT 101",
          [id, anchor[0].created_at, anchor[0].created_at, before]);
        return { replies: rows.slice(0, 100).reverse(), moreReplies: rows.length > 100, replyVersion: post.reply_version };
      });
    },
    async create(user, body, attachments = []) {
      assertRole(user); if (user.role !== "employer") fail(403, "Only employers can create feedback posts.");
      const input = validatePost(body); const id = randomUUID();
      const result = await transaction(async c => {
        let mentions = [];
        if (input.ids.length) {
          const [rows] = await c.execute(internsSQL + " AND ir.id IN (" + input.ids.map(() => "?").join(",") + ") FOR UPDATE", [user.id, ...input.ids]);
          if (rows.length !== input.ids.length) fail(403, "You can tag only your own supervised internships with a department.");
          mentions = rows;
        }
        await c.execute("INSERT INTO feedback_posts (id, author_id, category, subject, description) VALUES (?, ?, ?, ?, ?)", [id, user.id, input.category, input.subject, input.description]);
        for (const m of mentions) await c.execute(`INSERT INTO feedback_mentions
          (post_id, internship_id, student_id, student_name, department_id, department_code, department_name, company_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, m.id, m.student_id, m.student_name, m.department_id, m.department_code || "", m.department_name || "", m.company_name || ""]);
        for (const a of attachments) await c.execute("INSERT INTO feedback_attachments (id, post_id, storage_path, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)", [a.id, id, a.path, a.filename, a.mime, a.size]);
        const recipients = uniqueRecipients(await participants(c, id, user.id), user.id);
        const title = "New feedback or concern";
        const message = mentions.length ? "An employer mentioned supervised interns in a private discussion." :
          input.category === "general_feedback" ? "An employer shared general feedback with school staff." :
          input.category === "technical_issue" ? "An employer reported a technical issue." :
          input.category === "platform_feedback" ? "An employer submitted platform feedback." : "An employer submitted private internship feedback.";
        await notify(c, recipients, user, id, "feedback_mentioned", title, message);
        // Return the committed, authorized view so the client can display the post
        // without waiting for a second read or a socket notification.
        const post = await visible(c, user, id);
        const detail = {
          post,
          mentions: mentions.map(m => ({
            internship_id: m.id, student_name: m.student_name, department_id: m.department_id,
            department_code: m.department_code || "", department_name: m.department_name || "", company_name: m.company_name || "",
          })),
          attachments: attachments.map(a => ({ id: a.id, filename: a.filename, mime_type: a.mime, size_bytes: a.size })),
          replies: [], moreReplies: false,
        };
        return { success: true, id, detail, recipients, type: "feedback_mentioned", title, message };
      });
      return deliver(result);
    },
    async reply(user, id, body) {
      assertRole(user);
      const text = String(body.body || "").trim();
      if (!text || text.length > 5000) fail(400, "Enter a reply of up to 5,000 characters.");
      const internal = body.isInternal === true;
      if (internal && !STAFF.includes(user.role)) fail(403, "Internal notes are for school staff only.");
      return deliver(await transaction(async c => {
        const post = await visible(c, user, id, true);
        if (post.status === "resolved") fail(409, "This discussion is resolved. School staff can reopen it before you reply.");
        const replyId = randomUUID();
        await c.execute("INSERT INTO feedback_replies (id, post_id, author_id, body, is_internal) VALUES (?, ?, ?, ?, ?)", [replyId, id, user.id, text, internal ? 1 : 0]);
        // Internal notes do not change employer-visible feed ordering.
        await bumpReplies(c, id, internal);
        const recipients = uniqueRecipients(await participants(c, id, post.author_id, internal), user.id);
        const title = internal ? "New internal discussion note" : "New feedback reply";
        const message = "There is an update in a private feedback discussion.";
        await notify(c, recipients, user, id, "feedback_reply", title, message);
        return { success: true, id, replyId, recipients, type: "feedback_reply", title, message };
      }));
    },
    async status(user, id, status) {
      assertRole(user);
      if (!STAFF.includes(user.role)) fail(403, "Only school staff can update discussion status.");
      if (!STATUSES.includes(status)) fail(400, "Choose a valid status.");
      return deliver(await transaction(async c => {
        const post = await visible(c, user, id, true);
        if (post.status === status) return { success: true, id, recipients: [] };
        await c.execute("UPDATE feedback_posts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
        const recipients = uniqueRecipients(await participants(c, id, post.author_id), user.id);
        const title = "Feedback status updated";
        const message = "A feedback discussion is now " + status.replaceAll("_", " ") + ".";
        await notify(c, recipients, user, id, "feedback_status", title, message);
        return { success: true, id, recipients, type: "feedback_status", title, message };
      }));
    },

    async update(user, id, body, added = []) {
      assertRole(user);
      const input = validatePost(body);
      return deliver(await transaction(async c => {
        const old = await visible(c, user, id, true);
        if (user.role !== "employer" || old.author_id !== user.id) fail(403, "Only the author can edit this feedback.");
        const before = uniqueRecipients(await participants(c, id, old.author_id), null);
        const [existingMentions] = await c.execute("SELECT internship_id, student_id, student_name, department_id, department_code, department_name, company_name FROM feedback_mentions WHERE post_id = ?", [id]);
        const snapshots = new Map(existingMentions.map(m => [m.internship_id, { ...m, id: m.internship_id }]));
        const newIds = input.ids.filter(key => !snapshots.has(key));
        if (newIds.length) {
          const [rows] = await c.execute(internsSQL + " AND ir.id IN (" + newIds.map(() => "?").join(",") + ") FOR UPDATE", [user.id, ...newIds]);
          if (rows.length !== newIds.length) fail(403, "You can tag only your own supervised internships.");
          for (const row of rows) snapshots.set(row.id, row);
        }
        const [attachments] = await c.execute("SELECT id, storage_path FROM feedback_attachments WHERE post_id = ?", [id]);
        let removed;
        try { removed = typeof body.removedAttachmentIds === "string" ? JSON.parse(body.removedAttachmentIds) : body.removedAttachmentIds || []; }
        catch { fail(400, "Choose valid attachments to remove."); }
        if (!Array.isArray(removed) || removed.length > 3 || removed.some(key => typeof key !== "string" || !attachments.some(a => a.id === key))) fail(400, "Choose valid attachments to remove.");
        removed = [...new Set(removed)];
        if (attachments.length - removed.length + added.length > 3) fail(400, "Keep up to three attachments in total.");
        const cleanupIds = await queueFeedbackFiles(c, attachments.filter(a => removed.includes(a.id)).map(a => a.storage_path));
        for (const key of removed) await c.execute("DELETE FROM feedback_attachments WHERE id = ? AND post_id = ?", [key, id]);
        for (const a of added) await c.execute("INSERT INTO feedback_attachments (id, post_id, storage_path, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)", [a.id, id, a.path, a.filename, a.mime, a.size]);
        await c.execute("UPDATE feedback_posts SET category = ?, subject = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [input.category, input.subject, input.description, id]);
        await c.execute("DELETE FROM feedback_mentions WHERE post_id = ?", [id]);
        for (const key of input.ids) {
          const m = snapshots.get(key);
          await c.execute("INSERT INTO feedback_mentions (post_id, internship_id, student_id, student_name, department_id, department_code, department_name, company_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, key, m.student_id, m.student_name, m.department_id, m.department_code || "", m.department_name || "", m.company_name || ""]);
        }
        const recipients = uniqueRecipients(await participants(c, id, user.id), user.id);
        const removedUsers = before.filter(key => key !== user.id && !recipients.includes(key));
        for (const key of removedUsers) await c.execute("DELETE FROM notifications WHERE link_uuid = ? AND user_id = ? AND type IN ('feedback_mentioned','feedback_reply','feedback_status')", [id, key]);
        const title = "Feedback updated", message = "An employer updated a feedback discussion.";
        await notify(c, recipients, user, id, "feedback_mentioned", title, message);
        return { success: true, id, detail: await detailRows(c, user, id), recipients, refreshRecipients: before, type: "feedback_mentioned", title, message, cleanupIds };
      }));
    },
    async remove(user, id) {
      assertRole(user);
      return deliver(await transaction(async c => {
        const post = await visible(c, user, id, true);
        if (user.role !== "employer" || post.author_id !== user.id) fail(403, "Only the author can delete this feedback.");
        const refreshRecipients = uniqueRecipients(await participants(c, id, post.author_id), null);
        const [attachments] = await c.execute("SELECT storage_path FROM feedback_attachments WHERE post_id = ?", [id]);
        const cleanupIds = await queueFeedbackFiles(c, attachments.map(a => a.storage_path));
        await c.execute("DELETE FROM notifications WHERE link_uuid = ? AND type IN ('feedback_mentioned','feedback_reply','feedback_status')", [id]);
        for (const table of ["feedback_replies","feedback_mentions","feedback_attachments"]) await c.execute("DELETE FROM " + table + " WHERE post_id = ?", [id]);
        await c.execute("DELETE FROM feedback_posts WHERE id = ? AND author_id = ?", [id, user.id]);
        return { success: true, id, deleted: true, recipients: [], refreshRecipients, cleanupIds };
      }));
    },
    async changeReply(user, id, replyId, body, deleting = false) {
      assertRole(user);
      const text = String(body?.body || "").trim();
      if (!deleting && (!text || text.length > 5000)) fail(400, "Enter a reply of up to 5,000 characters.");
      return deliver(await transaction(async c => {
        const post = await visible(c, user, id, true);
        const [rows] = await c.execute("SELECT id, author_id, body, is_internal, created_at FROM feedback_replies WHERE id = ? AND post_id = ?" + (user.role === "employer" ? " AND is_internal = 0" : "") + " FOR UPDATE", [replyId, id]);
        if (!rows.length) fail(404, "Reply not found.");
        const reply = rows[0];
        if (reply.author_id !== user.id) fail(403, "Only the author can change this reply.");
        if (deleting) await c.execute("DELETE FROM feedback_replies WHERE id = ? AND post_id = ? AND author_id = ?", [replyId, id, user.id]);
        else await c.execute("UPDATE feedback_replies SET body = ? WHERE id = ? AND post_id = ? AND author_id = ?", [text, replyId, id, user.id]);
        await bumpReplies(c, id, Boolean(reply.is_internal));
        const refreshRecipients = uniqueRecipients(await participants(c, id, post.author_id, Boolean(reply.is_internal)), null);
        return { success: true, id, replyVersion: (await visible(c, user, id)).reply_version, recipients: [], refreshRecipients, deletedReplyId: deleting ? replyId : undefined, reply: deleting ? undefined : { ...reply, body: text } };
      }));
    },

    async attachment(user, postId, attachmentId) {
      assertRole(user);
      return read(async c => {
        await visible(c, user, postId);
        const [rows] = await c.execute("SELECT storage_path, filename, mime_type FROM feedback_attachments WHERE id = ? AND post_id = ?", [attachmentId, postId]);
        if (!rows.length) fail(404, "Attachment not found.");
        return rows[0];
      });
    },
  };
}
