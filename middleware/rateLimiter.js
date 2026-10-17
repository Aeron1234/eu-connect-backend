import { canonicalApiPath } from "../config/api.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import { verifyRefreshToken } from "../config/jwt.js";

// Protected routes run verifyUser before their limiter. Use that verified
// identity so people on the same school network do not share a request budget.
// Unverified requests without an account identifier fall back to the client IP.
const authenticatedOrIpKey = (req) => {
  const userId = req.verifiedUser?.id;
  if (userId !== undefined && userId !== null && String(userId).trim()) {
    return `user:${userId}`;
  }

  return `ip:${ipKeyGenerator(req.ip)}`;
};

// Read limits are per route, not shared by every page in the app. Express
// exposes the matched route pattern here, so IDs and pagination query strings
// cannot create fresh budgets for the same endpoint.
const readEndpointKey = (req) => {
  const identity = authenticatedOrIpKey(req);
  if (req.method !== "GET" && req.method !== "HEAD") return identity;
  const routePath = req.route?.path;
  if (typeof routePath !== "string") return identity;
  return `${identity}:${req.method}:${canonicalApiPath(`${req.baseUrl}${routePath}`)}`;
};

// This one is for general browsing (Announcements, Profiles)
export const generalLimiter = rateLimit({
  keyGenerator: readEndpointKey,
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
  keyGenerator: readEndpointKey,
  windowMs: 5 * 60 * 1000, // Shorter window (5 mins)
  max: 200, // Very high limit
  message: {
    status: 429,
    error: "Too many requests to this page. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Shared budget for other high-cost submissions.
export const strictLimiter = rateLimit({
  keyGenerator: authenticatedOrIpKey,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Students shouldn't need to create more than 10 records an hour
  message: {
    status: 429,
    error: "Submission limit reached. Please wait an hour before trying again.",
  },
});

// For any action that modifies the database
export const mediumLimiter = rateLimit({
  keyGenerator: authenticatedOrIpKey,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 40, // Shared across edits and deletes, with room for a normal session
  message: {
    status: 429,
    error: "Too many changes made. Please wait a moment before trying again.",
  },
});

// Next.js relays auth requests, so its IP is shared by many legitimate users.
// Hash normalized identifiers to keep credentials/PII out of rate-limit keys.
const authIdentifierKey = (field, scope) => (req) => {
  const identifier = req.body?.[field];
  if (typeof identifier !== "string" || !identifier.trim()) {
    return `${scope}:ip:${ipKeyGenerator(req.ip)}`;
  }
  const digest = createHash("sha256")
    .update(identifier.trim().toLowerCase())
    .digest("hex");
  return `${scope}:${digest}`;
};

// Account lockout is 15 minutes; don't extend it to an hour via the limiter.
// Successful logins and server outages do not consume failed-attempt budgets.
export const authLimiter = rateLimit({
  keyGenerator: authIdentifierKey("username", "login"),
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode >= 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "Too many login attempts for this account. Please try again after 15 minutes.",
  },
});

// Recovery returns a generic 200 even for unknown emails. Count every request
// in its own budget so successful responses cannot bypass email throttling.
export const passwordRecoveryLimiter = rateLimit({
  keyGenerator: authIdentifierKey("email", "password-recovery"),
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "Too many password recovery requests. Please try again after an hour.",
  },
});

export const uploadLimiter = rateLimit({
  keyGenerator: authenticatedOrIpKey,
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: {
    status: 429,
    error: "Too many file uploads. Please try again after an hour.",
  },
});

export const clockInLimiter = rateLimit({
  keyGenerator: authenticatedOrIpKey,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    status: 429,
    error: "Too many clock-in attempts. Please wait 15 minutes before trying again.",
  },
});

export const refreshLimiter = rateLimit({
  keyGenerator: (req) => {
    try {
      // Verify, never merely decode: forged subjects must not create budgets.
      const payload = verifyRefreshToken(req.cookies?.refresh_token);
      if (typeof payload.sub === "string" && payload.sub.trim() && payload.jti) {
        return `refresh:user:${payload.sub}`;
      }
    } catch {
      // Invalid/missing tokens retain an IP-based abuse budget.
    }
    return `refresh:ip:${ipKeyGenerator(req.ip)}`;
  },
  windowMs: 60 * 1000,
  max: 30, // per verified user, including across token rotations
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh attempts, please try again shortly." },
});
