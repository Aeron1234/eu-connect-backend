import { cacheAttendanceHistory } from "../../../middleware/attendance-history-cache.js";
import express from "express";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  clockIn,
  clockOut,
  startBreak,
  resumeDuty,
  deleteDTR,
  getAllDTRs,
  getLatestDtrStatus,
  getMySettedDtrLocation,
  getTodayDTR,
} from "../controllers/dtrControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  clockInLimiter,
} from "../../../middleware/rateLimiter.js";

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
  cacheAttendanceHistory,
  getAllDTRs,
);

dtrRoutes.get(
  "/dtr/status",
  verifyUser,
  verifyRole(["student", "admin"]),
  generalLimiter,
  getLatestDtrStatus,
);

dtrRoutes.post(
  "/dtr/clock-in",
  verifyUser,
  verifyRole(["student"]),
  clockInLimiter,
  clockIn,
);

dtrRoutes.patch(
  "/dtr/clock-out",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  clockOut,
);

dtrRoutes.post(
  "/dtr/break/start",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  startBreak,
);

dtrRoutes.patch(
  "/dtr/break/resume",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  resumeDuty,
);

dtrRoutes.delete(
  "/dtr/:dtrId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteDTR,
);

dtrRoutes.get(
  "/dtr/setted-location",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getMySettedDtrLocation,
);

export default dtrRoutes;
