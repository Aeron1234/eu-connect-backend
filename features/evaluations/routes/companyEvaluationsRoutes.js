import { evaluationEligibilityHandler } from "../evaluationLifecycle.js";
import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import { getCompanySummary } from "../controllers/companySummaryController.js";

import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../../../middleware/rateLimiter.js";
import {
  createCompanyEvaluation,
  deleteCompanyEvaluation,
  getEvaluationCriterias,
  getPendingStudentEvaluations,
  getStudentSubmittedEvaluations,
} from "../controllers/companyEvaluationsController.js";

const companyEvaluationsRoutes = express.Router();

companyEvaluationsRoutes.get('/evaluations/company/summary', verifyUser, verifyRole(['department_head']), generalLimiter, getCompanySummary);
companyEvaluationsRoutes.get('/evaluations/company/summary/:companyKey', verifyUser, verifyRole(['department_head']), generalLimiter, getCompanySummary);

companyEvaluationsRoutes.get(
  "/company-evaluation/criteria",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getEvaluationCriterias,
);

companyEvaluationsRoutes.post(
  "/evaluations/company",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  createCompanyEvaluation,
);

companyEvaluationsRoutes.get(
  "/evaluations/submitted",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  cacheRoute(30),
  getStudentSubmittedEvaluations,
);

companyEvaluationsRoutes.get(
  "/evaluations/pending",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getPendingStudentEvaluations,
);

companyEvaluationsRoutes.delete('/evaluations/company/:evaluationId', verifyUser, verifyRole(['student', 'department_head', 'admin']), mediumLimiter, deleteCompanyEvaluation);
companyEvaluationsRoutes.get('/evaluations/company/eligibility', verifyUser, verifyRole(['student']), generalLimiter, evaluationEligibilityHandler('company'));

export default companyEvaluationsRoutes;
