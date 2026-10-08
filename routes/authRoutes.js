import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { authLimiter, refreshLimiter } from "../middleware/rateLimiter.js";
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
// authRoutes.post("/auth/refresh", refresh);
authRoutes.post("/auth/logout", logout);
authRoutes.get("/auth/me", verifyUser, me);
authRoutes.post("/auth/forgot-password", authLimiter, forgotPassword);
authRoutes.patch("/auth/set-password", verifyUser, setPassword);
authRoutes.post("/auth/refresh", refreshLimiter, refresh);
authRoutes.post("/auth/socket-ticket", verifyUser, createSocketTicket);
export default authRoutes;
