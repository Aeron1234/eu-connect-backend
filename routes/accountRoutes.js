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
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import { cacheRoute } from "../middleware/cache-middleware.js";

const accountRoutes = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

accountRoutes.get(
  "/avatars",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  cacheRoute(60),
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
  generalLimiter,
  cacheRoute(300),
  getUserProfile,
);

accountRoutes.put("/account/update", verifyUser, mediumLimiter, updateUserInfo);

accountRoutes.put(
  "/account/update-password",
  verifyUser,
  mediumLimiter,
  updatePassword,
);

accountRoutes.get(
  "/accounts",
  verifyUser,
  verifyRole(["admin"]),
  paginationLimiter,
  cacheRoute(60),
  getAllAccounts,
);

accountRoutes.get(
  "/create-account-form-data",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  cacheRoute(60),
  getCreateAccountFormData,
);

accountRoutes.get(
  "/roles",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  cacheRoute(60),
  getRoles,
);

accountRoutes.post(
  "/accounts/new",
  verifyUser,
  verifyRole(["admin"]),
  upload.none(),
  generalLimiter,
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
