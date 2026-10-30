import multer from 'multer';
import { requireStudentDepartmentAccess } from '../../config/studentProfileAccess.js';
import { getMySettedDtrLocation, getSearchedStudentDtrLocation, setSearchedStudentDtrLocation, removeSearchedStudentDtrLocation } from './individualDtrLocationController.js';
import express from 'express';
import { verifyUser } from '../../middleware/verifyUser.js';
import { verifyRole } from '../../middleware/verifyRole.js';
import { generalLimiter, strictLimiter } from '../../middleware/rateLimiter.js';
import { getDtrLocationStudents, getDtrLocationPins, assignDtrLocations } from './dtrLocationController.js';

const router = express.Router();
router.use('/dtr-locations', verifyUser, verifyRole(['admin', 'department_head', 'employer']));
router.get('/dtr-locations/students', generalLimiter, getDtrLocationStudents);
router.get('/dtr-locations/pins', generalLimiter, getDtrLocationPins);
router.post('/dtr-locations/assign', strictLimiter, assignDtrLocations);
// Keep legacy URLs and their original guards/limiters for deployed clients.
const upload = multer({ storage: multer.memoryStorage() });
router.get(
  "/dtr/setted-location",
  verifyUser,
  verifyRole(["student"]),
  generalLimiter,
  getMySettedDtrLocation,
);

router.get(
  "/searched-user/set-dtr-location/:studentId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  generalLimiter,
  requireStudentDepartmentAccess,
  getSearchedStudentDtrLocation,
);

router.put(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  upload.none(),
  strictLimiter,
  requireStudentDepartmentAccess,
  setSearchedStudentDtrLocation,
);

router.delete(
  "/searched-user/set-dtr-location/:searchedUserId",
  verifyUser,
  verifyRole(["employer", "department_head", "admin"]),
  strictLimiter,
  requireStudentDepartmentAccess,
  removeSearchedStudentDtrLocation,
);
export default router;
