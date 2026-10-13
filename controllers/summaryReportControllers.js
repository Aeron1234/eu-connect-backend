import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { newUUID, verifyRecordAccess } from "../config/helpers.js";
import { invalidateRouteCache } from "../config/cache.js";
import { reportError } from "../config/errorTracking.js";

const BUCKET = process.env.SUPABASE_BUCKET;
const FIELDS = ["organization_experience", "work_schedule", "memorable_moment", "difficulties_solutions"];
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/pdf": "pdf", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function readContent(body) {
  const content = {};
  for (const field of FIELDS) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (!value || value.length > 6000) return { error: "Complete each section using 1 to 6,000 characters." };
    content[field] = value;
  }
  content.memorabilia_note = typeof body.memorabilia_note === "string" ? body.memorabilia_note.trim() : "";
  if (content.memorabilia_note.length > 2000) return { error: "The memorabilia note is too long." };
  const words = Object.values(content).join(" ").trim().split(/\s+/u).length;
  if (words > 900) return { error: "Keep your report within 900 words so it can fit the three-page format." };
  return { content };
}

async function removeStoredFile(path) {
  if (path) {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) reportError("Summary report attachment cleanup failed:", error);
    } catch (error) {
      reportError("Summary report attachment cleanup failed:", error);
    }
  }
}

export async function listSummaryReports(req, res) {
  try {
    const [rows] = await db.execute(
      `SELECT ir.id AS internship_id, ir.company_name, ir.status, ir.date_started, ir.date_ended,
              sr.id AS report_id, sr.organization_experience, sr.work_schedule,
              sr.memorable_moment, sr.difficulties_solutions, sr.memorabilia_note,
              sr.attachment_name, sr.attachment_type, sr.created_at, sr.updated_at,
              CONCAT_WS(' ', up.first_name, up.last_name) AS student_name
       FROM internship_records ir
       LEFT JOIN summary_reports sr ON sr.internship_id = ir.id
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       WHERE ir.user_id = ? AND ir.deleted_at IS NULL AND ir.status IN ('ongoing', 'finished')
       ORDER BY (ir.status = 'ongoing') DESC, ir.created_at DESC`,
      [req.verifiedUser.id],
    );
    return res.json({ records: rows });
  } catch (error) {
    reportError("List summary reports failed:", error);
    return res.status(500).json({ error: "Could not load summary reports." });
  }
}

export async function getInternshipRecordSummaryReport(req, res) {
  let connection;
  try {
    const { internshipId } = req.params;
    const { id: requesterId, role } = req.verifiedUser;
    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);
    const [rows] = await connection.execute(
      `SELECT sr.id AS report_id, sr.internship_id, ir.company_name,
              CONCAT_WS(' ', up.first_name, up.last_name) AS student_name,
              sr.organization_experience, sr.work_schedule, sr.memorable_moment,
              sr.difficulties_solutions, sr.memorabilia_note,
              sr.attachment_name, sr.attachment_type, sr.created_at, sr.updated_at
       FROM summary_reports sr
       INNER JOIN internship_records ir ON ir.id = sr.internship_id
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       WHERE sr.internship_id = ? AND ir.deleted_at IS NULL LIMIT 1`,
      [internshipId],
    );
    return res.json({ report: rows[0] || null });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    reportError("Get internship record summary report failed:", error);
    return res.status(500).json({ error: "Could not load the summary report." });
  } finally {
    connection?.release();
  }
}

export async function getInternshipRecordSummaryAttachment(req, res) {
  let connection;
  try {
    const { internshipId } = req.params;
    const { id: requesterId, role } = req.verifiedUser;
    connection = await db.getConnection();
    await verifyRecordAccess(connection, internshipId, requesterId, role);
    const [rows] = await connection.execute(
      `SELECT attachment_path FROM summary_reports
       WHERE internship_id = ? AND attachment_path IS NOT NULL LIMIT 1`,
      [internshipId],
    );
    if (!rows.length) return res.status(404).json({ error: "Attachment not found." });
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(rows[0].attachment_path, 120);
    if (error) throw error;
    res.set("Cache-Control", "private, no-store");
    return res.json({ url: data.signedUrl });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    reportError("Get internship record summary attachment failed:", error);
    return res.status(500).json({ error: "Could not open the attachment." });
  } finally {
    connection?.release();
  }
}

