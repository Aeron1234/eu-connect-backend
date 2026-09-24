import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { refreshLimiter, strictLimiter } from "../middleware/rateLimiter.js";
import {
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  setPassword,
} from "../controllers/authControllers.js";

const authRoutes = express.Router();

authRoutes.post("/auth/login", strictLimiter, login);
// authRoutes.post("/auth/refresh", refresh);
authRoutes.post("/auth/logout", logout);
authRoutes.get("/auth/me", verifyUser, me);
authRoutes.post("/auth/forgot-password", strictLimiter, forgotPassword);
authRoutes.patch("/auth/set-password", verifyUser, setPassword);
authRoutes.post("/auth/refresh", refreshLimiter, refresh);
export default authRoutes;
