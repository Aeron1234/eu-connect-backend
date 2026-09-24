import "dotenv/config";

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import cookieParser from "cookie-parser";
import { autoCloseStaleShifts } from "./config/autoCloseStaleShifts.js";
import { refreshTokensCleanUp } from "./config/refreshTokensCleanUp.js";

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
import weeklyNarrativeRoutes from "./routes/weeklyNarrativeRoutes.js";

// dotenv.config();

// ---------------------------------------------------------------------------
// Global crash guards.
// Without these, any unhandled promise rejection or uncaught exception
// anywhere in the app (including inside route handlers, cron jobs, or
// socket.io listeners) will silently kill the Node process. Render then
// restarts the service, which looks like "the server keeps breaking".
// We log the error instead of letting the process die.
// ---------------------------------------------------------------------------
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

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
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.set("socketio", io);
app.set("trust proxy", 1);

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

// ---------------------------------------------------------------------------
// Fallback error-handling middleware.
// If a route handler calls next(err) or throws synchronously, this catches
// it and returns a JSON response instead of letting Express hang or crash.
// Keep this AFTER all app.use(routes) calls.
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled route error:", err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

// Socket.io Events
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(`user-${userId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

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
    console.error("autoCloseStaleShifts job failed:", err);
  }
});

cron.schedule("0 3 * * *", async () => {
  console.log("Running refreshTokensCleanUp...");
  try {
    await refreshTokensCleanUp();
  } catch (err) {
    console.error("refreshTokensCleanUp job failed:", err);
  }
});

// Port Configuration
const PORT = process.env.PORT || 7000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
