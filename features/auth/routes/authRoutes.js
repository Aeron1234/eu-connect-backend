import { completeAccountSetup } from "../accountSetup.js";
import express from "express";
import { verifyUser, verifyPasswordSetupSession } from "../../../middleware/verifyUser.js";
import { authLimiter, passwordRecoveryLimiter, refreshLimiter, accountSetupLimiter } from "../../../middleware/rateLimiter.js";
import {
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  setPassword,
} from "../controllers/authControllers.js";
import { createSocketTicket } from "../controllers/socketAuthController.js";

const authRoutes = express.Router();

authRoutes.post("/auth/login", authLimiter, login);
// Logout uses the refresh cookie and clears cookies even without a valid access JWT.
authRoutes.post("/auth/logout", logout);
authRoutes.get("/auth/me", verifyUser, me);
authRoutes.post("/auth/forgot-password", passwordRecoveryLimiter, forgotPassword);
authRoutes.patch("/auth/set-password", verifyPasswordSetupSession, accountSetupLimiter, setPassword);
authRoutes.post("/auth/account-setup", accountSetupLimiter, completeAccountSetup);
authRoutes.post("/auth/refresh", refreshLimiter, refresh);
authRoutes.post("/auth/socket-ticket", verifyUser, createSocketTicket);
export default authRoutes;
