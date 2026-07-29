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

dotenv.config();
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.set("socketio", io);

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

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(`user-${userId}`);
    // console.log(`User ${userId} joined their personal room`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

cron.schedule("0 * * * *", () => {
  console.log("Running autoCloseStaleShifts job...");
  autoCloseStaleShifts();
});

const PORT = process.env.PORT;

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
