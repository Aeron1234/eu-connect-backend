import express from "express";
import { verifyUser } from "../middleware/verifyUser.js";
import { verifyRole } from "../middleware/verifyRole.js";
import {
  generalLimiter,
  mediumLimiter,
  paginationLimiter,
} from "../middleware/rateLimiter.js";
import {
  getCalendarMonth,
  getCalendarSchedule,
  createCalendarTodo,
  updateCalendarTodo,
  deleteCalendarTodo,
  createCalendarSchedule,
  updateCalendarSchedule,
  deleteCalendarSchedule,
} from "../controllers/calendarControllers.js";

const router = express.Router();
router.use(verifyUser);

router.get(
  "/calendar",
  verifyRole(["student", "department_head", "admin"]),
  paginationLimiter,
  getCalendarMonth,
);
router.get(
  "/calendar/schedules/:id",
  verifyRole(["student", "department_head", "admin"]),
  generalLimiter,
  getCalendarSchedule,
);

router.post(
  "/calendar/todos",
  verifyRole(["student"]),
  mediumLimiter,
  createCalendarTodo,
);
router.patch(
  "/calendar/todos/:id",
  verifyRole(["student"]),
  mediumLimiter,
  updateCalendarTodo,
);
router.delete(
  "/calendar/todos/:id",
  verifyRole(["student"]),
  mediumLimiter,
  deleteCalendarTodo,
);

router.post(
  "/calendar/schedules",
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  createCalendarSchedule,
);
router.patch(
  "/calendar/schedules/:id",
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  updateCalendarSchedule,
);
router.delete(
  "/calendar/schedules/:id",
  verifyRole(["department_head", "admin"]),
  mediumLimiter,
  deleteCalendarSchedule,
);

export default router;
