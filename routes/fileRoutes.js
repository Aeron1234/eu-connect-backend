import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  deleteFile,
  getInternshipFiles,
  uploadInternshipFile,
  downloadInternshipFile,
  getFileRequirementTypes,
} from "../controllers/fileControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const fileRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

fileRoutes.get(
  "/internships/files/requirements",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getFileRequirementTypes,
);

fileRoutes.get(
  "/internships/files",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  getInternshipFiles,
);

fileRoutes.post(
  "/internships/files/new",
  verifyUser,
  verifyRole(["student", "admin"]),
  strictLimiter,
  upload.single("file"),
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
