import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

process.env.ACCESS_TOKEN_SECRET = "rate-limiter-test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "rate-limiter-test-refresh-secret";
process.env.TEMP_PASSWORD_SECRET = "rate-limiter-test-temp-secret";

const { signAccessToken } = await import("../config/jwt.js");
const { verifyUser } = await import("../middleware/verifyUser.js");
const {
  generalLimiter,
  paginationLimiter,
  mediumLimiter,
  strictLimiter,
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
  app.post("/login", strictLimiter, (_req, res) => res.sendStatus(200));

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

  for (let i = 0; i < 20; i++) {
    assert.equal((await request("/edit", { token: alice, method: "PATCH" })).status, 200);
  }
  assert.equal((await request("/edit", { token: alice, ip: "203.0.113.11", method: "PATCH" })).status, 429);
  assert.equal((await request("/edit", { token: bob, method: "PATCH" })).status, 200);

  for (let i = 0; i < 10; i++) {
    assert.equal((await request("/submit", { token: alice, method: "POST" })).status, 200);
  }
  assert.equal((await request("/submit", { token: alice, ip: "203.0.113.11", method: "POST" })).status, 429);
  assert.equal((await request("/submit", { token: bob, method: "POST" })).status, 200);

  // Login has no verified user, so a different token/header cannot bypass its IP budget.
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("/login", { method: "POST" })).status, 200);
  }
  assert.equal((await request("/login", { method: "POST" })).status, 429);
  assert.equal((await request("/login", { ip: "203.0.113.11", method: "POST" })).status, 200);
});
