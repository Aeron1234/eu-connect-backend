import { cacheRoute } from "../middleware/cache-middleware.js";
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
  createEmployerEvaluation,
  getEvaluationCriterias,
  getPendingStudentEvaluations,
  getStudentSubmittedEvaluations,
} from "../controllers/employerEvaluationsController.js";

const employerEvaluationsRoutes = express.Router();

employerEvaluationsRoutes.get(
  "/evaluation-criterias",
  verifyUser,
  generalLimiter,
  cacheRoute(300),
  getEvaluationCriterias,
);

employerEvaluationsRoutes.post(
  "/evaluations/employer",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  createEmployerEvaluation,
);

employerEvaluationsRoutes.get(
  "/evaluations/submitted",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  cacheRoute(30),
  getStudentSubmittedEvaluations,
);

employerEvaluationsRoutes.get(
  "/evaluations/pending",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getPendingStudentEvaluations,
);

export default employerEvaluationsRoutes;
