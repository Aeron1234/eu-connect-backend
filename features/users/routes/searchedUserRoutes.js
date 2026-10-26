import { requireStudentDepartmentAccess } from "../../../config/studentProfileAccess.js";
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
const cacheSearchedProfile = cacheRoute(30);
function searchedProfileCache(req, res, next) {
  if (req.verifiedUser.role === "department_head") {
    res.set("Cache-Control", "private, no-store");
    return next();
  }
  return cacheSearchedProfile(req, res, next);
}
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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
