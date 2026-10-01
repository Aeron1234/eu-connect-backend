import assert from "node:assert/strict";
import { test } from "node:test";

process.env.ACCESS_TOKEN_SECRET = "socket-auth-test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "socket-auth-test-refresh-secret";
process.env.TEMP_PASSWORD_SECRET = "socket-auth-test-temp-secret";

const { signAccessToken, verifyAccessToken } = await import("../config/jwt.js");
const {
  authenticateNotificationSocket,
  registerNotificationSockets,
  signSocketTicket,
  verifySocketTicket,
} = await import("../config/socketAuth.js");
const { createSocketTicket } = await import("../controllers/socketAuthController.js");

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("socket ticket endpoint uses the verified access token identity", () => {
  const token = signAccessToken({ id: 42, username: "student42", role: "student" });
  const res = response();
  createSocketTicket(
    { headers: { authorization: `Bearer ${token}` }, verifiedUser: { id: 42 } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(verifySocketTicket(res.body.ticket).userId, "42");
  assert.notEqual(res.body.ticket, token);
  assert.throws(() => verifyAccessToken(res.body.ticket));

  const forged = response();
  createSocketTicket(
    { headers: { authorization: `Bearer ${token}` }, verifiedUser: { id: 99 } },
    forged,
  );
  assert.equal(forged.statusCode, 401);
  assert.equal(forged.body.ticket, undefined);
});

test("socket handshake rejects missing, forged and expired identities", () => {
  const access = signAccessToken({ id: 7, role: "student" });
  const ticket = signSocketTicket(7, Math.floor(Date.now() / 1000) + 600);

  for (const invalid of [undefined, "not-a-ticket", access]) {
    const socket = { handshake: { auth: { ticket: invalid } }, data: {} };
    let error;
    authenticateNotificationSocket(socket, (result) => { error = result; });
    assert.equal(error?.message, "Unauthorized socket");
    assert.equal(socket.data.userId, undefined);
  }

  const expiredSession = signSocketTicket(7, Math.floor(Date.now() / 1000) - 1);
  assert.throws(() => verifySocketTicket(expiredSession));

  const socket = { handshake: { auth: { ticket } }, data: {} };
  let error;
  authenticateNotificationSocket(socket, (result) => { error = result; });
  assert.equal(error, undefined);
  assert.equal(socket.data.userId, "7");
});

test("connected socket joins only its verified room; client join events are ignored", () => {
  const handlers = new Map();
  const io = {
    use(handler) { handlers.set("middleware", handler); },
    on(event, handler) { handlers.set(event, handler); },
  };
  registerNotificationSockets(io);

  const socket = {
    handshake: {
      auth: {
        ticket: signSocketTicket(7, Math.floor(Date.now() / 1000) + 600),
        userId: 99,
      },
    },
    data: {},
    roomsJoined: [],
    listeners: new Map(),
    join(room) { this.roomsJoined.push(room); },
    on(event, handler) { this.listeners.set(event, handler); },
  };

  handlers.get("middleware")(socket, (error) => assert.equal(error, undefined));
  handlers.get("connection")(socket);
  assert.deepEqual(socket.roomsJoined, ["user-7"]);
  assert.equal(socket.listeners.has("join"), false);
  socket.listeners.get("disconnect")();
});
