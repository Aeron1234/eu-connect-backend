import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getAverageShiftHoursByWeek } from "../controllers/dashboardController.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("attendance averages retain UTC Monday buckets, empty weeks and JavaScript float rounding", async () => {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  const rows = [
    { clock_in: new Date("2026-04-27T00:00:00.000Z"), total_hours: 0.005 },
    { clock_in: new Date("2026-05-04T00:00:00.000Z"), total_hours: 3.335 },
    { clock_in: new Date("2026-05-11T12:00:00.000Z"), total_hours: 2.5 },
    { clock_in: new Date("2026-05-17T23:59:59.999Z"), total_hours: 3.5 },
    { clock_in: new Date("2026-06-01T00:00:00.000Z"), total_hours: 999 },
  ];
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [rows]; },
  });
  try {
    const res = response();
    await getAverageShiftHoursByWeek({ verifiedUser: { department_id: 7 }, query: { month: "5", year: "2026" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      month: 5,
      year: 2026,
      weeks: [
        { week: "Week 1", startDate: "2026-04-27", endDate: "2026-05-03", hours: 0.01 },
        { week: "Week 2", startDate: "2026-05-04", endDate: "2026-05-10", hours: 3.33 },
        { week: "Week 3", startDate: "2026-05-11", endDate: "2026-05-17", hours: 3 },
        { week: "Week 4", startDate: "2026-05-18", endDate: "2026-05-24", hours: 0 },
        { week: "Week 5", startDate: "2026-05-25", endDate: "2026-05-31", hours: 0 },
      ],
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /SELECT dtr\.clock_in, dtr\.total_hours/);
    assert.deepEqual(calls[0].params, [7, new Date("2026-04-27T00:00:00.000Z"), new Date("2026-06-01T00:00:00.000Z")]);
    assert.equal(releases, 1);

    const denied = response();
    await getAverageShiftHoursByWeek({ verifiedUser: { department_id: null }, query: { month: "5", year: "2026" } }, denied);
    assert.equal(denied.statusCode, 400);
    assert.equal(calls.length, 1);
    assert.equal(releases, 2);
  } finally {
    db.getConnection = original;
  }
});
