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
  deleteActivityLog,
  getAllActivityLogs,
  getMyActivityLogs,
} from "../controllers/activityLogsControllers.js";

const activityLogRoutes = express.Router();

activityLogRoutes.get(
  "/activity-logs/mine",
  verifyUser,
  generalLimiter,
  getMyActivityLogs,
);

activityLogRoutes.get(
  "/activity-logs",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getAllActivityLogs,
);

activityLogRoutes.delete(
  "/activity-logs/:logId",
  verifyUser,
  generalLimiter,
  deleteActivityLog,
);

export default activityLogRoutes;
