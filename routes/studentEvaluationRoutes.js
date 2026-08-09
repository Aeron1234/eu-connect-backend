import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import {
  createStudentEvaluation,
  deleteStudentEvaluation,
  getAllStudentEvaluations,
  getDisputedStudentEvaluations,
  getPastStudentEvaluations,
  getStudentCompleteEvaluations,
  getStudentEvaluationCriteria,
  respondToStudentEvaluation,
  restoreDisputedEvaluation,
  reviewDisputedEvaluation,
} from "../controllers/studentEvaluationControllers.js";

const studentEvaluationRoutes = express.Router();

studentEvaluationRoutes.get(
  "/student-evaluation/criteria",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  getStudentEvaluationCriteria,
);

studentEvaluationRoutes.get(
  "/student-evaluations/:studentId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getStudentCompleteEvaluations,
);

studentEvaluationRoutes.get(
  "/student-past-evaluations/:studentId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getPastStudentEvaluations,
);

studentEvaluationRoutes.post(
  "/student-evaluation/new",
  verifyUser,
  verifyRole(["employer"]),
  strictLimiter,
  createStudentEvaluation,
);

studentEvaluationRoutes.delete(
  "/student-evaluation/:evaluationId",
  verifyUser,
  verifyRole(["employer", "admin"]),
  mediumLimiter,
  deleteStudentEvaluation,
);

studentEvaluationRoutes.patch(
  "/evaluations/respond/:evaluationId",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  respondToStudentEvaluation,
);

studentEvaluationRoutes.patch(
  "/evaluations/restore/:evaluationId",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  restoreDisputedEvaluation,
);

studentEvaluationRoutes.get(
  "/evaluations/disputed",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getDisputedStudentEvaluations,
);

studentEvaluationRoutes.get(
  "/evaluations/all",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getAllStudentEvaluations,
);

studentEvaluationRoutes.patch(
  "/evaluations/:evaluationId/review",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  reviewDisputedEvaluation,
);

export default studentEvaluationRoutes;
