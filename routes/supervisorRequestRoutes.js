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
  cancelSupervisorRequest,
  getSupervisorStatus,
  requestSupervisor,
  respondToSupervisorRequest,
} from "../controllers/supervisorRequestController.js";

const supervisorRequestRoutes = express.Router();

supervisorRequestRoutes.get(
  "/supervisor-status/:employerId",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getSupervisorStatus,
);

supervisorRequestRoutes.post(
  "/supervisor-requests",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  requestSupervisor,
);

supervisorRequestRoutes.delete(
  "/supervisor-requests/:requestId",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  cancelSupervisorRequest,
);

supervisorRequestRoutes.patch(
  "/supervisor-requests/respond/:requestId",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  respondToSupervisorRequest,
);

export default supervisorRequestRoutes;
