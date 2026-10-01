import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// Derive a separate signing key so a browser-visible socket ticket can never
// be used as an API access token, even though both use the same deployment secret.
const socketSecret = crypto
  .createHmac("sha256", process.env.ACCESS_TOKEN_SECRET)
  .update("eu-connect/notification-socket/v1")
  .digest();

const audience = "eu-connect-notifications";
const issuer = "eu-connect-api";

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
  io.use(authenticateNotificationSocket);
  io.on("connection", (socket) => {
    socket.join(`user-${socket.data.userId}`);

    // An already-connected socket must not outlive the access session that
    // authorized its ticket. The client obtains a fresh ticket on reconnect.
    const timeout = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.accessExpiresAtMs - Date.now()),
    );
    timeout.unref?.();
    socket.on("disconnect", () => clearTimeout(timeout));
  });
}
