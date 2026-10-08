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
import { registerNotificationSockets } from "./config/socketAuth.js";
import { autoCloseStaleShifts } from "./config/autoCloseStaleShifts.js";
import { refreshTokensCleanUp } from "./config/refreshTokensCleanUp.js";
import { errorTrackingContext, purgeOldErrorEvents, reportBackgroundError, reportError } from "./config/errorTracking.js";

import announcementRoutes from "./routes/announcementRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import internshipRecordRoutes from "./routes/internshipRecordRoutes.js";
import dtrRoutes from "./routes/dtrRoutes.js";
import narrativeRoutes from "./routes/narrativeRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import studentEvaluationRoutes from "./routes/studentEvaluationRoutes.js";
import searchHistoryRoutes from "./routes/searchhistoryRoutes.js";
import searchedUserRoutes from "./routes/searchedUserRoutes.js";

import internshipPostingRoutes from "./routes/internshipPostsRoutes.js";
import supervisorRequestRoutes from "./routes/supervisorRequestRoutes.js";
import employerEvaluationsRoutes from "./routes/employerEvaluationsRoutes.js";
import mapRoutes from "./routes/mapRoutes.js";
import hteReportRoutes from "./routes/hteReportRoutes.js";
import alumniRoutes from "./routes/alumniRecordRoutes.js";
import criteriaRoutes from "./routes/evaluationsCriteriaRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import activityLogRoutes from "./routes/activityLogsRoutes.js";
import departmentAndCoursesRoutes from "./routes/departmentsAndCoursesRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import cacheMonitoringRoutes from "./routes/cacheMonitoringRoutes.js";
import weeklyNarrativeRoutes from "./routes/weeklyNarrativeRoutes.js";
import errorTrackingRoutes from "./routes/errorTrackingRoutes.js";

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
app.use("/eu-connect/api", authRoutes);
app.use("/eu-connect/api", announcementRoutes);
app.use("/eu-connect/api", accountRoutes);
app.use("/eu-connect/api", internshipRecordRoutes);
app.use("/eu-connect/api", dtrRoutes);
app.use("/eu-connect/api", narrativeRoutes);
app.use("/eu-connect/api", weeklyNarrativeRoutes);
app.use("/eu-connect/api", fileRoutes);
app.use("/eu-connect/api", notificationRoutes);
app.use("/eu-connect/api", studentEvaluationRoutes);
app.use("/eu-connect/api", dashboardRoutes);
app.use("/eu-connect/api", calendarRoutes);
app.use("/eu-connect/api", searchHistoryRoutes);
app.use("/eu-connect/api", searchedUserRoutes);
app.use("/eu-connect/api", internshipPostingRoutes);
app.use("/eu-connect/api", supervisorRequestRoutes);
app.use("/eu-connect/api", employerEvaluationsRoutes);
app.use("/eu-connect/api", mapRoutes);
app.use("/eu-connect/api", hteReportRoutes);
app.use("/eu-connect/api", alumniRoutes);
app.use("/eu-connect/api", criteriaRoutes);
app.use("/eu-connect/api", activityLogRoutes);
app.use("/eu-connect/api", departmentAndCoursesRoutes);
app.use("/eu-connect/api", cacheMonitoringRoutes);
app.use("/eu-connect/api", errorTrackingRoutes);

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
