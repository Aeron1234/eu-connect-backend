import { cacheStaffInternships } from "../../../middleware/staff-internships-cache.js";
import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import { getDepartmentSubmissions } from "../controllers/departmentSubmissionsController.js";
import { getDepartmentEvaluations } from "../controllers/departmentEvaluationsController.js";
import { updateOwnPendingInternshipRecord } from "../controllers/pendingInternshipRecordController.js";
import {
  approveInternshipRecord,
  createInternshipRecord,
  deleteOwnInternshipRecord,
  downloadInternshipRecordFile,
  finishInternshipRecord,
  getActiveInternship,
  getAllActiveInternships,
  getAllUserInternships,
  getDepartmentInternshipRecords,
  getInternshipRecordDocuments,
  getInternshipRecordDtr,
  getInternshipRecordEvaluations,
  getInternshipRecordOverview,
  getMyPastInternshipRecords,
  getRegions,
  markInternshipFinished,
  restoreInternshipRecord,
} from "../controllers/internshipRecordControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../../../middleware/rateLimiter.js";

const internshipRecordRoutes = express.Router();

internshipRecordRoutes.get(
  "/department-evaluations",
  verifyUser,
  verifyRole(["department_head"]),
  paginationLimiter,
  getDepartmentEvaluations,
);

internshipRecordRoutes.get(
  "/department-submissions",
  verifyUser,
  verifyRole(["department_head"]),
  paginationLimiter,
  getDepartmentSubmissions,
);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

internshipRecordRoutes.get(
  "/regions",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(300),
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
  "/internships/my-past-internships",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(60),
  getMyPastInternshipRecords,
);

internshipRecordRoutes.get(
  "/internships/active/all",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  cacheStaffInternships,
  getAllActiveInternships,
);

internshipRecordRoutes.get(
  "/internships/all",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  cacheStaffInternships,
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
  verifyRole(["department_head"]),
  generalLimiter,
  markInternshipFinished,
);

internshipRecordRoutes.patch(
  "/internship/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  upload.none(),
  mediumLimiter,
  approveInternshipRecord,
);

internshipRecordRoutes.get(
  "/internship-records/department",
  verifyUser,
  verifyRole(["department_head"]),
  paginationLimiter,
  getDepartmentInternshipRecords,
);

internshipRecordRoutes.patch(
  "/internship-records/restore/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  restoreInternshipRecord,
);

internshipRecordRoutes.patch(
  "/internship-records/mine/:internshipId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  upload.none(),
  updateOwnPendingInternshipRecord,
);

internshipRecordRoutes.delete(
  "/internship-records/mine/:internshipId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  deleteOwnInternshipRecord,
);

internshipRecordRoutes.get(
  "/internship-records/overview/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getInternshipRecordOverview,
);

internshipRecordRoutes.get(
  "/internship-records/dtr/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getInternshipRecordDtr,
);

internshipRecordRoutes.get(
  "/internship-records/evaluations/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getInternshipRecordEvaluations,
);

internshipRecordRoutes.get(
  "/internship-records/documents/:internshipId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  getInternshipRecordDocuments,
);

internshipRecordRoutes.get(
  "/internship-records/files/download/:internshipId/:fileId",
  verifyUser,
  verifyRole(["department_head"]),
  generalLimiter,
  downloadInternshipRecordFile,
);

export default internshipRecordRoutes;
