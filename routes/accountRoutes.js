import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  createUser,
  deactivateAccount,
  getAllAccounts,
  getCourses,
  getDepartments,
  getRoles,
  getUserProfile,
  reactivateAccount,
} from "../controllers/accountControllers.js";
import {
  generalLimiter,
  mediumLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";

const accountRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

accountRoutes.get(
  "/account/user",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getUserProfile,
);

accountRoutes.get(
  "/accounts",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getAllAccounts,
);

accountRoutes.get(
  "/roles",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getRoles,
);

accountRoutes.get(
  "/courses",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  getCourses,
);

accountRoutes.get(
  "/departments",
  verifyUser,
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  getDepartments,
);

accountRoutes.post(
  "/accounts/new",
  verifyUser,
  verifyRole(["admin"]),
  upload.none(),
  strictLimiter,
  createUser,
);

accountRoutes.patch(
  "/accounts/deactivate/:accountId",
  verifyUser,
  verifyRole(["admin"]),
  mediumLimiter,
  deactivateAccount,
);

accountRoutes.patch(
  "/accounts/reactivate/:accountId",
  verifyUser,
  verifyRole(["admin"]),
  mediumLimiter,
  reactivateAccount,
);

export default accountRoutes;