export async function saveSummaryReport(req, res) {
  const internshipId = req.params.internshipId;
  const userId = req.verifiedUser.id;
  const { content, error: contentError } = readContent(req.body || {});
  if (contentError) return res.status(400).json({ error: contentError });
  if (req.file && !ALLOWED_MIME.has(req.file.mimetype)) {
    return res.status(400).json({ error: "Use a JPG, PNG, WebP, PDF, DOC, or DOCX attachment." });
  }
  if (req.file && !req.file.size) {
    return res.status(400).json({ error: "The attachment is empty. Choose a different file." });
  }
  if (req.body?.remove_attachment === "true" && req.file) {
    return res.status(400).json({ error: "Choose a replacement file or remove the existing one." });
  }

  let connection;
  let newPath = null;
  let oldPath = null;
  let committed = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [internships] = await connection.execute(
      `SELECT id FROM internship_records
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status IN ('ongoing', 'finished')
       LIMIT 1 FOR UPDATE`,
      [internshipId, userId],
    );
    if (!internships.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Internship record not found." });
    }

    const [existingRows] = await connection.execute(
      "SELECT id, attachment_path FROM summary_reports WHERE internship_id = ? LIMIT 1 FOR UPDATE",
      [internshipId],
    );
    const existing = existingRows[0];
    if (req.method === "POST" && existing) {
      await connection.rollback();
      return res.status(409).json({ error: "A summary report already exists for this internship. Edit it instead." });
    }
    if (req.method === "PATCH" && !existing) {
      await connection.rollback();
      return res.status(404).json({ error: "Summary report not found. Create it first." });
    }

    let attachmentPath = existing?.attachment_path || null;
    let attachmentName = null;
    let attachmentType = null;
    if (req.file) {
      newPath = `summary-reports/${userId}/${internshipId}/${newUUID()}.${EXTENSIONS[req.file.mimetype]}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      attachmentPath = newPath;
      attachmentName = req.file.originalname.slice(0, 255);
      attachmentType = req.file.mimetype;
      oldPath = existing?.attachment_path || null;
    } else if (req.body?.remove_attachment === "true") {
      oldPath = existing?.attachment_path || null;
      attachmentPath = null;
    }

    const values = FIELDS.map((field) => content[field]);
    if (existing) {
      await connection.execute(
        `UPDATE summary_reports SET organization_experience = ?, work_schedule = ?,
          memorable_moment = ?, difficulties_solutions = ?, memorabilia_note = ?,
          attachment_path = ?, attachment_name = CASE WHEN ? THEN ? ELSE attachment_name END,
          attachment_type = CASE WHEN ? THEN ? ELSE attachment_type END
         WHERE id = ? AND user_id = ?`,
        [...values, content.memorabilia_note || null, attachmentPath,
          Boolean(req.file || req.body?.remove_attachment === "true"), attachmentName,
          Boolean(req.file || req.body?.remove_attachment === "true"), attachmentType,
          existing.id, userId],
      );
    } else {
      await connection.execute(
        `INSERT INTO summary_reports
          (id, internship_id, user_id, organization_experience, work_schedule,
           memorable_moment, difficulties_solutions, memorabilia_note,
           attachment_path, attachment_name, attachment_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newUUID(), internshipId, userId, ...values, content.memorabilia_note || null,
          attachmentPath, attachmentName, attachmentType],
      );
    }
    await connection.commit();
    committed = true;
    try {
      invalidateRouteCache("/eu-connect/api/summary-reports", userId);
    } catch (cacheError) {
      reportError("Summary report cache invalidation failed:", cacheError);
    }
    if (oldPath && oldPath !== newPath) await removeStoredFile(oldPath);
    return res.status(existing ? 200 : 201).json({ success: true, message: existing ? "Summary report updated." : "Summary report submitted." });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(() => {});
    if (newPath && !committed) await removeStoredFile(newPath);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A summary report already exists for this internship." });
    }
    reportError("Save summary report failed:", error);
    return res.status(500).json({ error: "Could not save the summary report." });
  } finally {
    connection?.release();
  }
}

export async function getSummaryAttachment(req, res) {
  try {
    const [rows] = await db.execute(
      `SELECT sr.attachment_path FROM summary_reports sr
       JOIN internship_records ir ON ir.id = sr.internship_id
       WHERE ir.id = ? AND ir.user_id = ? AND ir.deleted_at IS NULL AND sr.attachment_path IS NOT NULL
       LIMIT 1`,
      [req.params.internshipId, req.verifiedUser.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Attachment not found." });
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(rows[0].attachment_path, 120);
    if (error) throw error;
    res.set("Cache-Control", "private, no-store");
    return res.json({ url: data.signedUrl });
  } catch (error) {
    reportError("Get summary report attachment failed:", error);
    return res.status(500).json({ error: "Could not open the attachment." });
  }
}

export async function deleteSummaryReport(req, res) {
  const userId = req.verifiedUser.id;
  let connection;
  let committed = false;
  let attachmentPath = null;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT sr.id, sr.attachment_path FROM summary_reports sr
       JOIN internship_records ir ON ir.id = sr.internship_id
       WHERE sr.internship_id = ? AND sr.user_id = ? AND ir.user_id = ?
         AND ir.deleted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [req.params.internshipId, userId, userId],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Summary report not found." });
    }
    attachmentPath = rows[0].attachment_path;
    await connection.execute("DELETE FROM summary_reports WHERE id = ? AND user_id = ?", [rows[0].id, userId]);
    await connection.commit();
    committed = true;
    try {
      invalidateRouteCache("/eu-connect/api/summary-reports", userId);
    } catch (cacheError) {
      reportError("Summary report cache invalidation failed:", cacheError);
    }
    await removeStoredFile(attachmentPath);
    return res.json({ success: true, message: "Summary report deleted." });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(() => {});
    reportError("Delete summary report failed:", error);
    return res.status(500).json({ error: "Could not delete the summary report." });
  } finally {
    connection?.release();
  }
}
