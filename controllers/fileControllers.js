import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { newUUID, ALLOWED_TYPES } from "../config/helpers.js";

const BUCKET = process.env.SUPABASE_BUCKET;

export const getFileRequirementTypes = async (req, res) => {
  try {
    const { category } = req.query;

    const conditions = [];
    const params = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [rows] = await db.execute(
      `SELECT id, category, name, requires_notarization, copies_needed, sort_order
       FROM requirement_types
       ${whereClause}
       ORDER BY category, sort_order ASC`,
      params,
    );

    res.status(200).json(rows); // always an array, even when empty
  } catch (error) {
    console.error("Get requirement types error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const getInternshipFiles = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { internshipId, category } = req.query;

    const conditions = ["doc.user_id = ?"];
    const params = [userId];

    if (internshipId) {
      conditions.push("doc.internship_id = ?");
      params.push(internshipId);
    }

    if (category) {
      conditions.push("doc.category = ?");
      params.push(category);
    }

    const [rows] = await db.execute(
      `SELECT 
         doc.id, doc.internship_id, doc.file_name, doc.company_name, 
         doc.category, doc.requirement_type_id, doc.file_type, doc.created_at,
         rt.name AS requirement_name, rt.requires_notarization, rt.copies_needed
       FROM internship_documents doc
       LEFT JOIN requirement_types rt ON doc.requirement_type_id = rt.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY doc.created_at DESC`,
      params,
    );

    res.status(200).json(rows); // always an array, even when empty
  } catch (error) {
    console.error("Get internship files error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const uploadInternshipFile = async (req, res) => {
  let connection;
  let uploadedStoragePath;
  try {
    const { id: userId, role } = req.verifiedUser;
    const { file_name, company_name, requirement_type_id } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    if (!requirement_type_id) {
      return res
        .status(400)
        .json({ error: "requirement_type_id is required." });
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "File is too large (Max 10MB)." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Gate: user must have an ONGOING internship
    const [internships] = await connection.execute(
      `SELECT id FROM internship_records WHERE user_id = ? AND status = 'ongoing' LIMIT 1 FOR UPDATE`,
      [userId],
    );

    if (internships.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        error:
          "You don't have an ongoing internship. Requirement uploads are only allowed during an active internship.",
      });
    }

    const internshipId = internships[0].id;

    // 2. Validate requirement_type_id and derive category from it
    // (never trust a client-sent "category" that might not match the requirement)
    const [reqTypes] = await connection.execute(
      `SELECT id, category FROM requirement_types WHERE id = ?`,
      [requirement_type_id],
    );

    if (reqTypes.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: "Invalid requirement type." });
    }

    const { category: catLower } = reqTypes[0];

    // 3. Upload to Supabase Storage (private bucket — no public URL)
    const fileExt = file.originalname.split(".").pop();
    uploadedStoragePath = `requirements/${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedStoragePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) throw uploadError;

    // 4. Save to Database — no public url stored; downloads go through
    // a signed URL generated on-demand in downloadInternshipFile
    const [result] = await connection.execute(
      `INSERT INTO internship_documents 
        (user_id, internship_id, file_name, company_name, category, requirement_type_id, file_type, path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        internshipId,
        file_name,
        company_name,
        catLower,
        requirement_type_id,
        file.mimetype,
        uploadedStoragePath,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      await supabase.storage.from(BUCKET).remove([uploadedStoragePath]);
      return res.status(400).json({ error: "Uploading file failed." });
    }

    // Activity log is supplementary — a failure here must never roll back
    // or fail the actual upload, so it's isolated in its own try/catch.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "internship_document_uploaded",
          "internship_documents",
          String(result.insertId),
          `Uploaded ${file_name} (${catLower}) for internship at ${company_name}.`,
          JSON.stringify({
            internship_id: internshipId,
            file_name,
            company_name,
            category: catLower,
            requirement_type_id,
            file_type: file.mimetype,
          }),
        ],
      );
    } catch (logError) {
      console.error("Activity log insert failed (document upload):", logError);
    }

    await connection.commit();

    res.status(201).json({
      message: "Document uploaded successfully!",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (uploadedStoragePath) {
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedStoragePath])
        .catch(() => {});
    }
    console.error("Upload Error:", error.message);
    res.status(500).json({ error: "Server failed to process upload." });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteFile = async (req, res) => {
  let connection;
  try {
    const { id: userId, role } = req.verifiedUser;
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({ error: "File ID is required." });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Look up the record first — never trust a client-supplied path
    const [rows] = await connection.execute(
      `SELECT id, user_id, path FROM internship_documents WHERE id = ? FOR UPDATE`,
      [fileId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "File not found." });
    }

    const doc = rows[0];
    const isOwner = doc.user_id === userId;
    const isAdmin = role === "admin";

    if (!isOwner && !isAdmin) {
      await connection.rollback();
      return res.status(403).json({
        error: "You do not have permission to delete this file.",
      });
    }

    const [result] = await connection.execute(
      `DELETE FROM internship_documents WHERE id = ?`,
      [fileId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "File not found." });
    }

    // Same isolation as upload — logging failure shouldn't affect the
    // already-decided deletion.
    try {
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          role,
          "internship_document_deleted",
          "internship_documents",
          String(fileId),
          `${isAdmin && !isOwner ? "Admin" : "Owner"} deleted document ${fileId}.`,
          JSON.stringify({
            document_owner_id: doc.user_id,
            path: doc.path,
          }),
        ],
      );
    } catch (logError) {
      console.error("Activity log insert failed (document delete):", logError);
    }

    await connection.commit();

    // Delete from storage AFTER commit succeeds — DB is source of truth,
    // an orphaned storage object is recoverable, an orphaned DB row isn't
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([doc.path]);

    if (storageError) {
      console.error("Failed to delete from storage:", storageError.message);
    }

    res.status(200).json({
      message: "File deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete file error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

export const downloadInternshipFile = async (req, res) => {
  try {
    const { id: userId, role } = req.verifiedUser;
    const { fileId } = req.params;

    const [rows] = await db.execute(
      `SELECT user_id, path, file_name, file_type FROM internship_documents WHERE id = ?`,
      [fileId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "File not found." });
    }

    const doc = rows[0];

    const isOwner = doc.user_id === userId;
    const isStaff = role === "admin" || role === "department_head";

    if (!isOwner && !isStaff) {
      return res
        .status(403)
        .json({ error: "You don't have access to this file." });
    }

    // Bumped from 60s to 120s to give some buffer for the
    // Server Action round trip before the client actually uses the URL
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.path, 120);

    if (error) {
      console.error("Signed URL error:", error.message);
      return res.status(404).json({ error: "File not found on server." });
    }

    return res.status(200).json({
      url: data.signedUrl,
      fileName: doc.file_name,
    });
  } catch (error) {
    console.error("Download Error:", error.message);
    res.status(500).json({ error: "Failed to retrieve file." });
  }
};
