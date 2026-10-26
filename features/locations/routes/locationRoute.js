import express from "express";
import { verifyUser } from "../../../middleware/verifyUser.js";
import { verifyRole } from "../../../middleware/verifyRole.js";
import { getLocationApi } from "../controllers/locationController.js";
// Legacy LocationIQ router, currently unmounted by server.js. Defining this route
// does not expose it until a startup router registration imports and mounts it.
const locationRoutes = express.Router();

locationRoutes.get(
  "/location",
  verifyUser,
  verifyRole(["student", "admin"]),
  getLocationApi,
);

export default locationRoutes;
