import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../../../middleware/rateLimiter.js";
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
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(300),
  getEmployerEvaluationCriteria,
);

criteriaRoutes.post(
  "/criteria/employer-evaluation",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  addEmployerEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/employer-evaluation/:criterionId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateEmployerEvaluationCriterion,
);

criteriaRoutes.patch(
  "/criteria/employer-evaluation/:criterionId/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateEmployerEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/employer-evaluation/section/:category",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateEmployerEvaluationSection,
);

criteriaRoutes.patch(
  "/criteria/employer-evaluation/section/:category/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateEmployerEvaluationSection,
);

// Employer-evaluating-student criteria
criteriaRoutes.get(
  "/criteria/student-evaluation",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(300),
  getStudentEvaluationCriteria,
);

criteriaRoutes.post(
  "/criteria/student-evaluation",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  addStudentEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/student-evaluation/:criterionId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateStudentEvaluationCriterion,
);

criteriaRoutes.patch(
  "/criteria/student-evaluation/:criterionId/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateStudentEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/student-evaluation/section/:category",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateStudentEvaluationSection,
);

criteriaRoutes.patch(
  "/criteria/student-evaluation/section/:category/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateStudentEvaluationSection,
);

export default criteriaRoutes;
