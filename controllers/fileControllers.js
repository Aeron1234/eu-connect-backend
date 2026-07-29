import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";

export const getInternshipFiles = async (req, res) => {
  try {
    const { id } = req.verifiedUser;

    const [rows] = await db.execute(
      `SELECT * FROM internship_documents
       WHERE user_id = ?
       `,
      [id],
    );

    const records = rows.length > 0 ? rows : null;

    res.status(200).json(records);
  } catch (error) {
    console.error("Get internship files error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

export const uploadInternshipFile = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;

    // 1. Text fields come from req.body
    const { file_name, company_name, category } = req.body;
    const catLower = category?.toLowerCase();

    // 2. The file comes from req.file (thanks to Multer)
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // 3. Validation using Multer's property names
    const ALLOWED_TYPES = [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ];

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "File is too large (Max 10MB)." });
    }

    if (catLower !== "before" && catLower !== "after") {
      return res.status(400).json({
        error: 'Category must be "Before" or "After".',
      });
    }

    // 4. Prepare Supabase Upload
    const fileExt = file.originalname.split(".").pop();
    const uploadFilePath = `requirements/${userId}/${Date.now()}.${fileExt}`;

    // IMPORTANT: In Express, the file is a Buffer. Use file.buffer
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("eu-connect_storage")
      .upload(uploadFilePath, file.buffer, {
        contentType: file.mimetype, // Crucial so the browser knows how to open it
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("eu-connect_storage")
      .getPublicUrl(uploadFilePath);

    // 5. Save to Database
    const [result] = await db.execute(
      `INSERT INTO internship_documents (user_id, file_name, company_name, category, file_type, url, path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        file_name,
        company_name,
        catLower,
        file.mimetype,
        publicUrl,
        uploadFilePath,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        error: "Uploading file failed.",
      });
    }

    res.status(201).json({
      message: "Document uploaded successfully!",
      success: true,
    });
  } catch (error) {
    console.error("Upload Error:", error.message);
    res.status(500).json({ error: "Server failed to process upload." });
  }
};

export const deleteFile = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id } = req.verifiedUser;
    const { fileId } = req.params;
    const { filePath } = req.query;

    if (!fileId || !filePath) {
      return res.status(400).json({ error: "File ID and path are required." });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `DELETE FROM internship_documents WHERE id = ? AND user_id = ?`,
      [fileId, id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "File not found or you do not have permission to delete it.",
      });
    }

    const { error: storageError } = await supabase.storage
      .from("eu-connect_storage")
      .remove([filePath]);

    if (storageError) {
      await connection.rollback();
      return res
        .status(500)
        .json({ error: `Storage Error: ${storageError.message}` });
    }

    await connection.commit();
    res.status(200).json({
      message: "File deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Delete file error: ", error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};
