import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  deleteNotification,
  getAllNotifications,
  markAsAllReadNotification,
  markAsReadNotification,
} from "../controllers/notificationControllers.js";
import { generalLimiter } from "../middleware/rateLimiter.js";

const notificationRoutes = express.Router();

notificationRoutes.get(
  "/notifications",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getAllNotifications,
);

notificationRoutes.patch(
  "/notifications/:notificationId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  markAsReadNotification,
);

notificationRoutes.patch(
  "/notifications",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  markAsAllReadNotification,
);

notificationRoutes.delete(
  "/notifications/:notificationId",
  verifyUser,
  generalLimiter, // guessing the limiter tier — adjust to match your other notification routes
  deleteNotification,
);

export default notificationRoutes;
