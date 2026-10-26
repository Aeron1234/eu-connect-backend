import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { createLiveDtrLocationService } from "./liveDtrLocation.js";

// Derive a ticket-specific signing key from the deployment secret. Socket
// tickets use this key plus purpose/audience checks, separate from API JWTs.
const socketSecret = crypto
  .createHmac("sha256", process.env.ACCESS_TOKEN_SECRET)
  .update("eu-connect/notification-socket/v1")
  .digest();

const audience = "eu-connect-notifications";
const issuer = "eu-connect-api";

// The ticket is valid for a 30-second handshake window. accessExp separately
// limits how long the resulting connection may remain authorized.
export function signSocketTicket(userId, accessExpiresAt) {
  if (!userId || !Number.isInteger(accessExpiresAt)) {
    throw new Error("A verified user and access expiry are required");
  }

  return jwt.sign(
    { sub: String(userId), purpose: "notification_socket", accessExp: accessExpiresAt },
    socketSecret,
    { algorithm: "HS256", audience, issuer, expiresIn: "30s" },
  );
}

export function verifySocketTicket(ticket) {
  if (typeof ticket !== "string" || !ticket) {
    throw new Error("Socket ticket required");
  }

  const payload = jwt.verify(ticket, socketSecret, {
    algorithms: ["HS256"],
    audience,
    issuer,
  });

  // A signed ticket must also carry the expected purpose and a still-live
  // access-session expiry; the ticket's own expiry is checked by jwt.verify.
  if (
    payload.purpose !== "notification_socket" ||
    !payload.sub ||
    !Number.isInteger(payload.accessExp) ||
    payload.accessExp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Invalid socket ticket");
  }

  return {
    userId: String(payload.sub),
    accessExpiresAtMs: payload.accessExp * 1000,
  };
}

export function authenticateNotificationSocket(socket, next) {
  try {
    const identity = verifySocketTicket(socket.handshake.auth?.ticket);
    socket.data.userId = identity.userId;
    socket.data.accessExpiresAtMs = identity.accessExpiresAtMs;
    next();
  } catch {
    next(new Error("Unauthorized socket"));
  }
}

export function registerNotificationSockets(io) {
  const attachLiveDtrLocation = createLiveDtrLocationService();
  io.use(authenticateNotificationSocket);
  io.on("connection", (socket) => {
    // Room identity comes only from the verified ticket, not a client-provided user ID.
    socket.join(`user-${socket.data.userId}`);
    attachLiveDtrLocation(io, socket);

    // An established connection ends at the authorizing access token's expiry,
    // not after the ticket's 30-second handshake window. Reconnect needs a new ticket.
    const timeout = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.accessExpiresAtMs - Date.now()),
    );
    timeout.unref?.();
    socket.on("disconnect", () => clearTimeout(timeout));
  });
}
