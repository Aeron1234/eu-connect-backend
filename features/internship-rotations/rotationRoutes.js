import express from "express";
import { verifyUser } from "../../middleware/verifyUser.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import { generalLimiter, mediumLimiter } from "../../middleware/rateLimiter.js";
import { getRotations, mutateRotation } from "./rotationController.js";

const router = express.Router();
const base = "/internship-records/:internshipId/rotations";
router.get(
  base,
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getRotations,
);
router.patch(
  base + "/settings",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  (req, res, next) => {
    req.rotationOperation = "settings";
    next();
  },
  mutateRotation,
);
router.post(
  base,
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  mutateRotation,
);
router.patch(
  base + "/:rotationId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  mutateRotation,
);
router.delete(
  base + "/:rotationId",
  verifyUser,
  verifyRole(["student"]),
  mediumLimiter,
  mutateRotation,
);
export default router;
