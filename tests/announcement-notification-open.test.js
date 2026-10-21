import { test, after } from "node:test";
import assert from "node:assert/strict";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import { openAnnouncementNotification } from "../features/notifications/controllers/notificationControllers.js";

const originalGetConnection = db.getConnection;
const uuid = "e531092e-4d22-4e1b-b909-e89d2c6ac3ea";
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

after(async () => {
  db.getConnection = originalGetConnection;
  cache.close();
  await db.end();
});

async function invoke({ notification = { link_uuid: uuid, link: null, is_read: 0 },
  announcement = { public_id: uuid, category: "General", author_department_id: null },
  role = "student", departmentId = 1, failLookup = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM notifications") && sql.includes("FOR UPDATE")) {
        return [[notification].filter(Boolean)];
      }
      if (sql.includes("FROM announcements")) {
        if (failLookup) throw new Error("database unavailable");
        return [[announcement].filter(Boolean)];
      }
      return [{ affectedRows: 1 }];
    },
  });
  const res = response();
  await openAnnouncementNotification({
    params: { notificationId: "12" },
    verifiedUser: { id: "recipient", role, department_id: departmentId },
  }, res);
  return { res, calls, committed, rolledBack };
}

test("opens an existing announcement and marks only the owner's notification read", async () => {
  const { res, calls, committed } = await invoke();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, announcementId: uuid });
  assert.equal(committed, true);
  assert.deepEqual(calls[0].params, ["12", "recipient"]);
  assert.match(calls.at(-1).sql, /UPDATE notifications SET is_read = 1/);
  assert.deepEqual(calls.at(-1).params, ["12", "recipient"]);
});

test("employers cannot open previously delivered General or Department announcement notifications", async () => {
  for (const category of ["General", "Department"]) {
    const { res, calls, committed } = await invoke({ role: "employer", announcement: { public_id: uuid, category, author_department_id: 1 } });
    assert.equal(res.statusCode, 403); assert.equal(res.body.state, "unavailable");
    assert.equal(calls.length, 0); assert.equal(committed, false);
  }
});

test("legacy numeric notification links resolve to the public UUID", async () => {
  const { res, calls } = await invoke({
    notification: { link_uuid: null, link: "7", is_read: 1 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.announcementId, uuid);
  assert.match(calls[1].sql, /WHERE a\.id = \?/);
  assert.deepEqual(calls[1].params, ["7"]);
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE notifications")), false);
});

test("a notification already removed by announcement deletion returns gone", async () => {
  const { res, calls, rolledBack } = await invoke({ notification: null });
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.state, "gone");
  assert.equal(rolledBack, true);
  assert.equal(calls.length, 1);
});

test("an orphan notification is deleted for its owner", async () => {
  const { res, calls, committed } = await invoke({ announcement: null });
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.state, "deleted");
  assert.equal(committed, true);
  const deletion = calls.find(({ sql }) => sql.includes("DELETE FROM notifications"));
  assert.deepEqual(deletion.params, ["12", "recipient"]);
});

test("lost department access does not delete the notification", async () => {
  const { res, calls, rolledBack } = await invoke({
    announcement: { public_id: uuid, category: "Department", author_department_id: 2 },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(rolledBack, true);
  assert.equal(calls.some(({ sql }) => sql.includes("DELETE FROM notifications")), false);
});

test("a lookup failure leaves the notification intact", async () => {
  const originalError = console.error;
  console.error = () => {};
  let outcome;
  try {
    outcome = await invoke({ failLookup: true });
  } finally {
    console.error = originalError;
  }
  const { res, calls, rolledBack } = outcome;
  assert.equal(res.statusCode, 500);
  assert.equal(rolledBack, true);
  assert.equal(calls.some(({ sql }) => sql.includes("DELETE FROM notifications")), false);
});
