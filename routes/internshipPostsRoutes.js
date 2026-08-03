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
  getInternshipPostings,
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
  strictLimiter,
  createInternshipPosting,
);

export default internshipPostingRoutes;
