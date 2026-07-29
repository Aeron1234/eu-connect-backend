import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  clockOut,
  deactivateAccount,
  editNarrative,
  finishInternshipRecord,
  reactivateAccount,
  togglePinAnnouncement,
  updateAnnouncement,
} from "./updateControllers.js";

const updateRoutes = express.Router();

updateRoutes.patch(
  "/internships/finish/:internshipId",
  verifyUser,
  verifyRole(["student", "admin"], finishInternshipRecord),
);

updateRoutes.patch(
  "/dtr/clock-out",
  verifyUser,
  verifyRole(["student", "admin"]),
  clockOut,
);

updateRoutes.patch(
  "/narratives/:narrativeId",
  verifyUser,
  verifyRole(["student"]),
  editNarrative,
);

updateRoutes.patch(
  "/accounts/deactivate/:accountId", // This must match the string AFTER the prefix
  verifyUser,
  verifyRole(["admin"]), // Ensure deactivateAccount is the NEXT argument
  deactivateAccount,
);

updateRoutes.patch(
  "/accounts/reactivate/:accountId",
  verifyUser,
  verifyRole(["admin"]),
  reactivateAccount,
);

updateRoutes.patch(
  "/announcements/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  updateAnnouncement,
);

updateRoutes.patch(
  "/announcements/pin/:announcementId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  togglePinAnnouncement,
);

export default updateRoutes;
