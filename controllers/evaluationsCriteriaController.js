import { db } from "../config/db.js";

function createCriteriaEndpoints(tableName) {
  const getCriteria = async (req, res) => {
    let connection;
    try {
      const { includeInactive } = req.query;

      connection = await db.getConnection();

      const whereClause =
        includeInactive === "true" ? "" : "WHERE is_active = 1";

      const [rows] = await connection.execute(
        `SELECT id, category, criterion_name, is_active
         FROM ${tableName}
         ${whereClause}
         ORDER BY category ASC, id ASC`,
      );

      // Group flat rows into [{ category, items: [{ id, name, is_active }] }]
      const groups = new Map();

      for (const row of rows) {
        if (!groups.has(row.category)) {
          groups.set(row.category, { category: row.category, items: [] });
        }
        groups.get(row.category).items.push({
          id: row.id,
          name: row.criterion_name,
          is_active: !!row.is_active,
        });
      }

      res.status(200).json([...groups.values()]);
    } catch (error) {
      console.error(`Get ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to load criteria." });
    } finally {
      if (connection) connection.release();
    }
  };

  const addCriterion = async (req, res) => {
    let connection;
    try {
      const { category, criterion_name } = req.body;

      if (!category?.trim() || !criterion_name?.trim()) {
        return res
          .status(400)
          .json({ error: "category and criterion_name are required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `INSERT INTO ${tableName} (category, criterion_name, is_active) VALUES (?, ?, 1)`,
        [category.trim(), criterion_name.trim()],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Failed to add criterion." });
      }

      await connection.commit();

      res.status(201).json({ success: true, id: result.insertId });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Add ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to add criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  // "Delete" is really deactivate — historical evaluations already
  // reference this criterion_id, so the row must never actually be removed
  const deactivateCriterion = async (req, res) => {
    let connection;
    try {
      const { criterionId } = req.params;

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id, is_active FROM ${tableName} WHERE id = ? FOR UPDATE`,
        [criterionId],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Criterion not found." });
      }

      if (rows[0].is_active === 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "Criterion is already inactive." });
      }

      const [result] = await connection.execute(
        `UPDATE ${tableName} SET is_active = 0 WHERE id = ?`,
        [criterionId],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Criterion not found." });
      }

      await connection.commit();

      res
        .status(200)
        .json({ success: true, message: "Criterion deactivated." });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Deactivate ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to deactivate criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Reverses deactivateCriterion — admin only, per-criterion (a section
  // deactivate doesn't record which rows were already inactive beforehand,
  // so there's no safe "undo the whole section" operation)
  const reactivateCriterion = async (req, res) => {
    let connection;
    try {
      const { criterionId } = req.params;

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id, is_active FROM ${tableName} WHERE id = ? FOR UPDATE`,
        [criterionId],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Criterion not found." });
      }

      if (rows[0].is_active === 1) {
        await connection.rollback();
        return res.status(400).json({ error: "Criterion is already active." });
      }

      await connection.execute(
        `UPDATE ${tableName} SET is_active = 1 WHERE id = ?`,
        [criterionId],
      );

      await connection.commit();

      res
        .status(200)
        .json({ success: true, message: "Criterion reactivated." });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Reactivate ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to reactivate criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  const deactivateSection = async (req, res) => {
    let connection;
    try {
      const { category } = req.params;

      if (!category?.trim()) {
        return res.status(400).json({ error: "category is required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id FROM ${tableName} WHERE category = ? AND is_active = 1 FOR UPDATE`,
        [category],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "No active criteria found under this section.",
        });
      }

      const [result] = await connection.execute(
        `UPDATE ${tableName} SET is_active = 0 WHERE category = ? AND is_active = 1`,
        [category],
      );

      await connection.commit();

      res.status(200).json({
        success: true,
        message: `Section deactivated. ${result.affectedRows} criteria removed from the active form.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Deactivate ${tableName} section error:`, error);
      res.status(500).json({ error: "Failed to deactivate section." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Reverses deactivateSection — reactivates every currently-inactive
  // criterion under this category. Note: this isn't scoped to "whatever the
  // last deactivateSection call touched" — it's every inactive row in the
  // category, including any deactivated individually beforehand.
  const reactivateSection = async (req, res) => {
    let connection;
    try {
      const { category } = req.params;

      if (!category?.trim()) {
        return res.status(400).json({ error: "category is required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id FROM ${tableName} WHERE category = ? AND is_active = 0 FOR UPDATE`,
        [category],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "No inactive criteria found under this section.",
        });
      }

      const [result] = await connection.execute(
        `UPDATE ${tableName} SET is_active = 1 WHERE category = ? AND is_active = 0`,
        [category],
      );

      await connection.commit();

      res.status(200).json({
        success: true,
        message: `Section reactivated. ${result.affectedRows} criteria restored to the active form.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`Reactivate ${tableName} section error:`, error);
      res.status(500).json({ error: "Failed to reactivate section." });
    } finally {
      if (connection) connection.release();
    }
  };

  return {
    getCriteria,
    addCriterion,
    deactivateCriterion,
    reactivateCriterion,
    deactivateSection,
    reactivateSection,
  };
}

export const {
  getCriteria: getEmployerEvaluationCriteria,
  addCriterion: addEmployerEvaluationCriterion,
  deactivateCriterion: deactivateEmployerEvaluationCriterion,
  reactivateCriterion: reactivateEmployerEvaluationCriterion,
  deactivateSection: deactivateEmployerEvaluationSection,
  reactivateSection: reactivateEmployerEvaluationSection,
} = createCriteriaEndpoints("employer_evaluation_criteria");

export const {
  getCriteria: getStudentEvaluationCriteria,
  addCriterion: addStudentEvaluationCriterion,
  deactivateCriterion: deactivateStudentEvaluationCriterion,
  reactivateCriterion: reactivateStudentEvaluationCriterion,
  deactivateSection: deactivateStudentEvaluationSection,
  reactivateSection: reactivateStudentEvaluationSection,
} = createCriteriaEndpoints("student_evaluation_criteria");
