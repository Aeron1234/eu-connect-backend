import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../../../middleware/rateLimiter.js";

import {
  addAlumniInternshipRecord,
  deleteAlumniInternshipRecord,
  getAlumniInternships,
  getCompanyDirectory,
  updateAlumniInternshipRecord,
} from "../controllers/alumniRecordControllers.js";

const alumniRoutes = express.Router();

alumniRoutes.get(
  "/alumni-internships",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  paginationLimiter,
  cacheRoute(60),
  getAlumniInternships,
);

alumniRoutes.post(
  "/alumni-internships",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  addAlumniInternshipRecord,
);

alumniRoutes.patch(
  "/alumni-internships/:recordId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  updateAlumniInternshipRecord,
);

alumniRoutes.delete(
  "/alumni-internships/:recordId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  deleteAlumniInternshipRecord,
);

alumniRoutes.get(
  "/company-directory",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(60),
  getCompanyDirectory,
);

export default alumniRoutes;
