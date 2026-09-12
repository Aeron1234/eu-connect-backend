import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import { generalLimiter } from "../middleware/rateLimiter.js";
import {
  getCourses,
  getDepartments,
  deactivateCourse,
  activateCourse,
  deactivateDepartment,
  activateDepartment,
  addDepartment,
  addCourse,
} from "../controllers/departmentsAndCoursesControllers.js";

const departmentAndCoursesRoutes = express.Router();

departmentAndCoursesRoutes.post(
  "/departments",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  addDepartment,
);

departmentAndCoursesRoutes.post(
  "/courses",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  addCourse,
);

departmentAndCoursesRoutes.get(
  "/courses",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getCourses,
);

departmentAndCoursesRoutes.get(
  "/departments",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  getDepartments,
);

departmentAndCoursesRoutes.patch(
  "/courses/:id/deactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateCourse,
);

departmentAndCoursesRoutes.patch(
  "/courses/:id/activate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  activateCourse,
);

departmentAndCoursesRoutes.patch(
  "/departments/:id/deactivate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deactivateDepartment,
);

departmentAndCoursesRoutes.patch(
  "/departments/:id/activate",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  activateDepartment,
);

export default departmentAndCoursesRoutes;
