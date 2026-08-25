import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import {
  addEmployerEvaluationCriterion,
  addStudentEvaluationCriterion,
  deactivateEmployerEvaluationCriterion,
  deactivateEmployerEvaluationSection,
  deactivateStudentEvaluationCriterion,
  deactivateStudentEvaluationSection,
  reactivateEmployerEvaluationCriterion,
  reactivateStudentEvaluationCriterion,
  reactivateEmployerEvaluationSection,
  reactivateStudentEvaluationSection,
  getEmployerEvaluationCriteria,
  getStudentEvaluationCriteria,
} from "../controllers/evaluationsCriteriaController.js";

const criteriaRoutes = express.Router();

// Student-evaluating-employer criteria
criteriaRoutes.get(
  "/criteria/employer-evaluation",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getEmployerEvaluationCriteria,
);

criteriaRoutes.post(
  "/criteria/employer-evaluation",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  addEmployerEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/employer-evaluation/:criterionId",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateEmployerEvaluationCriterion,
);

criteriaRoutes.patch(
  "/criteria/employer-evaluation/:criterionId/reactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  reactivateEmployerEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/employer-evaluation/section/:category",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateEmployerEvaluationSection,
);

criteriaRoutes.patch(
  "/criteria/employer-evaluation/section/:category/reactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  reactivateEmployerEvaluationSection,
);

// Employer-evaluating-student criteria
criteriaRoutes.get(
  "/criteria/student-evaluation",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getStudentEvaluationCriteria,
);

criteriaRoutes.post(
  "/criteria/student-evaluation",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  addStudentEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/student-evaluation/:criterionId",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateStudentEvaluationCriterion,
);

criteriaRoutes.patch(
  "/criteria/student-evaluation/:criterionId/reactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  reactivateStudentEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/student-evaluation/section/:category",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateStudentEvaluationSection,
);

criteriaRoutes.patch(
  "/criteria/student-evaluation/section/:category/reactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  reactivateStudentEvaluationSection,
);

export default criteriaRoutes;
