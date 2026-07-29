import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  approveInternshipRecord,
  createInternshipRecord,
  finishInternshipRecord,
  getActiveInternship,
  getAllActiveInternships,
  getAllUserInternships,
  getRegions,
} from "../controllers/internshipRecordControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const internshipRecordRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

internshipRecordRoutes.get(
  "/regions",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getRegions,
);

internshipRecordRoutes.get(
  "/internships/active",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getActiveInternship,
);

internshipRecordRoutes.get(
  "/internships/active/all",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getAllActiveInternships,
);

internshipRecordRoutes.get(
  "/internships/all",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  getAllUserInternships,
);

internshipRecordRoutes.post(
  "/internships/new",
  verifyUser,
  verifyRole(["student", "admin"]),
  upload.none(),
  strictLimiter,
  createInternshipRecord,
);

internshipRecordRoutes.patch(
  "/internships/finish/:internshipId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  finishInternshipRecord,
);

internshipRecordRoutes.patch(
  "/internship/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  upload.none(),
  mediumLimiter,
  approveInternshipRecord,
);

export default internshipRecordRoutes;
