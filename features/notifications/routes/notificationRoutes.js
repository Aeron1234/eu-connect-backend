
import express from "express";
import multer from "multer";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  deleteNotification,
  getAllNotifications,
  getUnreadNotificationCount,
  markAsAllReadNotification,
  markAsReadNotification,
  openAnnouncementNotification,
} from "../controllers/notificationControllers.js";
import { generalLimiter, paginationLimiter } from "../../../middleware/rateLimiter.js";

const notificationRoutes = express.Router();

function inboxCache(req, res, next) {
  // Supervisor changes must be reflected by the live announcement predicate.
  res.set('Cache-Control', 'private, no-store'); return next();
}

notificationRoutes.get(
  "/notifications/unread-count",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  inboxCache,
  getUnreadNotificationCount,
);

notificationRoutes.get(
  "/notifications",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  inboxCache,
  getAllNotifications,
);

notificationRoutes.patch(
  "/notifications/:notificationId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  markAsReadNotification,
);

notificationRoutes.post(
  "/notifications/:notificationId/open-announcement",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  openAnnouncementNotification,
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
  generalLimiter, // The controller enforces recipient ownership and live request protection.
  deleteNotification,
);

export default notificationRoutes;
