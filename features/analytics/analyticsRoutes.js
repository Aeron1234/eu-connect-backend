import express from 'express';
import { verifyUser } from '../../middleware/verifyUser.js';
import { verifyRole } from '../../middleware/verifyRole.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';
import { getCompanyAnalytics,getRegistrarDashboard } from './analyticsController.js';
const router=express.Router();
router.get('/analytics/companies',verifyUser,verifyRole(['admin','department_head']),generalLimiter,getCompanyAnalytics);
router.get('/registrar/dashboard',verifyUser,verifyRole(['department_head']),generalLimiter,getRegistrarDashboard);
export default router;
