import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";

///////////////////
// DAILY TIME RECORDS
///////////////////
export const deleteDTR = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id } = req.verifiedUser;
    const dtrId = req.params.dtrId;

    if (!dtrId) {
      return res.status(400).json({ error: "DTR ID is required" });
    }

    await connection.beginTransaction();

    // 1. Subtract hours from the internship record first
    // COALESCE ensures we subtract 0 if they haven't clocked out yet
    await connection.execute(
      `
      UPDATE internship_records ir
      INNER JOIN daily_time_records dtr ON ir.id = dtr.internship_id
      SET ir.accumulated_hours = ir.accumulated_hours - COALESCE(dtr.total_hours, 0)
      WHERE dtr.id = ? AND dtr.user_id = ?
      `,
      [dtrId, id],
    );

    // 2. Delete the record
    const [result] = await connection.execute(
      `DELETE FROM daily_time_records WHERE id = ? AND user_id = ?`,
      [dtrId, id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "DTR record not found or you do not have permission to delete it.",
      });
    }

    await connection.commit();
    res.status(200).json({
      message: "Record deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

///////////////////
// DAILY NARRATIVES
///////////////////
export const deleteDailyNarrative = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { id } = req.verifiedUser;
    const narrativeId = req.params.narrativeId;

    if (!narrativeId) {
      return res.status(400).json({ error: "Narrative ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `DELETE FROM daily_narratives WHERE id = ? AND user_id = ?`,
      [narrativeId, id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error:
          "Narrative record not found or you do not have permission to delete it.",
      });
    }

    await connection.commit();
    res.status(200).json({
      message: "Record deleted successfully.",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

///////////////////
// FILE
///////////////////
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
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  } finally {
    if (connection) connection.release();
  }
};

///////////////////
// ANNOUNCEMENT
///////////////////
export const deleteAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { announcementId } = req.params;
    const { id: userId, role } = req.verifiedUser;

    // Security: Only the author or an Admin can delete
    // You might want to check ownership first if not a Super Admin
    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    await connection.beginTransaction();
    const [result] = await db.execute(
      `DELETE FROM announcements WHERE id = ? AND (author_id = ? OR ? = 'admin')`,
      [announcementId, userId, role],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "Announcement not found or unauthorized." });
    }
    await connection.commit();

    // io.emit("announcement-deleted", id);

    res.status(200).json({ message: "Deleted successfully", success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log(error);
    res.status(500).json({ error: "Delete failed" });
  } finally {
    if (connection) connection.release();
  }
};
