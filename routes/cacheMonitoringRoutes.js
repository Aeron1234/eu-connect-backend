import express from "express";
import cache from "../config/cache.js";
import { getCacheMetrics } from "../config/cacheMetrics.js";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import { generalLimiter } from "../middleware/rateLimiter.js";

const cacheMonitoringRoutes = express.Router();

cacheMonitoringRoutes.get(
  "/cache/metrics",
  verifyUser,
  verifyRole(["admin"]),
  generalLimiter,
  (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const stats = cache.getStats();
    const memory = process.memoryUsage();
    res.status(200).json({
      ...getCacheMetrics(),
      scope: "single_process",
      cacheEnabled: process.env.CACHE_ENABLED !== "false",
      storage: {
        keys: stats.keys,
        maxKeys: cache.options.maxKeys,
        keyUtilization: stats.keys / cache.options.maxKeys,
        maxBodyBytes: 256 * 1024,
        estimatedKeyBytes: stats.ksize,
        estimatedValueBytes: stats.vsize,
      },
      processMemoryBytes: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
    });
  },
);

export default cacheMonitoringRoutes;
