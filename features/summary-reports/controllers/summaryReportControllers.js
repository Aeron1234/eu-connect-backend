import { db } from "../../../config/db.js";
import { supabase } from "../../../config/supabase.js";
import { newUUID, verifyRecordAccess } from "../../../config/helpers.js";
import { invalidateRouteCache } from "../../../config/cache/cache.js";
import { reportError } from "../../../config/errorTracking.js";
import { withUploadConnection, uploadValidationError, cleanupUploadPaths } from "../../../config/uploadLifecycle.js";
import { assertInternshipStarted } from "../../../config/internshipStart.js";

const BUCKET = process.env.SUPABASE_BUCKET;
const FIELDS = ["organization_experience", "work_schedule", "memorable_moment", "difficulties_solutions"];
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 6;
const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

function hasImageSignature(file) {
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer)) return false;
  if (file.mimetype === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

async function withReportImages(reports, execute) {
  const ids = reports.map((report) => report.report_id).filter(Boolean);
  if (!ids.length) return reports.map((report) => ({ ...report, images: [] }));
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await execute(
    `SELECT id, report_id, storage_path, original_name, mime_type, sort_order
     FROM summary_report_images WHERE report_id IN (${placeholders})
     ORDER BY sort_order ASC, created_at ASC`,
    ids,
  );
  const signed = await Promise.all(rows.map(async (image) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(image.storage_path, 3600);
    if (error || !data?.signedUrl) throw error || new Error("Could not create an image link.");
    return {
      id: image.id,
      report_id: image.report_id,
      name: image.original_name,
      type: image.mime_type,
      sort_order: image.sort_order,
      url: data.signedUrl,
    };
  }));
  return reports.map((report) => ({
    ...report,
    images: signed.filter((image) => image.report_id === report.report_id),
  }));
}

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
              CONCAT_WS(' ', up.first_name,
                CASE WHEN NULLIF(TRIM(up.middle_initial), '') IS NOT NULL
                  THEN CONCAT(UPPER(LEFT(TRIM(up.middle_initial), 1)), '.') END,
                up.last_name) AS student_name
       FROM internship_records ir
       LEFT JOIN summary_reports sr ON sr.internship_id = ir.id
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       WHERE ir.user_id = ? AND ir.deleted_at IS NULL AND ir.status IN ('ongoing', 'finished')
       ORDER BY (ir.status = 'ongoing') DESC, ir.created_at DESC`,
      [req.verifiedUser.id],
    );
    return res.json({ records: await withReportImages(rows, (...args) => db.execute(...args)) });
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
              CONCAT_WS(' ', up.first_name,
                CASE WHEN NULLIF(TRIM(up.middle_initial), '') IS NOT NULL
                  THEN CONCAT(UPPER(LEFT(TRIM(up.middle_initial), 1)), '.') END,
                up.last_name) AS student_name,
              sr.organization_experience, sr.work_schedule, sr.memorable_moment,
              sr.difficulties_solutions, sr.memorabilia_note,
              sr.attachment_name, sr.attachment_type, sr.created_at, sr.updated_at
       FROM summary_reports sr
       INNER JOIN internship_records ir ON ir.id = sr.internship_id
       LEFT JOIN user_profiles up ON up.user_id = ir.user_id
       WHERE sr.internship_id = ? AND ir.deleted_at IS NULL LIMIT 1`,
      [internshipId],
    );
    const reports = await withReportImages(rows, (...args) => connection.execute(...args));
    return res.json({ report: reports[0] || null });
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
  const files = req.files || [];
  if (files.length > MAX_IMAGES || files.some((file) => !ALLOWED_MIME.has(file.mimetype) || !hasImageSignature(file))) {
    return res.status(400).json({ error: "Choose up to six JPG, PNG, or WebP images." });
  }
  if (files.some((file) => !file.size)) return res.status(400).json({ error: "An image is empty. Choose a different file." });
  let removeImageIds;
  try {
    removeImageIds = JSON.parse(req.body?.remove_image_ids || "[]");
    if (!Array.isArray(removeImageIds) || removeImageIds.some((id) => typeof id !== "string") || new Set(removeImageIds).size !== removeImageIds.length) {
      throw new Error("Invalid image selection.");
    }
  } catch {
    return res.status(400).json({ error: "Could not read the images selected for removal." });
  }

  const newPaths = [];
  const removedPaths = [];
  let committed = false;
  try {
    async function saveState(connection, lock = false) {
      const [internships] = await connection.execute(
        `SELECT id, DATE_FORMAT(date_started, '%Y-%m-%d') AS date_started FROM internship_records
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status IN ('ongoing', 'finished')
         LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [internshipId, userId],
      );
      if (!internships.length) {
        throw uploadValidationError(404, "Internship record not found.");
      }
      assertInternshipStarted(internships[0].date_started, "Summary reports");

      const [existingRows] = await connection.execute(
        `SELECT id, attachment_path FROM summary_reports WHERE internship_id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [internshipId],
      );
      const existing = existingRows[0];
      if (req.method === "POST" && existing) {
        throw uploadValidationError(409, "A summary report already exists for this internship. Edit it instead.");
      }
      if (req.method === "PATCH" && !existing) {
        throw uploadValidationError(404, "Summary report not found. Create it first.");
      }
      const [existingImages] = existing
        ? await connection.execute(`SELECT id, storage_path, sort_order FROM summary_report_images WHERE report_id = ? ${lock ? "FOR UPDATE" : ""}`, [existing.id])
        : [[]];
      const removedImages = existingImages.filter((image) => removeImageIds.includes(image.id));
      if (removedImages.length !== removeImageIds.length) {
        throw uploadValidationError(400, "An image selected for removal does not belong to this report.");
      }
      if (existingImages.length - removedImages.length + files.length > MAX_IMAGES) {
        throw uploadValidationError(400, "A summary report can have up to six images.");
      }
      return { existing, existingImages, removedImages };
    }

    // Text-only edits need just the final transaction. Image uploads get a
    // released preflight read, then recheck the latest state under row locks.
    const initial = files.length ? await withUploadConnection((connection) => saveState(connection)) : null;
    const uploadedImages = [];
    for (const file of files) {
      const imagePath = `summary-reports/${userId}/${internshipId}/${newUUID()}.${EXTENSIONS[file.mimetype]}`;
      newPaths.push(imagePath);
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(imagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedImages.push({ file, imagePath });
    }

    const saved = await withUploadConnection(async (connection) => {
      // After uploads, lock and recheck ownership, start date, report identity, removal
      // ownership and the combined retained/new image limit before writing metadata.
      const { existing, existingImages, removedImages } = await saveState(connection, true);
      if (initial?.existing && initial.existing.id !== existing?.id) {
        throw uploadValidationError(409, "This report changed during the upload. Refresh and try again.");
      }
      const removeLegacyAttachment = req.body?.remove_attachment === "true";
      if (removeLegacyAttachment && existing?.attachment_path) removedPaths.push(existing.attachment_path);

      const values = FIELDS.map((field) => content[field]);
      const reportId = existing?.id || newUUID();
      if (existing) {
        await connection.execute(
          `UPDATE summary_reports SET organization_experience = ?, work_schedule = ?,
            memorable_moment = ?, difficulties_solutions = ?, memorabilia_note = ?,
            attachment_path = CASE WHEN ? THEN NULL ELSE attachment_path END,
            attachment_name = CASE WHEN ? THEN NULL ELSE attachment_name END,
            attachment_type = CASE WHEN ? THEN NULL ELSE attachment_type END
           WHERE id = ? AND user_id = ?`,
          [...values, content.memorabilia_note || null,
            removeLegacyAttachment, removeLegacyAttachment, removeLegacyAttachment,
            reportId, userId],
        );
      } else {
        await connection.execute(
          `INSERT INTO summary_reports
            (id, internship_id, user_id, organization_experience, work_schedule,
             memorable_moment, difficulties_solutions, memorabilia_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [reportId, internshipId, userId, ...values, content.memorabilia_note || null],
        );
      }
      for (const image of removedImages) {
        await connection.execute("DELETE FROM summary_report_images WHERE id = ? AND report_id = ?", [image.id, reportId]);
        removedPaths.push(image.storage_path);
      }
      let sortOrder = Math.max(-1, ...existingImages.map((image) => image.sort_order || 0)) + 1;
      for (const { file, imagePath } of uploadedImages) {
        await connection.execute(
          `INSERT INTO summary_report_images (id, report_id, storage_path, original_name, mime_type, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newUUID(), reportId, imagePath, file.originalname.slice(0, 255), file.mimetype, sortOrder++],
        );
      }
      return { edited: Boolean(existing) };
    }, true);
    committed = true;
    try {
      invalidateRouteCache("/api/v1/summary-reports", userId);
    } catch (cacheError) {
      reportError("Summary report cache invalidation failed:", cacheError);
    }
    // Only after the final transaction commits and releases its connection may
    // old image/legacy-attachment objects be removed.
    await Promise.all(removedPaths.map(removeStoredFile));
    return res.status(saved.edited ? 200 : 201).json({ success: true, message: saved.edited ? "Summary report updated." : "Summary report submitted." });
  } catch (error) {
    // Clean newly staged paths on definite save failure; retain them if commit
    // acknowledgement is uncertain to avoid breaking a potentially saved report.
    if (!committed && !error.uploadCommitUncertain) await cleanupUploadPaths(newPaths);
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A summary report already exists for this internship." });
    }
    reportError("Save summary report failed:", error, error.uploadCommitUncertain ? { retainedStoragePaths: newPaths } : undefined);
    return res.status(500).json({ error: "Could not save the summary report." });
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
  let attachmentPaths = [];
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
    const [images] = await connection.execute(
      "SELECT storage_path FROM summary_report_images WHERE report_id = ?",
      [rows[0].id],
    );
    attachmentPaths = [rows[0].attachment_path, ...images.map((image) => image.storage_path)].filter(Boolean);
    await connection.execute("DELETE FROM summary_reports WHERE id = ? AND user_id = ?", [rows[0].id, userId]);
    await connection.commit();
    committed = true;
    try {
      invalidateRouteCache("/api/v1/summary-reports", userId);
    } catch (cacheError) {
      reportError("Summary report cache invalidation failed:", cacheError);
    }
    await Promise.all(attachmentPaths.map(removeStoredFile));
    return res.json({ success: true, message: "Summary report deleted." });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(() => {});
    reportError("Delete summary report failed:", error);
    return res.status(500).json({ error: "Could not delete the summary report." });
  } finally {
    connection?.release();
  }
}
