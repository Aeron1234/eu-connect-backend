import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

import {
  getSearchedUser,
  getSearchedStudentDTRs,
  getSearchedStudentNarratives,
  getSearchedStudentFiles,
  setSearchedStudentDtrLocation,
  getSearchedStudentDtrLocation,
  uploadFileToSearchedStudent,
  deleteSearchedStudentFile,
  downloadSearchedStudentInternshipFile,
  getEmployerUploadedFiles,
} from "../controllers/searchedUserController.js";

const searchedUserRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

searchedUserRoutes.get(
  "/searched-user/:searchedUserId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getSearchedUser,
);

searchedUserRoutes.get(
  "/searched-user/dtrs/:studentId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  getSearchedStudentDTRs,
);

searchedUserRoutes.get(
  "/searched-user/narratives/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  getSearchedStudentNarratives,
);

searchedUserRoutes.get(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  getSearchedStudentDtrLocation,
);

searchedUserRoutes.put(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  upload.none(),
  strictLimiter,
  setSearchedStudentDtrLocation,
);

searchedUserRoutes.get(
  "/searched-user/files/:searchedUserId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getSearchedStudentFiles,
);

searchedUserRoutes.get(
  "/searched-user/files/:fileId/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]), // adjust to your actual role strings
  generalLimiter,
  downloadSearchedStudentInternshipFile,
);

searchedUserRoutes.delete(
  "/searched-user/files/:fileId/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]), // adjust to your actual role strings
  generalLimiter,
  deleteSearchedStudentFile,
);

searchedUserRoutes.get(
  "/searched-user/employer-uploaded-files/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "admin"]),
  generalLimiter,
  getEmployerUploadedFiles,
);

searchedUserRoutes.post(
  "/searched-user/files/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "admin"]),
  upload.single("file"),
  strictLimiter,
  uploadFileToSearchedStudent,
);

export default searchedUserRoutes;
