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
  getTodayDTR,
  getDtrPhoto,
} from "../controllers/dtrControllers.js";
import { getDepartmentAttendance } from "../controllers/departmentAttendanceController.js";
import { requestOvertime, reviewOvertime, submitAutoCloseExplanation, reviewAutoClosedDtr, reportMissedClockOut } from "../controllers/dtrReviewController.js";
import { acceptDtrPhoto } from "../../../middleware/multipart-uploads.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  clockInLimiter,
} from "../../../middleware/rateLimiter.js";

const dtrRoutes = express.Router();

dtrRoutes.get(
  "/dtr/department-attendance",
  verifyUser,
  verifyRole(["department_head"]),
  paginationLimiter,
  getDepartmentAttendance,
);

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
  acceptDtrPhoto,
  clockIn,
);

dtrRoutes.patch(
  "/dtr/clock-out",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  acceptDtrPhoto,
  clockOut,
);

dtrRoutes.get(
  "/dtr/:dtrId/photo/:kind",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getDtrPhoto,
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

dtrRoutes.post("/dtr/overtime/request", verifyUser, verifyRole(["student"]), mediumLimiter, requestOvertime);
dtrRoutes.post("/dtr/missed-clock-out", verifyUser, verifyRole(["student"]), mediumLimiter, reportMissedClockOut);
dtrRoutes.patch("/dtr/:dtrId/overtime", verifyUser, verifyRole(["employer"]), mediumLimiter, reviewOvertime);
dtrRoutes.patch("/dtr/:dtrId/explanation", verifyUser, verifyRole(["student"]), mediumLimiter, submitAutoCloseExplanation);
dtrRoutes.patch("/dtr/:dtrId/auto-close-review", verifyUser, verifyRole(["employer", "department_head"]), mediumLimiter, reviewAutoClosedDtr);

dtrRoutes.delete(
  "/dtr/:dtrId",
  verifyUser,
  verifyRole(["student", "admin"]),
  mediumLimiter,
  deleteDTR,
);



export default dtrRoutes;
