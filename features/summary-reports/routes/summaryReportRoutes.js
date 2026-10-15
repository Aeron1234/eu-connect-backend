import express from "express";
import { acceptSummaryImages } from "../../../middleware/multipart-uploads.js";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  uploadLimiter,
} from "../../../middleware/rateLimiter.js";
import { cacheRoute } from "../../../middleware/cache-middleware.js";
import {
  listSummaryReports,
  saveSummaryReport,
  deleteSummaryReport,
  getSummaryAttachment,
  getInternshipRecordSummaryReport,
  getInternshipRecordSummaryAttachment,
} from "../controllers/summaryReportControllers.js";

const router = express.Router();
const writeLimiter = (req, res, next) =>
  (req.files?.length ? uploadLimiter : mediumLimiter)(req, res, next);
const studentOnly = [verifyUser, verifyRole(["student"])];

router.get(
  "/summary-reports",
  ...studentOnly,
  generalLimiter,
  cacheRoute(30),
  listSummaryReports,
);
router.get(
  "/internship-records/:internshipId/summary-report",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordSummaryReport,
);
router.get(
  "/internship-records/:internshipId/summary-report/attachment",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getInternshipRecordSummaryAttachment,
);
router.get(
  "/summary-reports/:internshipId/attachment",
  ...studentOnly,
  generalLimiter,
  getSummaryAttachment,
);
router.post(
  "/summary-reports/:internshipId",
  ...studentOnly,
  acceptSummaryImages,
  writeLimiter,
  saveSummaryReport,
);
router.patch(
  "/summary-reports/:internshipId",
  ...studentOnly,
  acceptSummaryImages,
  writeLimiter,
  saveSummaryReport,
);
router.delete(
  "/summary-reports/:internshipId",
  ...studentOnly,
  mediumLimiter,
  deleteSummaryReport,
);

export default router;
