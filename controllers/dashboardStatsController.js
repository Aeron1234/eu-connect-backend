import { db } from "../config/db.js";

export const getStudentDashboardStats = async (req, res) => {
  let connection;
  try {
    // 1. Acquire a dedicated connection from the pool
    connection = await db.getConnection();
    const { id: userId } = req.verifiedUser;

    // 2. Execute all count queries concurrently using the same connection instance
    const [[announcementResult], [evaluationResult], [documentResult]] =
      await Promise.all([
        // Unread Announcements Count
        connection.execute(
          `SELECT COUNT(*) AS count 
         FROM notifications 
         WHERE user_id = ? AND type = 'announcement' AND is_read = 0`,
          [userId],
        ),

        // Pending Evaluations Count
        connection.execute(
          `SELECT COUNT(*) AS count 
         FROM student_evaluation_masters AS sem
         INNER JOIN internship_records AS ir ON sem.internship_record_id = ir.id
         WHERE ir.user_id = ? AND sem.status = 'pending'`,
          [userId],
        ),

        // Total Stored Documents Count
        connection.execute(
          `SELECT COUNT(*) AS count 
         FROM internship_documents 
         WHERE user_id = ?`,
          [userId],
        ),
      ]);

    // 3. Send back the aggregated metrics
    res.status(200).json({
      success: true,
      stats: {
        appliedInternships: 0, // Placeholder for later implementation
        unreadAnnouncements: announcementResult[0].count || 0,
        pendingEvaluations: evaluationResult[0].count || 0,
        documentsStored: documentResult[0].count || 0,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve student dashboard statistics:", error);
    res.status(500).json({
      error: "Database metrics aggregation failed",
      success: false,
    });
  } finally {
    // 4. Always release the connection back to the pool, even if a query throws an error
    if (connection) connection.release();
  }
};
