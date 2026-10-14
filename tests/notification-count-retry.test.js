import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getUnreadNotificationCount } from "../controllers/notificationControllers.js";

test("unread notification count retries a reset read on a new connection", async () => {
  const original = db.getConnection;
  let acquired = 0;
  let released = 0;
  db.getConnection = async () => {
    const attempt = ++acquired;
    return {
      release() { released++; },
      async execute(sql, params) {
        assert.match(sql, /FROM notifications WHERE user_id = \? AND is_read = 0/);
        assert.deepEqual(params, ["student"]);
        if (attempt === 1) {
          const error = new Error("read ECONNRESET");
          error.code = "ECONNRESET";
          throw error;
        }
        return [[{ unread_count: 3 }]];
      },
    };
  };
  try {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await getUnreadNotificationCount({ verifiedUser: { id: "student" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { unreadCount: 3 });
    assert.equal(acquired, 2);
    assert.equal(released, 2);
  } finally {
    db.getConnection = original;
  }
});
