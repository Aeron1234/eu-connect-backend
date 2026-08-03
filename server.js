import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";

import announcementRoutes from "./routes/announcementRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import internshipRecordRoutes from "./routes/internshipRecordRoutes.js";
import dtrRoutes from "./routes/dtrRoutes.js";
import narrativeRoutes from "./routes/narrativeRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import studentEvaluationRoutes from "./routes/studentEvaluationRoutes.js";
import dashboardStatsRoutes from "./routes/dashboardStatsRoutes.js";
import searchHistoryRoutes from "./routes/searchhistoryRoutes.js";
import searchedUserRoutes from "./routes/searchedUserRoutes.js";
import { autoCloseStaleShifts } from "./config/autoCloseStaleShifts.js";
import internshipPostingRoutes from "./routes/internshipPostsRoutes.js";

dotenv.config();

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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.set("socketio", io);

// Health check endpoint for Render
app.get("/", (req, res) => {
  res.status(200).send("API Service is live.");
});

// Routes
app.use("/eu-connect/api", announcementRoutes);
app.use("/eu-connect/api", accountRoutes);
app.use("/eu-connect/api", internshipRecordRoutes);
app.use("/eu-connect/api", dtrRoutes);
app.use("/eu-connect/api", narrativeRoutes);
app.use("/eu-connect/api", fileRoutes);
app.use("/eu-connect/api", notificationRoutes);
app.use("/eu-connect/api", studentEvaluationRoutes);
app.use("/eu-connect/api", dashboardStatsRoutes);
app.use("/eu-connect/api", searchHistoryRoutes);
app.use("/eu-connect/api", searchedUserRoutes);
app.use("/eu-connect/api", internshipPostingRoutes);

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

// Cron Jobs
cron.schedule("0 * * * *", () => {
  console.log("Running autoCloseStaleShifts job...");
  autoCloseStaleShifts();
});

// Port Configuration
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
