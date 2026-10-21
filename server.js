import { mountApiRoutes } from "./config/api.js";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import cookieParser from "cookie-parser";
import { writeSync } from "node:fs";
import { registerMapLocationSockets } from "./features/map/mapLocationSockets.js";
import { registerNotificationSockets } from "./config/socketAuth.js";
import { autoCloseStaleShifts } from "./config/autoCloseStaleShifts.js";
import { refreshTokensCleanUp } from "./config/refreshTokensCleanUp.js";
import { errorTrackingContext, purgeOldErrorEvents, reportBackgroundError, reportError } from "./config/errorTracking.js";

import announcementRoutes from "./features/announcements/routes/announcementRoutes.js";
import accountRoutes from "./features/accounts/routes/accountRoutes.js";
import internshipRecordRoutes from "./features/internship-records/routes/internshipRecordRoutes.js";
import dtrRoutes from "./features/dtr/routes/dtrRoutes.js";
import narrativeRoutes from "./features/narratives/routes/narrativeRoutes.js";
import fileRoutes from "./features/documents/routes/fileRoutes.js";
import notificationRoutes from "./features/notifications/routes/notificationRoutes.js";
import studentEvaluationRoutes from "./features/evaluations/routes/studentEvaluationRoutes.js";
import searchHistoryRoutes from "./features/search-history/routes/searchhistoryRoutes.js";
import searchedUserRoutes from "./features/users/routes/searchedUserRoutes.js";

import internshipPostingRoutes from "./features/internship-posts/routes/internshipPostsRoutes.js";
import supervisorRequestRoutes from "./features/supervisor-requests/routes/supervisorRequestRoutes.js";
import employerEvaluationsRoutes from "./features/evaluations/routes/employerEvaluationsRoutes.js";
import mapRoutes from "./features/map/routes/mapRoutes.js";
import hteReportRoutes from "./features/sipp-reports/routes/hteReportRoutes.js";
import alumniRoutes from "./features/past-internships/routes/alumniRecordRoutes.js";
import criteriaRoutes from "./features/evaluation-criteria/routes/evaluationsCriteriaRoutes.js";
import authRoutes from "./features/auth/routes/authRoutes.js";
import activityLogRoutes from "./features/activity-logs/routes/activityLogsRoutes.js";
import departmentAndCoursesRoutes from "./features/departments-and-courses/routes/departmentsAndCoursesRoutes.js";
import dashboardRoutes from "./features/dashboard/routes/dashboardRoutes.js";
import calendarRoutes from "./features/calendar/routes/calendarRoutes.js";
import cacheMonitoringRoutes from "./features/cache-monitoring/routes/cacheMonitoringRoutes.js";
import weeklyNarrativeRoutes from "./features/weekly-narratives/routes/weeklyNarrativeRoutes.js";
import summaryReportRoutes from "./features/summary-reports/routes/summaryReportRoutes.js";
import errorTrackingRoutes from "./features/error-tracking/routes/errorTrackingRoutes.js";

// dotenv.config();

// ---------------------------------------------------------------------------
// A fatal exception leaves the process in an unknown state. Write to stderr
// synchronously, then let the process supervisor restart a fresh instance.
// ---------------------------------------------------------------------------
function exitAfterFatal(label, error) {
  try {
    writeSync(2, `${label}: ${error?.stack || String(error)}\n`);
  } finally {
    process.exit(1);
  }
}
process.on("unhandledRejection", (reason) => exitAfterFatal("Unhandled Rejection", reason));
process.on("uncaughtException", (err) => exitAfterFatal("Uncaught Exception", err));

const app = express();
const httpServer = createServer(app);

// Dynamic CORS configuration for both production and local dev
const allowedOrigins = [process.env.CLIENT_URL, "http://localhost:3000"].filter(
  Boolean,
);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["X-Request-ID"],
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.set("socketio", io);
app.set("trust proxy", 1);
app.use(errorTrackingContext);

// Health check endpoint for Render
app.get("/", (req, res) => {
  res.status(200).send("API Service is live.");
});

// Routes
mountApiRoutes(app, [
  authRoutes,
  announcementRoutes,
  accountRoutes,
  internshipRecordRoutes,
  dtrRoutes,
  narrativeRoutes,
  weeklyNarrativeRoutes,
  summaryReportRoutes,
  fileRoutes,
  notificationRoutes,
  studentEvaluationRoutes,
  dashboardRoutes,
  calendarRoutes,
  searchHistoryRoutes,
  searchedUserRoutes,
  internshipPostingRoutes,
  supervisorRequestRoutes,
  employerEvaluationsRoutes,
  mapRoutes,
  hteReportRoutes,
  alumniRoutes,
  criteriaRoutes,
  activityLogRoutes,
  departmentAndCoursesRoutes,
  cacheMonitoringRoutes,
  errorTrackingRoutes,
]);

// ---------------------------------------------------------------------------
// Fallback error-handling middleware.
// If a route handler calls next(err) or throws synchronously, this catches
// it and returns a JSON response instead of letting Express hang or crash.
// Keep this AFTER all app.use(routes) calls.
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  reportError("Unhandled route error:", err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message || "Request failed",
    requestId: res.getHeader("X-Request-ID"),
  });
});

registerNotificationSockets(io);
registerMapLocationSockets(io);

// ---------------------------------------------------------------------------
// Cron Jobs
// Wrapped in try/catch so a failure inside either job (DB timeout, bad
// query, etc.) is logged instead of throwing an unhandled rejection that
// takes down the whole server.
// ---------------------------------------------------------------------------
cron.schedule("0 * * * *", async () => {
  console.log("Running autoCloseStaleShifts job...");
  try {
    await autoCloseStaleShifts();
  } catch (err) {
    reportBackgroundError("autoCloseStaleShifts", err);
  }
});

cron.schedule("0 3 * * *", async () => {
  console.log("Running refreshTokensCleanUp...");
  try {
    await refreshTokensCleanUp();
  } catch (err) {
    reportBackgroundError("refreshTokensCleanUp", err);
  }
});

cron.schedule("15 3 * * *", async () => {
  try {
    await purgeOldErrorEvents();
  } catch (error) {
    console.error("Error tracking retention job failed:", error);
  }
});

// Port Configuration
const PORT = process.env.PORT || 7000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
