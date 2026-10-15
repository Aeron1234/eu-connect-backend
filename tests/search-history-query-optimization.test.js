import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getSearchHistory } from "../features/search-history/controllers/searchHistoryController.js";

const original = db.getConnection;
after(async () => { db.getConnection = original; await db.end(); });

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("recent history retains its fields, viewer/type filter, and ordering", async () => {
  const history = [{
    history_id: 10, type: "user", searched_uuid: "target", searched_id: null,
    updated_at: "2026-09-01", first_name: "Pat", last_name: "Lee", avatar: null,
    role: "student", course: "BSIT", company_name: "Company", department: "Computing",
    hours_rendered: 20, total_hours: 100,
  }];
  const calls = [];
  let answer = history;
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [answer]; },
  });
  const res = response();
  await getSearchHistory({ verifiedUser: { id: "viewer" }, query: { type: "user" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, history });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ["viewer", "user"]);
  assert.match(calls[0].sql, /MAX\(sai_latest\.id\)/);
  assert.match(calls[0].sql, /WHERE sai_latest\.user_id = up\.user_id/);
  assert.doesNotMatch(calls[0].sql, /GROUP BY user_id/);
  assert.match(calls[0].sql, /ORDER BY sh\.updated_at DESC\s+LIMIT 10/);
  assert.equal(releases, 1);

  answer = [];
  const empty = response();
  await getSearchHistory({ verifiedUser: { id: "viewer" }, query: { type: "document" } }, empty);
  assert.deepEqual(empty.body, { success: true, history: [] });
  assert.deepEqual(calls[1].params, ["viewer", "document"]);
  assert.equal(releases, 2);
});

test("history rejects missing identity and type before acquiring a connection", async () => {
  let acquisitions = 0;
  db.getConnection = async () => { acquisitions++; throw new Error("Unexpected connection"); };
  const missingIdentity = response();
  await getSearchHistory({ verifiedUser: {}, query: { type: "user" } }, missingIdentity);
  assert.equal(missingIdentity.statusCode, 401);
  const missingType = response();
  await getSearchHistory({ verifiedUser: { id: "viewer" }, query: {} }, missingType);
  assert.equal(missingType.statusCode, 400);
  assert.equal(acquisitions, 0);
});
