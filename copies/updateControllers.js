import { db } from "../config/db.js";

///////////////////
// INTERNSHIP RECORDS
///////////////////
export const finishInternshipRecord = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const internshipId = req.params.internshipId;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    // 1. Run the update ONLY if they have enough hours
    const [result] = await db.execute(
      `
      UPDATE internship_records
      SET 
        date_ended = CURRENT_DATE(),
        status = 'finished'
      WHERE user_id = ? 
        AND id = ? 
        AND accumulated_hours >= total_hours
        AND status = 'ongoing'
      `,
      [userId, internshipId],
    );

    // 2. If 0 rows were affected, we need to know WHY
    if (result.affectedRows === 0) {
      // Check if the record exists but they just don't have enough hours
      const [record] = await db.execute(
        `SELECT accumulated_hours, total_hours FROM internship_records WHERE id = ?`,
        [internshipId],
      );

      if (record.length > 0) {
        const { accumulated_hours, total_hours } = record[0];
        if (accumulated_hours < total_hours) {
          const remaining = (total_hours - accumulated_hours).toFixed(2);
          return res.status(400).json({
            error: `You cannot finish yet. You still need ${remaining} more hours!`,
          });
        }
      }

      return res.status(404).json({
        error: "Internship record not found or already finished.",
      });
    }

    res.status(200).json({
      message: "Congrats on finishing your current internship!",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// DAILY TIME RECORDS
///////////////////
export const clockOut = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const internshipId = req.query.internshipId;
    const { location_out } = req.body;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    if (!location_out) {
      return res.status(400).json({ error: "Can't get your location." });
    }

    const [result] = await db.execute(
      `
      UPDATE daily_time_records AS dtr
      INNER JOIN internship_records AS ir ON dtr.internship_id = ir.id
      SET 
        dtr.clock_out = CURRENT_TIME(),
        dtr.total_hours = TIMESTAMPDIFF(MINUTE, dtr.clock_in, CURRENT_TIME()) / 60,
        dtr.location_out = ?,
        ir.accumulated_hours = ir.accumulated_hours + (TIMESTAMPDIFF(MINUTE, dtr.clock_in, CURRENT_TIME()) / 60)
      WHERE dtr.user_id = ? 
        AND DATE(dtr.created_at) = CURDATE() 
        AND dtr.clock_out IS NULL
        AND dtr.internship_id = ?
      `,
      [location_out, userId, internshipId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Failed to clock-out or no active clock-in found for today.",
      });
    }

    res.status(200).json({
      message: "Clocked-out successfully!",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// DAILY NARRATIVES
///////////////////
export const editNarrative = async (req, res) => {
  try {
    const { id: userId } = req.verifiedUser;
    const { narrativeId } = req.params;
    const { internshipId } = req.query;

    const { day_number, title, narrative } = req.body;

    if (!internshipId) {
      return res.status(400).json({ error: "Internship ID is required" });
    }

    if (!narrativeId) {
      return res.status(400).json({ error: "Narrative ID is required." });
    }

    if (!day_number || !title?.trim() || !narrative?.trim()) {
      return res.status(400).json({
        error: "All fields (Day, Title, and Narrative) are required.",
      });
    }

    const [result] = await db.execute(
      `
      UPDATE daily_narratives
      SET
        day_number = COALESCE(?, day_number),
        title = COALESCE(?, title),
        narrative = COALESCE(?, narrative),
        updated_at = NOW()
      WHERE id = ? AND user_id = ? AND internship_id = ?
      `,
      [
        day_number || null,
        title.trim() || null,
        narrative.trim() || null,
        narrativeId,
        userId,
        internshipId,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Failed to update narrative or can't find the narrative.",
      });
    }

    res.status(200).json({
      message: "Narrative updated successfully!",
      success: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Database query failed", success: false });
  }
};

///////////////////
// ACCOUNTS
///////////////////
export const deactivateAccount = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "Failed to deactivate account or can't find the account.",
      });
    }

    await connection.commit();

    res.status(200).json({
      message: "Account deactivated successfully!",
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

export const reactivateAccount = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'active', deleted_at = null WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: "Failed to reactivate account or can't find the account.",
      });
    }

    await connection.commit();

    res.status(200).json({
      message: "Account reactivated successfully!", // 👈 Fixed message
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
export const updateAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { announcementId } = req.params;
    const { id: userId, role } = req.verifiedUser;

    // Destructure the possible updates from the body
    const { category_id, title, content } = req.body;

    if (!announcementId) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE announcements 
       SET 
         category_id = COALESCE(?, category_id), 
         title = COALESCE(?, title), 
         content = COALESCE(?, content), 
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (author_id = ? OR ? = 'admin')`,
      [
        category_id ?? null,
        title ?? null,
        content ?? null,
        announcementId,
        userId,
        role,
      ],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(403).json({
        error: "Announcement not found or unauthorized to edit.",
      });
    }

    // Fetch fresh data so the UI and Sockets get the labels/colors
    const [updatedData] = await connection.execute(
      `SELECT a.*, ac.name AS category, ac.color AS category_bg, ac.text_color AS category_fg, 
              up.first_name, up.last_name, r.role
       FROM announcements a
       JOIN announcement_categories ac ON a.category_id = ac.id
       JOIN user_profiles up ON a.author_id = up.user_id
       JOIN users u ON a.author_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE a.id = ?`,
      [announcementId],
    );

    await connection.commit();

    res.status(200).json({
      message: "Announcement updated successfully!",
      success: true,
      data: updatedData[0],
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update Error:", error);
    res.status(500).json({ error: "Update failed" });
  } finally {
    if (connection) connection.release();
  }
};

export const togglePinAnnouncement = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { announcementId } = req.params;
    const { is_pinned } = req.body; // Expecting true or false
    const { role } = req.verifiedUser;

    // Typically, only Admins or Dept Heads should be able to pin/unpin
    if (role !== "admin" && role !== "department head") {
      return res
        .status(403)
        .json({ error: "Only authorized staff can pin announcements." });
    }

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE announcements 
       SET is_pinned = ? 
       WHERE id = ?`,
      [is_pinned, announcementId],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Announcement not found." });
    }

    await connection.commit();

    // io.emit("announcement-pinned-toggled", { id: announcementId, is_pinned });

    res.status(200).json({
      message: is_pinned ? "Announcement pinned!" : "Announcement unpinned!",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Toggle Pin Error:", error);
    res.status(500).json({ error: "Failed to update pinned status." });
  } finally {
    if (connection) connection.release();
  }
};
