import { canonicalApiPath } from "./api.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db.js";

const requestStorage = new AsyncLocalStorage();
const MAX_ERRORS_PER_REQUEST = 5;
const MAX_PENDING_WRITES = 100;
let pendingWrites = 0;

// Redact recognized tokens/emails/secret patterns and bound stored text length.
// This is targeted scrubbing, not proof that arbitrary error text contains no secrets.
function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/([?&](?:token|key|secret|password|code)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/\b((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, maxLength);
}

function errorLocation(error) {
  const frame = String(error?.stack || "").split("\n").find((line) =>
    /(?:controllers|middleware|config|routes)[\\/].*:\d+:\d+/.test(line),
  );
  if (!frame) return null;
  const match = frame.match(/((?:controllers|middleware|config|routes)[\\/][^\s)]+:\d+:\d+)/);
  return match ? cleanText(match[1].replaceAll("\\", "/"), 300) : null;
}

function errorDetails(args) {
  const error = args.find((value) => value instanceof Error) ||
    args.find((value) => value && typeof value === "object" && (value.code || value.message));
  const context = args.filter((value) => typeof value === "string").join(" ");
  return {
    context: cleanText(context, 160),
    errorName: cleanText(error?.name || "Error", 80),
    errorCode: error?.code ? cleanText(error.code, 80) : null,
    message: cleanText(error?.message || context || "Unexpected server error"),
    location: errorLocation(error),
  };
}

function routePattern(req) {
  if (typeof req.route?.path === "string") return canonicalApiPath(`${req.baseUrl}${req.route.path}`).slice(0, 255);
  return canonicalApiPath(String(req.path || "unknown"))
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .slice(0, 255);
}

// Bound concurrent best-effort writes in this process. Queue overflow drops an
// occurrence; these writes are neither durable jobs nor awaited by the response.
function queueOccurrence(entry) {
  if (pendingWrites >= MAX_PENDING_WRITES) {
    console.error("Error tracking queue full; occurrence omitted.");
    return;
  }
  pendingWrites += 1;
  void db.execute(
    `INSERT INTO error_events
      (fingerprint, request_id, source, method, route_pattern, status_code,
       error_name, error_code, context, message, code_location, actor_id, actor_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.fingerprint, entry.requestId, entry.source, entry.method,
      entry.routePattern, entry.statusCode, entry.errorName, entry.errorCode,
      entry.context, entry.message, entry.location, entry.actorId, entry.actorRole],
  ).catch((error) => {
    // Tracking must never turn a successful request into a failed one.
    console.error("Could not persist error occurrence:", error);
  }).finally(() => {
    pendingWrites -= 1;
  });
}

// Persist reported request errors after response finish, even when the final status
// is not 5xx. Unreported 5xx responses receive one synthetic error occurrence.
function persistRequestErrors(req, res, state) {
  const errors = state.errors.length
    ? state.errors
    : res.statusCode >= 500
      ? [errorDetails([`HTTP ${res.statusCode} response`])]
      : [];
  const pattern = routePattern(req);
  const seen = new Set();
  for (const error of errors) {
    // Group by method/route/code-or-name/context/location, not the variable message.
    // Identical fingerprints are recorded once per request; separate requests add events.
    const identity = ["http", req.method, pattern, error.errorCode || error.errorName,
      error.context, error.location].join("|");
    const fingerprint = createHash("sha256").update(identity).digest("hex");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    queueOccurrence({
      ...error,
      fingerprint,
      requestId: state.requestId,
      source: "http",
      method: req.method,
      routePattern: pattern,
      statusCode: res.statusCode,
      actorId: req.verifiedUser?.id || null,
      actorRole: req.verifiedUser?.role || null,
    });
  }
}

export function errorTrackingContext(req, res, next) {
  const state = { requestId: randomUUID(), errors: [] };
  res.setHeader("X-Request-ID", state.requestId);
  res.once("finish", () => persistRequestErrors(req, res, state));
  requestStorage.run(state, next);
}

// Always log to console; collect at most five reports in the active request context.
// Outside an HTTP context this does not persist an event; background jobs use
// reportBackgroundError explicitly.
export function reportError(...args) {
  console.error(...args);
  const state = requestStorage.getStore();
  if (state && state.errors.length < MAX_ERRORS_PER_REQUEST) {
    state.errors.push(errorDetails(args));
  }
}

export function reportBackgroundError(source, error) {
  console.error(`${source} failed:`, error);
  const details = errorDetails([error]);
  queueOccurrence({
    ...details,
    fingerprint: createHash("sha256").update(["job", source, details.errorCode || details.errorName,
      details.location].join("|")).digest("hex"),
    requestId: null,
    source: cleanText(source, 80),
    method: null,
    routePattern: null,
    statusCode: null,
    actorId: null,
    actorRole: null,
  });
}

// Remove events older than 30 database-time days in batches of 1,000 until drained.
// Retention removes occurrences, so a group's recorded history can shrink.
export async function purgeOldErrorEvents() {
  let removed = 0;
  do {
    const [result] = await db.execute(
      "DELETE FROM error_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 1000",
    );
    removed = result.affectedRows;
  } while (removed === 1000);
}
