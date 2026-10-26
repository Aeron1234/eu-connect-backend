import { verifyAccessToken } from "../../../config/jwt.js";
import { signSocketTicket } from "../../../config/socketAuth.js";

export function createSocketTicket(req, res) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.cookies?.access_token;

  try {
    // Read the identity and expiry from the verified token itself, and confirm
    // they belong to the middleware-authenticated user before signing a ticket.
    const payload = verifyAccessToken(token);
    if (String(payload.sub) !== String(req.verifiedUser.id)) {
      return res.status(401).json({ error: "Invalid access token" });
    }

    const ticket = signSocketTicket(req.verifiedUser.id, payload.exp);
    res.set("Cache-Control", "private, no-store");
    return res.json({ ticket });
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}
