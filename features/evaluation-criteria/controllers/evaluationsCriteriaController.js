import { reportError } from "../../../config/errorTracking.js";
import { invalidateCriteriaCache } from "../../../config/cache/criteriaCache.js";
import { db } from "../../../config/db.js";

// Internal table names select the evaluation direction; mounted management
// routes are admin-only. Categories are stored on criteria rows, not separately.
function createCriteriaEndpoints(tableName) {
  const isStudentCriteria = tableName === "student_evaluation_criteria";
  // Performance criteria omit a leading numeric category prefix; supervisor
  // criteria keep their category text after trimming.
  const cleanCategory = (value) => isStudentCriteria
    ? value.trim().replace(/^\d+\.\s*/, "").trim()
    : value.trim();
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
         ORDER BY ${isStudentCriteria ? "id ASC" : "category ASC, id ASC"}`,
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
      reportError(`Get ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to load criteria." });
    } finally {
      if (connection) connection.release();
    }
  };

  const addCriterion = async (req, res) => {
    let connection;
    try {
      const { category, criterion_name } = req.body;

      const categoryName = typeof category === "string" ? cleanCategory(category) : "";
      if (!categoryName || !criterion_name?.trim()) {
        return res
          .status(400)
          .json({ error: "category and criterion_name are required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `INSERT INTO ${tableName} (category, criterion_name, is_active) VALUES (?, ?, 1)`,
        [categoryName, criterion_name.trim()],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Failed to add criterion." });
      }

      await connection.commit();
      invalidateCriteriaCache(tableName);

      res.status(201).json({ success: true, id: result.insertId });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Add ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to add criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Deletion here means deactivation, preserving IDs referenced by saved scores.
  // Saved score reads retain access to inactive criteria.
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
      invalidateCriteriaCache(tableName);

      res
        .status(200)
        .json({ success: true, message: "Criterion deactivated." });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Deactivate ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to deactivate criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Reactivate one locked criterion. Whole-section reactivation is also available,
  // but it activates all inactive rows rather than restoring a prior snapshot.
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
      invalidateCriteriaCache(tableName);

      res
        .status(200)
        .json({ success: true, message: "Criterion reactivated." });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Reactivate ${tableName} error:`, error);
      res.status(500).json({ error: "Failed to reactivate criterion." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Deactivate all currently active rows in the category in one transaction.
  // This stores no record of which criteria were already inactive.
  const deactivateSection = async (req, res) => {
    let connection;
    try {
      const { category } = req.params;

      const categoryName = typeof category === "string" ? cleanCategory(category) : "";
      if (!categoryName) {
        return res.status(400).json({ error: "category is required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id FROM ${tableName} WHERE category = ? AND is_active = 1 FOR UPDATE`,
        [categoryName],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "No active criteria found under this section.",
        });
      }

      const [result] = await connection.execute(
        `UPDATE ${tableName} SET is_active = 0 WHERE category = ? AND is_active = 1`,
        [categoryName],
      );

      await connection.commit();
      invalidateCriteriaCache(tableName);

      res.status(200).json({
        success: true,
        message: `Section deactivated. ${result.affectedRows} criteria removed from the active form.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Deactivate ${tableName} section error:`, error);
      res.status(500).json({ error: "Failed to deactivate section." });
    } finally {
      if (connection) connection.release();
    }
  };

  // Reactivate every inactive row in the category, including those individually
  // deactivated before the last section change. This is not a snapshot undo.
  const reactivateSection = async (req, res) => {
    let connection;
    try {
      const { category } = req.params;

      const categoryName = typeof category === "string" ? cleanCategory(category) : "";
      if (!categoryName) {
        return res.status(400).json({ error: "category is required." });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        `SELECT id FROM ${tableName} WHERE category = ? AND is_active = 0 FOR UPDATE`,
        [categoryName],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "No inactive criteria found under this section.",
        });
      }

      const [result] = await connection.execute(
        `UPDATE ${tableName} SET is_active = 1 WHERE category = ? AND is_active = 0`,
        [categoryName],
      );

      await connection.commit();
      invalidateCriteriaCache(tableName);

      res.status(200).json({
        success: true,
        message: `Section reactivated. ${result.affectedRows} criteria restored to the active form.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError(`Reactivate ${tableName} section error:`, error);
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
