import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import {
  createInternshipPosting,
  deleteInternshipPosting,
  getInternshipPostings,
  toggleInternshipFavorite,
  updateInternshipPosting,
} from "../controllers/internshipPostsControllers.js";

const internshipPostingRoutes = express.Router();

internshipPostingRoutes.get(
  "/internship-postings",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getInternshipPostings,
);

internshipPostingRoutes.post(
  "/internship-postings",
  verifyUser,
  verifyRole(["employer"]),
  // strictLimiter,
  createInternshipPosting,
);

internshipPostingRoutes.put(
  "/internship-postings/:postingId",
  verifyUser,
  verifyRole(["employer"]),
  mediumLimiter,
  updateInternshipPosting,
);

internshipPostingRoutes.delete(
  "/internship-postings/:postingId",
  verifyUser,
  verifyRole(["employer"]),
  mediumLimiter,
  deleteInternshipPosting,
);

internshipPostingRoutes.post(
  "/internship-postings/apply/:postingId",
  verifyUser,
  verifyRole(["student"]),
  strictLimiter,
  toggleInternshipFavorite,
);

export default internshipPostingRoutes;
