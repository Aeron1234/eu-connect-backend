import express from "express";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../../../middleware/rateLimiter.js";
import { getStudentMap } from "../controllers/mapControllers.js";
import { getMapCompanyRoute } from "../controllers/mapRoutingControllers.js";

const mapRoutes = express.Router();
mapRoutes.get(
  "/student-map/route/:internshipId",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getMapCompanyRoute,
);
mapRoutes.get(
  "/student-map",
  verifyUser,
  verifyRole(["department_head", "admin"]),
  generalLimiter,
  getStudentMap,
);

export default mapRoutes;
