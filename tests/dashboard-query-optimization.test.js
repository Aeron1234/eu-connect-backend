import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getDepartmentHeadDashboardStats } from "../controllers/dashboardController.js";

test("department statistics use one internship scan without changing response values", async () => {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM internship_records ir")) {
        return [[{ total_count: 9, ongoing_count: 3, pending_count: 2 }]];
      }
      if (sql.includes("FROM alumni_internship_records")) return [[{ count: 4 }]];
      if (sql.includes("FROM notifications")) return [[{ count: 5 }]];
      throw new Error("Unexpected query");
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getDepartmentHeadDashboardStats(
      { verifiedUser: { id: 41, department_id: 7 } }, res,
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      stats: {
        ongoingInternships: 3,
        internshipRecords: 13,
        pendingResponses: 2,
        unreadAnnouncements: 5,
      },
    });
    assert.equal(calls.length, 3);
    const internships = calls.filter(({ sql }) => sql.includes("FROM internship_records ir"));
    assert.equal(internships.length, 1);
    assert.deepEqual(internships[0].params, [7]);
    assert.match(internships[0].sql, /COUNT\(CASE WHEN ir\.status = 'ongoing'/);
    assert.match(internships[0].sql, /COUNT\(CASE WHEN ir\.status = 'pending'/);
    assert.equal(releases, 1);
  } finally {
    db.getConnection = original;
  }
});
