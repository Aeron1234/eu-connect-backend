import express from "express";
import {
  getActiveInternship,
  getTodayDTR,
  getAllDTRs,
  getAllNarratives,
  getInternshipFiles,
  getAllActiveInternships,
  getUserProfile,
  getRoles,
  getCourses,
  getAllAccounts,
  getAllAnnouncements,
  getAnnouncementCategories,
} from "./getControllers.js"; // Added .js
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

const getRoutes = express.Router();

// ACCOUNT
getRoutes.get(
  "/account/user",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  getUserProfile,
);

getRoutes.get("/accounts", verifyUser, verifyRole(["admin"]), getAllAccounts);

// ROLES
getRoutes.get("/roles", verifyUser, verifyRole(["admin"]), getRoles);

// COURSES
getRoutes.get(
  "/courses",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  getCourses,
);

// INTERNSHIP RECORDS
getRoutes.get(
  "/internships/active",
  verifyUser,
  verifyRole(["student"]),
  getActiveInternship,
);

getRoutes.get(
  "/internships/active/all",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  getAllActiveInternships,
);

// DAILY TIME RECORDS
getRoutes.get("/dtr/today", verifyUser, verifyRole(["student"]), getTodayDTR);

getRoutes.get(
  "/dtr/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  getAllDTRs,
);

// DAILY NARRATIVES
getRoutes.get(
  "/narratives/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  getAllNarratives,
);

// INTERNSHIP RELATED FILES
getRoutes.get(
  "/internships/files",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  getInternshipFiles,
);

// ANNOUNCEMENTS
getRoutes.get(
  "/announcements/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  getAllAnnouncements,
);

getRoutes.get(
  "/announcements/categories",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  getAnnouncementCategories,
);

export default getRoutes;
