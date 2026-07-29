import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  createNarrative,
  deleteDailyNarrative,
  editNarrative,
  getAllNarratives,
} from "../controllers/narrativeControllers.js";
import {
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const narrativeRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

narrativeRoutes.get(
  "/narratives/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  getAllNarratives,
);

narrativeRoutes.post(
  "/narratives/new",
  verifyUser,
  verifyRole(["student"]),
  upload.none(),
  strictLimiter,
  createNarrative,
);

narrativeRoutes.patch(
  "/narratives/:narrativeId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  editNarrative,
);

narrativeRoutes.delete(
  "/narratives/:narrativeId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteDailyNarrative,
);

export default narrativeRoutes;
