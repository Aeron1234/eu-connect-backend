import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  clockIn,
  clockOut,
  deleteDTR,
  getAllDTRs,
  getLatestDtrStatus,
  getTodayDTR,
} from "../controllers/dtrControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const dtrRoutes = express.Router();

dtrRoutes.get(
  "/dtr/today",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getTodayDTR,
);

dtrRoutes.get(
  "/dtr/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  getAllDTRs,
);

dtrRoutes.get(
  "/dtr/status",
  verifyUser,
  verifyRole(["student", "admin"]),
  paginationLimiter,
  getLatestDtrStatus,
);

dtrRoutes.post(
  "/dtr/clock-in",
  verifyUser,
  verifyRole(["student"]),
  strictLimiter,
  clockIn,
);

dtrRoutes.patch(
  "/dtr/clock-out",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  clockOut,
);

dtrRoutes.delete(
  "/dtr/:dtrId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteDTR,
);

export default dtrRoutes;
