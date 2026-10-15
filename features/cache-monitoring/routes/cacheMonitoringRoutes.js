import { getCacheMonitoringMetrics } from "../controllers/cacheMonitoringControllers.js";
import express from "express";

import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import { generalLimiter } from "../../../middleware/rateLimiter.js";

const cacheMonitoringRoutes = express.Router();

cacheMonitoringRoutes.get(
  "/cache/metrics",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getCacheMonitoringMetrics,
);

export default cacheMonitoringRoutes;
