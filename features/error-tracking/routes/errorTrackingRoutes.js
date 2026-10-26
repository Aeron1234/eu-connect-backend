import express from "express";
import { deleteErrorGroup, getErrorGroup, getErrorGroups } from "../controllers/errorTrackingControllers.js";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import { mediumLimiter, paginationLimiter } from "../../../middleware/rateLimiter.js";

// Every error list/detail/delete endpoint is admin-only; actor metadata is diagnostic
// data and must not be exposed through an unguarded detail read.
const router = express.Router();
router.get("/errors", verifyUser, verifyRole(["admin"]), paginationLimiter, getErrorGroups);
router.get("/errors/:fingerprint", verifyUser, verifyRole(["admin"]), paginationLimiter, getErrorGroup);
router.delete("/errors/:fingerprint", verifyUser, verifyRole(["admin"]), mediumLimiter, deleteErrorGroup);

export default router;
