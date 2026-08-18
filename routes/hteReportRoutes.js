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
  getAvailableAcademicYears,
  getHteCompanyList,
  getHteCompanyReport,
} from "../controllers/hteReportControllers.js";

const hteReportRoutes = express.Router();

// Shared helper — throws-free, just returns true/false

hteReportRoutes.get(
  "/reports/academic-years",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getAvailableAcademicYears,
);

hteReportRoutes.get(
  "/reports/hte-annual/companies",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getHteCompanyList,
);

hteReportRoutes.get(
  "/reports/hte-annual/company",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getHteCompanyReport,
);
export default hteReportRoutes;
