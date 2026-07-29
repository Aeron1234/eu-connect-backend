import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import { getLocationApi } from "../controllers/locationController.js";
const locationRoutes = express.Router();

locationRoutes.get(
  "/location",
  verifyUser,
  verifyRole(["student", "admin"]),
  getLocationApi,
);

export default locationRoutes;
