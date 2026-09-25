import express from "express";
import multer from "multer";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  createUser,
  deactivateAccount,
  deleteUserAvatar,
  getAllAccounts,
  getAvailableAvatars,
  getCreateAccountFormData,
  getRoles,
  getUserProfile,
  reactivateAccount,
  updatePassword,
  updateUserAvatar,
  updateUserInfo,
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
  "/avatars",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getAvailableAvatars,
);

accountRoutes.patch(
  "/profile/avatar",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  mediumLimiter,
  updateUserAvatar,
);

accountRoutes.delete(
  "/profile/avatar",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  mediumLimiter,
  deleteUserAvatar,
);

accountRoutes.get(
  "/account/user",
  verifyUser,
  // verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getUserProfile,
);

accountRoutes.put(
  "/account/update",
  verifyUser,
  // verifyRole(["student", "employer", "department_head", "admin"]),
  mediumLimiter,
  updateUserInfo,
);

accountRoutes.put(
  "/account/update-password",
  verifyUser,
  // verifyRole(["student", "employer", "department_head", "admin"]),
  mediumLimiter,
  updatePassword,
);

accountRoutes.get(
  "/accounts",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getAllAccounts,
);

accountRoutes.get(
  "/create-account-form-data",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getCreateAccountFormData,
);

accountRoutes.get(
  "/roles",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  getRoles,
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
