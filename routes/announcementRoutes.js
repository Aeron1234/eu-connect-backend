import { cacheRoute } from "../middleware/cache-middleware.js";
import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAllAnnouncements,
  getAnnouncementById,
  getAnnouncementCategories,
  togglePinAnnouncement,
  updateAnnouncement,
} from "../controllers/announcementControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
} from "../middleware/rateLimiter.js";

const announcementRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

announcementRoutes.get(
  "/announcements/categories",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(300),
  getAnnouncementCategories,
);

announcementRoutes.get(
  "/announcements/history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  paginationLimiter,
  cacheRoute(30),
  getAllAnnouncements,
);

announcementRoutes.get(
  "/announcements/:announcementId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getAnnouncementById,
);

announcementRoutes.post(
  "/announcement/new",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  upload.none(),
  mediumLimiter,
  createAnnouncement,
);

announcementRoutes.patch(
  "/announcements/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  updateAnnouncement,
);

announcementRoutes.patch(
  "/announcements/pin/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  togglePinAnnouncement,
);

announcementRoutes.delete(
  "/announcement/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  deleteAnnouncement,
);

export default announcementRoutes;
