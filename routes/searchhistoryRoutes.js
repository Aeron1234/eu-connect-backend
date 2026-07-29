import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";

import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
  strictLimiter,
} from "../middleware/rateLimiter.js";
import {
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  saveSearchHistory,
  searchUsers,
} from "../controllers/searchHistoryController.js";

const searchHistoryRoutes = express.Router();

searchHistoryRoutes.get(
  "/search-users",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  searchUsers,
);

searchHistoryRoutes.get(
  "/search-history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  getSearchHistory,
);

searchHistoryRoutes.post(
  "/save-search-history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  saveSearchHistory,
);

searchHistoryRoutes.delete(
  "/clear-search-history",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  clearSearchHistory,
);

searchHistoryRoutes.delete(
  "/delete-search-history/:historyId",
  verifyUser,
  verifyRole(["student", "employer", "department_head", "admin"]),
  generalLimiter,
  deleteSearchHistory,
);

export default searchHistoryRoutes;
