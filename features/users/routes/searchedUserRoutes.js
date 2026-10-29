import { requireStudentDepartmentAccess } from "../../../config/studentProfileAccess.js";
import { getEmployerSupervisionHistory } from "../controllers/employerSupervisionHistoryController.js";
import { getHelpAdminContacts } from "../controllers/helpContactsController.js";
import { cacheAttendanceHistory } from "../../../middleware/attendance-history-cache.js";
import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { acceptCertificateUpload } from "../../../middleware/multipart-uploads.js";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
  uploadLimiter,
} from "../../../middleware/rateLimiter.js";

import {
  getSearchedUser,
  getSearchedStudentDTRs,
  getSearchedStudentFiles,
  setSearchedStudentDtrLocation,
  removeSearchedStudentDtrLocation,
  getSearchedStudentDtrLocation,
  uploadFileToSearchedStudent,
  deleteSearchedStudentFile,
  downloadSearchedStudentInternshipFile,
  getEmployerUploadedFiles,
} from "../controllers/searchedUserController.js";

const searchedUserRoutes = express.Router();
searchedUserRoutes.get("/help/admin-contacts", verifyUser, verifyRole(["student", "department_head"]), generalLimiter, getHelpAdminContacts);
const cacheSearchedProfile = cacheRoute(30);
// Head profile reads bypass this cache so their current student-record permission
// is recomputed. Private tab routes apply their own guard before cache lookup.
function searchedProfileCache(req, res, next) {
  if (req.verifiedUser.role === "department_head") {
    res.set("Cache-Control", "private, no-store");
    return next();
  }
  return cacheSearchedProfile(req, res, next);
}
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Basic completed-placement history is visible to every signed-in role. It does
// not grant access to private student records, dashboard data or evaluations.
searchedUserRoutes.get(
  "/searched-user/:searchedUserId/supervised-interns",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  getEmployerSupervisionHistory,
);

searchedUserRoutes.get(
  "/searched-user/:searchedUserId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  searchedProfileCache,
  getSearchedUser,
);

searchedUserRoutes.get(
  "/searched-user/dtrs/:studentId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  paginationLimiter,
  requireStudentDepartmentAccess,
  cacheAttendanceHistory,
  getSearchedStudentDTRs,
);

searchedUserRoutes.get(
  "/searched-user/set-dtr-location/:studentId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  requireStudentDepartmentAccess,
  getSearchedStudentDtrLocation,
);

searchedUserRoutes.put(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  upload.none(),
  strictLimiter,
  requireStudentDepartmentAccess,
  setSearchedStudentDtrLocation,
);

searchedUserRoutes.delete(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  strictLimiter,
  requireStudentDepartmentAccess,
  removeSearchedStudentDtrLocation,
);

searchedUserRoutes.get(
  "/searched-user/files/:searchedUserId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  requireStudentDepartmentAccess,
  cacheRoute(30),
  getSearchedStudentFiles,
);

searchedUserRoutes.get(
  "/searched-user/files/:fileId/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]), // adjust to your actual role strings
  generalLimiter,
  requireStudentDepartmentAccess,
  downloadSearchedStudentInternshipFile,
);

searchedUserRoutes.delete(
  "/searched-user/files/:fileId/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]), // adjust to your actual role strings
  generalLimiter,
  requireStudentDepartmentAccess,
  deleteSearchedStudentFile,
);

searchedUserRoutes.get(
  "/searched-user/employer-uploaded-files/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "admin"]),
  generalLimiter,
  cacheRoute(30),
  getEmployerUploadedFiles,
);

searchedUserRoutes.post(
  "/searched-user/files/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "admin"]),
  uploadLimiter,
  acceptCertificateUpload,
  uploadFileToSearchedStudent,
);

export default searchedUserRoutes;
