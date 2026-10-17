import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  generalLimiter,
  paginationLimiter,
  mediumLimiter,
} from "../../../middleware/rateLimiter.js";
import {
  deleteActivityLog,
  deleteActivityLogsByDateRange,
  previewActivityLogBatchDelete,
  getAllActivityLogs,
  getMyActivityLogs,
} from "../controllers/activityLogsControllers.js";

const activityLogRoutes = express.Router();

activityLogRoutes.get(
  "/activity-logs/mine",
  verifyUser,
  paginationLimiter,
  cacheRoute(30),
  getMyActivityLogs,
);

activityLogRoutes.get(
  "/activity-logs",
  verifyUser,
  verifyRole(["admin"]),
  paginationLimiter,
  cacheRoute(30),
  getAllActivityLogs,
);

// Register static paths before /:logId. Previews must never use cached counts.
activityLogRoutes.get(
  "/activity-logs/batch-delete-preview",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  previewActivityLogBatchDelete,
);

activityLogRoutes.delete(
  "/activity-logs/batch",
  verifyUser,
  verifyRole(["admin"]),
  mediumLimiter,
  deleteActivityLogsByDateRange,
);

activityLogRoutes.delete(
  "/activity-logs/:logId",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deleteActivityLog,
);

export default activityLogRoutes;
