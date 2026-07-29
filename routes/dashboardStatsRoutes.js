import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import { getStudentDashboardStats } from "../controllers/dashboardStatsController.js";

const dashboardStatsRoutes = express.Router();

dashboardStatsRoutes.get(
  "/dashboard-stats",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getStudentDashboardStats,
);

export default dashboardStatsRoutes;
