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
  deleteActivityLog,
  getAllActivityLogs,
  getMyActivityLogs,
} from "../controllers/activityLogsControllers.js";

const activityLogRoutes = express.Router();

activityLogRoutes.get(
  "/activity-logs/mine",
  verifyUser,
  generalLimiter,
  cacheRoute(30),
  getMyActivityLogs,
);

activityLogRoutes.get(
  "/activity-logs",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  cacheRoute(30),
  getAllActivityLogs,
);

activityLogRoutes.delete(
  "/activity-logs/:logId",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deleteActivityLog,
);

export default activityLogRoutes;
