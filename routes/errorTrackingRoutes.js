import express from "express";
import { getErrorGroup, getErrorGroups } from "../controllers/errorTrackingControllers.js";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import { paginationLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.get("/errors", verifyUser, verifyRole(["admin"]), paginationLimiter, getErrorGroups);
router.get("/errors/:fingerprint", verifyUser, verifyRole(["admin"]), paginationLimiter, getErrorGroup);

export default router;
