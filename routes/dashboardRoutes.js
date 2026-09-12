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
  getAdminDashboardStats,
  getAvailableShiftHoursMonths,
  getAverageShiftHoursByWeek,
  getDepartmentHeadDashboardStats,
  getEmployerDashboardStats,
  getOngoingInternshipsByDepartment,
  getOngoingInternshipsPerCourse,
  getPostedJobs,
  getRecentSystemActivity,
  getStudentDashboardStats,
  getSupervisedInterns,
  getUserGrowthOverTime,
  getUsersByRole,
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
  getStudentDashboardStats,
);

///////////////////
//EMPLOYER
//////////////////
dashboardRoutes.get(
  "/employer-dashboard-stats",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  getEmployerDashboardStats,
);

dashboardRoutes.get(
  "/supervised-interns",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  getSupervisedInterns,
);

dashboardRoutes.get(
  "/posted-jobs",
  verifyUser,
  verifyRole(["employer"]),
  generalLimiter,
  getPostedJobs,
);

///////////////////
//DEPARTMENT HEAD
//////////////////
dashboardRoutes.get(
  "/department-head-dashboard-stats",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getDepartmentHeadDashboardStats,
);

dashboardRoutes.get(
  "/ongoing-internships-per-course",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getOngoingInternshipsPerCourse,
);

dashboardRoutes.get(
  "/average-shift-hours",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getAverageShiftHoursByWeek,
);

dashboardRoutes.get(
  "/available-shift-hours-months",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getAvailableShiftHoursMonths,
);

///////////////////
//ADMIN
//////////////////
dashboardRoutes.get(
  "/admin-dashboard-stats",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getAdminDashboardStats,
);

dashboardRoutes.get(
  "/user-growth",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getUserGrowthOverTime,
);

dashboardRoutes.get(
  "/users-by-role",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getUsersByRole,
);

dashboardRoutes.get(
  "/internships-by-department",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getOngoingInternshipsByDepartment,
);

dashboardRoutes.get(
  "/admin-recent-activity",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getRecentSystemActivity,
);

export default dashboardRoutes;
