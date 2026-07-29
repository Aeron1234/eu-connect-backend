import rateLimit from "express-rate-limit";

// This one is for general browsing (Announcements, Profiles)
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    status: 429,
    error: "Too many requests. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// For GET requests that happen frequently via scrolling/pagination
export const paginationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // Shorter window (5 mins)
  max: 200, // Very high limit
  message: {
    status: 429,
    error: "Take a breath! You're scrolling a bit too fast.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// This one is for "Heavy" actions (Creating records, Uploading files)
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Students shouldn't need to create more than 10 records an hour
  message: {
    status: 429,
    error: "Submission limit reached. Please wait an hour before trying again.",
  },
});

// For any action that modifies the database
export const mediumLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Slightly higher than 'Create' to allow for small edits/fixes
  message: {
    status: 429,
    error: "Too many changes made. Please wait a moment before trying again.",
  },
});

// This one is for Security (Login/Register)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    status: 429,
    error:
      "Too many login attempts. For security, please try again in 15 minutes.",
  },
});
