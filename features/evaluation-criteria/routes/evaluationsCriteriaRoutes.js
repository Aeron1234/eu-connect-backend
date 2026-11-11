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
  addCompanyEvaluationCriterion,
  addStudentEvaluationCriterion,
  deactivateCompanyEvaluationCriterion,
  deactivateCompanyEvaluationSection,
  deactivateStudentEvaluationCriterion,
  deactivateStudentEvaluationSection,
  reactivateCompanyEvaluationCriterion,
  reactivateStudentEvaluationCriterion,
  reactivateCompanyEvaluationSection,
  reactivateStudentEvaluationSection,
  getCompanyEvaluationCriteria,
  getStudentEvaluationCriteria,
} from "../controllers/evaluationsCriteriaController.js";

const criteriaRoutes = express.Router();

// Student-evaluating-company criteria
criteriaRoutes.get(
  "/criteria/company-evaluation",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(300),
  getCompanyEvaluationCriteria,
);

criteriaRoutes.post(
  "/criteria/company-evaluation",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  addCompanyEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/company-evaluation/:criterionId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateCompanyEvaluationCriterion,
);

criteriaRoutes.patch(
  "/criteria/company-evaluation/:criterionId/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateCompanyEvaluationCriterion,
);

criteriaRoutes.delete(
  "/criteria/company-evaluation/section/:category",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  deactivateCompanyEvaluationSection,
);

criteriaRoutes.patch(
  "/criteria/company-evaluation/section/:category/reactivate",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  reactivateCompanyEvaluationSection,
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
