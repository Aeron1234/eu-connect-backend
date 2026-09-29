import { cacheRoute } from "../middleware/cache-middleware.js";
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
  getAdminDashboardData,
  getAdminDashboardStats,
  getAverageShiftHoursByWeek,
  getDepartmentHeadDashboardData,
  getDepartmentHeadDashboardStats,
  getEmployerDashboardData,
  getEmployerDashboardStats,
  getPostedJobs,
  getStudentDashboardData,
  getStudentDashboardStats,
} from "../controllers/dashboardController.js";

const dashboardRoutes = express.Router();

///////////////////
//STUDENT
//////////////////
dashboardRoutes.get(
  "/dashboard-stats",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  cacheRoute(15),
  getStudentDashboardStats,
);

dashboardRoutes.get(
  "/student-dashboard-data",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getStudentDashboardData,
);

///////////////////
// EMPLOYER
///////////////////

dashboardRoutes.get(
  "/employer-dashboard-stats",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  cacheRoute(15),
  getEmployerDashboardStats,
);

dashboardRoutes.get(
  "/employer-dashboard-data",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  cacheRoute(15),
  getEmployerDashboardData,
);

dashboardRoutes.get(
  "/posted-jobs",
  verifyUser,
  verifyRole(["employer"]),
  paginationLimiter,
  cacheRoute(30),
  getPostedJobs,
);

///////////////////
// DEPARTMENT HEAD
///////////////////

dashboardRoutes.get(
  "/department-head-dashboard-stats",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(15),
  getDepartmentHeadDashboardStats,
);

dashboardRoutes.get(
  "/department-head-dashboard-data",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(15),
  getDepartmentHeadDashboardData,
);

dashboardRoutes.get(
  "/average-shift-hours",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  cacheRoute(15),
  getAverageShiftHoursByWeek,
);

///////////////////
// ADMIN
///////////////////

dashboardRoutes.get(
  "/admin-dashboard-stats",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  cacheRoute(15),
  getAdminDashboardStats,
);

dashboardRoutes.get(
  "/admin-dashboard-data",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  cacheRoute(15),
  getAdminDashboardData,
);

export default dashboardRoutes;
