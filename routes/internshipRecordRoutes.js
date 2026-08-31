import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  approveInternshipRecord,
  createInternshipRecord,
  deleteInternshipRecord,
  downloadInternshipRecordFile,
  finishInternshipRecord,
  getActiveInternship,
  getAllActiveInternships,
  getAllUserInternships,
  getDepartmentInternshipRecords,
  getInternshipRecordDocuments,
  getInternshipRecordDtr,
  getInternshipRecordEvaluations,
  getInternshipRecordNarratives,
  getInternshipRecordOverview,
  getRegions,
  markInternshipFinished,
  restoreInternshipRecord,
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
  verifyRole(["student"]),
  upload.none(),
  strictLimiter,
  createInternshipRecord,
);

internshipRecordRoutes.patch(
  "/internships/finish/:internshipId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  finishInternshipRecord,
);

internshipRecordRoutes.patch(
  "/internship-records/:internshipId/finish",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  markInternshipFinished,
);

internshipRecordRoutes.patch(
  "/internship/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  upload.none(),
  mediumLimiter,
  approveInternshipRecord,
);

internshipRecordRoutes.get(
  "/internship-records/department",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getDepartmentInternshipRecords,
);

internshipRecordRoutes.patch(
  "/internship-records/restore/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  restoreInternshipRecord,
);

internshipRecordRoutes.delete(
  "/internship-records/:internshipId",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  deleteInternshipRecord,
);

internshipRecordRoutes.get(
  "/internship-records/overview/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordOverview,
);

internshipRecordRoutes.get(
  "/internship-records/dtr/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordDtr,
);

internshipRecordRoutes.get(
  "/internship-records/narratives/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordNarratives,
);

internshipRecordRoutes.get(
  "/internship-records/evaluations/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordEvaluations,
);

internshipRecordRoutes.get(
  "/internship-records/documents/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordDocuments,
);

internshipRecordRoutes.get(
  "/internship-records/files/download/:internshipId/:fileId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  downloadInternshipRecordFile,
);

export default internshipRecordRoutes;
