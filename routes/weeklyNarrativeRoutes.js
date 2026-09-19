import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  createWeeklyNarrative,
  deleteWeeklyNarrative,
  editWeeklyNarrative,
  getAllWeeklyNarratives,
  getInternshipRecordWeeklyNarratives,
  getSearchedStudentWeeklyNarratives,
} from "../controllers/weeklyNarrativeControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const weeklyNarrativeRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

weeklyNarrativeRoutes.get(
  "/weekly-narratives/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  getAllWeeklyNarratives,
);

weeklyNarrativeRoutes.post(
  "/weekly-narratives/new",
  verifyUser,
  verifyRole(["student"]),
  upload.none(),
  strictLimiter,
  createWeeklyNarrative,
);

weeklyNarrativeRoutes.patch(
  "/weekly-narratives/:narrativeId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  editWeeklyNarrative,
);

weeklyNarrativeRoutes.delete(
  "/weekly-narratives/:narrativeId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteWeeklyNarrative,
);

weeklyNarrativeRoutes.get(
  "/searched-user/weekly-narratives/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  getSearchedStudentWeeklyNarratives,
);

weeklyNarrativeRoutes.get(
  "/internship-records/weekly-narratives/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordWeeklyNarratives,
);

export default weeklyNarrativeRoutes;
