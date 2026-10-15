import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";

process.env.ACCESS_TOKEN_SECRET = "rate-limiter-test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "rate-limiter-test-refresh-secret";
process.env.TEMP_PASSWORD_SECRET = "rate-limiter-test-temp-secret";

const { signAccessToken, signRefreshToken } = await import("../config/jwt.js");
const { verifyUser } = await import("../middleware/verifyUser.js");
const {
  generalLimiter,
  paginationLimiter,
  mediumLimiter,
  strictLimiter,
  authLimiter,
  passwordRecoveryLimiter,
  refreshLimiter,
  uploadLimiter,
  clockInLimiter,
} = await import("../middleware/rateLimiter.js");

function remaining(response) {
  const value = response.headers.get("ratelimit-remaining") ??
    response.headers.get("ratelimit")?.match(/remaining=(\d+)/)?.[1];
  assert.ok(value, "expected a RateLimit remaining count");
  return Number(value);
}

test("verified users sharing an IP have separate rate-limit budgets", async (t) => {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/browse", verifyUser, generalLimiter, (_req, res) => res.sendStatus(200));
  app.get("/page", verifyUser, paginationLimiter, (_req, res) => res.sendStatus(200));
  app.patch("/edit", verifyUser, mediumLimiter, (_req, res) => res.sendStatus(200));
  app.post("/submit", verifyUser, strictLimiter, (_req, res) => res.sendStatus(200));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const alice = signAccessToken({ id: "rate-test-alice", role: "student" });
  const bob = signAccessToken({ id: "rate-test-bob", role: "student" });
  const request = (path, { token, ip = "203.0.113.10", method = "GET" } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        "X-Forwarded-For": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  for (const path of ["/browse", "/page"]) {
    const firstAlice = await request(path, { token: alice });
    const secondAlice = await request(path, { token: alice, ip: "203.0.113.11" });
    const firstBob = await request(path, { token: bob });
    assert.equal(firstAlice.status, 200);
    assert.equal(secondAlice.status, 200);
    assert.equal(firstBob.status, 200);
    assert.equal(remaining(secondAlice), remaining(firstAlice) - 1);
    assert.equal(remaining(firstBob), remaining(firstAlice));
  }

  for (let i = 0; i < 40; i++) {
    assert.equal((await request("/edit", { token: alice, method: "PATCH" })).status, 200);
  }
  assert.equal((await request("/edit", { token: alice, ip: "203.0.113.11", method: "PATCH" })).status, 429);
  assert.equal((await request("/edit", { token: bob, method: "PATCH" })).status, 200);

  for (let i = 0; i < 10; i++) {
    assert.equal((await request("/submit", { token: alice, method: "POST" })).status, 200);
  }
  assert.equal((await request("/submit", { token: alice, ip: "203.0.113.11", method: "POST" })).status, 429);
  assert.equal((await request("/submit", { token: bob, method: "POST" })).status, 200);

});

async function authApp(t) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json(), cookieParser());
  app.post("/auth/login", authLimiter, (req, res) => res.sendStatus(req.body.replyStatus || 200));
  app.post("/auth/forgot-password", passwordRecoveryLimiter, (_req, res) => res.sendStatus(200));
  app.post("/auth/refresh", refreshLimiter, (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return (path, body = {}, { ip = "203.0.113.20", token } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        ...(token ? { Cookie: `refresh_token=${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
}

test("successful logins and server errors do not exhaust accounts sharing the Next.js IP", async (t) => {
  const request = await authApp(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await request("login", { username: `demo-${i}` })).status, 200);
    assert.equal((await request("login", { username: "repeat-demo" })).status, 200);
    assert.equal((await request("login", { username: "outage-demo", replyStatus: 500 })).status, 500);
  }
  assert.equal((await request("login", { username: "outage-demo" })).status, 200);
});

test("failed login budgets are per normalized username and survive IP changes", async (t) => {
  const request = await authApp(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("login", { username: "failed-demo", replyStatus: 401 })).status, 401);
    assert.equal((await request("login", { username: `other-failed-demo-${i}`, replyStatus: 401 })).status, 401);
  }
  assert.equal((await request("login", { username: " FAILED-DEMO " }, { ip: "203.0.113.21" })).status, 429);
  assert.equal((await request("login", { username: "unrelated-demo" })).status, 200);
  // Missing or invalid identifiers still have a bounded IP-based budget.
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("login", { username: { invalid: i }, replyStatus: 400 })).status, 400);
  }
  assert.equal((await request("login", { replyStatus: 400 })).status, 429);
});

test("password recovery counts generic success responses without blocking other accounts or login", async (t) => {
  const request = await authApp(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("forgot-password", { email: "recovery@example.com" })).status, 200);
  }
  assert.equal((await request("forgot-password", { email: " RECOVERY@EXAMPLE.COM " })).status, 429);
  assert.equal((await request("forgot-password", { email: "someone-else@example.com" })).status, 200);
  assert.equal((await request("login", { username: "recovery@example.com" })).status, 200);
});

test("refresh limits use verified users across rotations, not the shared server IP", async (t) => {
  const request = await authApp(t);
  for (let i = 0; i < 30; i++) {
    const token = signRefreshToken("refresh-alice", `rotation-${i}`);
    assert.equal((await request("refresh", {}, { token })).status, 200);
    const other = signRefreshToken(`refresh-demo-${i}`, "session");
    assert.equal((await request("refresh", {}, { token: other })).status, 200);
  }
  assert.equal((await request("refresh", {}, {
    token: signRefreshToken("refresh-alice", "new-rotation"), ip: "203.0.113.21",
  })).status, 429);
  assert.equal((await request("refresh", {}, { token: signRefreshToken("refresh-bob", "session") })).status, 200);
});

test("unverified refresh subjects cannot create separate budgets or exhaust a valid user's budget", async (t) => {
  const request = await authApp(t);
  for (let i = 0; i < 30; i++) {
    // Access-token signatures are invalid for the refresh-token secret.
    const forged = signAccessToken({ id: `forged-refresh-${i}`, role: "student" });
    assert.equal((await request("refresh", {}, { token: forged, ip: "203.0.113.30" })).status, 200);
  }
  assert.equal((await request("refresh", {}, { token: "invalid", ip: "203.0.113.30" })).status, 429);
  assert.equal((await request("refresh", {}, {
    token: signRefreshToken("legitimate-refresh-user", "session"), ip: "203.0.113.30",
  })).status, 200);
});

test("read limits are per matched endpoint, independent of page and record IDs", async (t) => {
  const app = express();
  app.get("/browse", verifyUser, generalLimiter, (_req, res) => res.sendStatus(200));
  app.get("/another", verifyUser, generalLimiter, (_req, res) => res.sendStatus(200));
  app.get("/pages", verifyUser, paginationLimiter, (_req, res) => res.sendStatus(200));
  app.get("/history/:studentId", verifyUser, paginationLimiter, (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const token = signAccessToken({ id: "rate-test-read-route", role: "student" });
  const request = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const browse = await request("/browse");
  const other = await request("/another");
  const browseAgain = await request("/browse?search=example");
  assert.equal(remaining(other), remaining(browse));
  assert.equal(remaining(browseAgain), remaining(browse) - 1);

  const firstPage = await request("/pages?page=1");
  const secondPage = await request("/pages?page=20");
  const firstStudent = await request("/history/student-a?page=1");
  const secondStudent = await request("/history/student-b?page=2");
  assert.equal(remaining(secondPage), remaining(firstPage) - 1);
  assert.equal(remaining(firstStudent), remaining(firstPage));
  assert.equal(remaining(secondStudent), remaining(firstStudent) - 1);
});

test("uploads and clock-in do not consume each other's or other submission budgets", async (t) => {
  const app = express();
  app.post("/submit", verifyUser, strictLimiter, (_req, res) => res.sendStatus(200));
  app.post("/upload", verifyUser, uploadLimiter, (_req, res) => res.sendStatus(200));
  app.post("/clock-in", verifyUser, clockInLimiter, (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const token = signAccessToken({ id: "rate-test-dedicated-buckets", role: "student" });
  const request = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  for (let i = 0; i < 30; i++) assert.equal((await request("/upload")).status, 200);
  assert.equal((await request("/upload")).status, 429);
  for (let i = 0; i < 15; i++) assert.equal((await request("/clock-in")).status, 200);
  assert.equal((await request("/clock-in")).status, 429);
  assert.equal((await request("/submit")).status, 200);
});
