import express from "express";
import multer from "multer";
import {
  clockIn,
  createAnnouncement,
  createInternshipRecord,
  createNarrative,
  createUser,
  uploadInternshipFile,
} from "./createControllers.js";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

const createRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Internship Records
createRoutes.post(
  "/internships/new",
  verifyUser,
  verifyRole(["student", "admin"]),
  upload.none(),
  createInternshipRecord,
);

// DTR
createRoutes.post(
  "/dtr/clock-in",
  verifyUser,
  verifyRole(["student"]),
  clockIn,
);

// Narratives
createRoutes.post(
  "/narratives/new",
  verifyUser,
  verifyRole(["student"]),
  upload.none(),
  createNarrative,
);

// Internship Files
createRoutes.post(
  "/internships/files/new",
  verifyUser,
  verifyRole(["student", "admin"]),
  upload.single("file"),
  uploadInternshipFile,
);

// Accounts
createRoutes.post(
  "/accounts/new",
  verifyUser,
  verifyRole(["admin"]),
  upload.none(),
  createUser,
);

// Announcements
createRoutes.post(
  "/announcement/new",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  upload.none(),
  createAnnouncement,
);

export default createRoutes;
