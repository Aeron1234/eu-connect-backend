import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  uploadLimiter,
} from "../middleware/rateLimiter.js";
import { cacheRoute } from "../middleware/cache-middleware.js";
import {
  listSummaryReports,
  saveSummaryReport,
  deleteSummaryReport,
  getSummaryAttachment,
  getInternshipRecordSummaryReport,
  getInternshipRecordSummaryAttachment,
} from "../controllers/summaryReportControllers.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
}).array("images", 6);
const acceptUpload = (req, res, next) =>
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE")
      return res
        .status(413)
        .json({ error: "Each image must be 5 MB or smaller." });
    if (
      error.code === "LIMIT_FILE_COUNT" ||
      error.code === "LIMIT_UNEXPECTED_FILE"
    )
      return res
        .status(400)
        .json({ error: "Choose up to six JPG, PNG, or WebP images." });
    return res
      .status(400)
      .json({ error: "Could not read the images. Please try again." });
  });
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
  acceptUpload,
  writeLimiter,
  saveSummaryReport,
);
router.patch(
  "/summary-reports/:internshipId",
  ...studentOnly,
  acceptUpload,
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
