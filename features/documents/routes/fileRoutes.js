import { cacheRoute } from "../../../middleware/cache-middleware.js";
import express from "express";
import { acceptDocumentUpload } from "../../../middleware/multipart-uploads.js";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  deleteFile,
  getInternshipFiles,
  uploadInternshipFile,
  downloadInternshipFile,
  getFileRequirementTypes,
  approveInternshipDocument,
} from "../controllers/fileControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  uploadLimiter,
} from "../../../middleware/rateLimiter.js";

const fileRoutes = express.Router();

fileRoutes.get(
  "/internships/files/requirements",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(300),
  getFileRequirementTypes,
);

fileRoutes.get(
  "/internships/files",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(30),
  getInternshipFiles,
);

fileRoutes.patch(
  "/files/:fileId/accept",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  approveInternshipDocument,
);

fileRoutes.post(
  "/internships/files/new",
  verifyUser,
  verifyRole(["student", "admin"]),
  uploadLimiter,
  acceptDocumentUpload,
  uploadInternshipFile,
);

fileRoutes.get(
  "/internships/files/:fileId/download",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  downloadInternshipFile,
);

fileRoutes.delete(
  "/file/:fileId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteFile,
);

export default fileRoutes;
