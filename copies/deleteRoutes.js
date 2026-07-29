import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  deleteAnnouncement,
  deleteDailyNarrative,
  deleteDTR,
  deleteFile,
} from "./deleteControllers.js";

const deleteRoutes = express.Router();

// DAILY TIME RECORDS
deleteRoutes.delete(
  "/dtr/:dtrId",
  verifyUser,
  verifyRole(["student", "admin"]),
  deleteDTR,
);

// DAILY NARRATIVES
deleteRoutes.delete(
  "/narratives/:narrativeId",
  verifyUser,
  verifyRole(["student", "admin"]),
  deleteDailyNarrative,
);

// INTERNSHIP FILE
deleteRoutes.delete(
  "/file/:fileId",
  verifyUser,
  verifyRole(["student", "admin"]),
  deleteFile,
);

deleteRoutes.delete(
  "/announcement/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  deleteAnnouncement,
);
export default deleteRoutes;
