import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { searchUsers } from "../features/search-history/controllers/searchHistoryController.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("user search matches full names as well as name parts and companies", async () => {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  const users = [{ user_id: "u-1", first_name: "Ana", last_name: "Reyes", avatar: null,
    role: "student", course: "IT", company_name: "Acme", department: "Computing",
    hours_rendered: 12, total_hours: 100 }];
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [users]; },
  });
  try {
    const invalid = response();
    await searchUsers({ query: { q: "  " } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls.length, 0);

    const res = response();
    await searchUsers({ query: { q: "  Ana  " } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, users });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, Array(5).fill("%Ana%"));
    assert.match(calls[0].sql, /SELECT sai1\.user_id, sai1\.course_id, sai1\.department_id/);
    assert.match(calls[0].sql, /MAX\(id\) AS max_id/);
    assert.match(calls[0].sql, /up\.first_name LIKE \?\s+OR up\.last_name LIKE \?\s+OR CONCAT_WS\(' ', up\.first_name, up\.last_name\) LIKE \?\s+OR ir\.company_name LIKE \?\s+OR ebi\.company_name LIKE \?/);
    assert.match(calls[0].sql, /LIMIT 10/);

    const fullName = response();
    await searchUsers({ query: { q: "  Antonio   Pascual  " } }, fullName);
    assert.equal(fullName.statusCode, 200);
    assert.deepEqual(calls[1].params, Array(5).fill("%Antonio Pascual%"));
    assert.equal(releases, 2);
  } finally {
    db.getConnection = original;
  }
});
