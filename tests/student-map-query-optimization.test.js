import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { db } from "../config/db.js";
import { getStudentMap } from "../features/map/controllers/mapControllers.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("student map streams joined rows into the same ordered location and region groups", async () => {
  const original = db.getConnection;
  let sql, highWaterMark, releases = 0;
  const rows = [
    { id: "i1", company_name: "Acme", company_address: "First", internship_position: "Dev",
      lat: "14.123456", lon: "121.000001", date_started: "start1", date_ended: null,
      total_hours: "100", accumulated_hours: "40", user_id: "u1", region_id: 2,
      first_name: "Ana", last_name: "Reyes", course_name: "Information Technology", course_short_name: "BSIT", region_name: "Zulu" },
    { id: "i2", company_name: " acme ", company_address: "Second", internship_position: "QA",
      lat: "14.123457", lon: "121.000002", date_started: "start2", date_ended: "end2",
      total_hours: "0", accumulated_hours: "8", user_id: "u2", region_id: 2,
      first_name: "Bo", last_name: "Cruz", course_name: "Computer Science", course_short_name: "BSCS", region_name: "Zulu" },
    { id: "i3", company_name: "Beta", company_address: "Third", internship_position: "Ops",
      lat: "15", lon: "122", date_started: "start3", date_ended: null,
      total_hours: "60", accumulated_hours: "30", user_id: "u3", region_id: 1,
      first_name: "Cy", last_name: "Lim", course_name: "Information Technology", course_short_name: "BSIT", region_name: "Alpha" },
  ];
  db.getConnection = async () => ({
    release() { releases++; },
    connection: { execute(query) { sql = query; return { stream(options) {
      highWaterMark = options.highWaterMark;
      return Readable.from(rows);
    } }; } },
  });
  try {
    const res = response();
    await getStudentMap({ verifiedUser: { role: "admin" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(highWaterMark, 64);
    assert.match(sql, /SELECT sai1\.user_id, sai1\.course_id/);
    assert.match(sql, /c\.short_name AS course_short_name/);
    assert.doesNotMatch(sql, /SELECT sai1\.\*/);
    assert.match(sql, /WHERE ir\.status = 'ongoing' AND ir\.deleted_at IS NULL/);
    assert.match(sql, /ORDER BY ir\.company_name ASC/);
    assert.deepEqual(res.body, {
      companies: [
        { company_name: "Acme", company_address: "First", lat: "14.123456", lon: "121.000001",
          region_id: 2, region_name: "Zulu", intern_count: 2, interns: [
            { internship_id: "i1", student_id: "u1", name: "Ana Reyes", position: "Dev", course: "Information Technology", course_short_name: "BSIT",
              percent_complete: 40, date_started: "start1", date_ended: null },
            { internship_id: "i2", student_id: "u2", name: "Bo Cruz", position: "QA", course: "Computer Science", course_short_name: "BSCS",
              percent_complete: 0, date_started: "start2", date_ended: "end2" },
          ] },
        { company_name: "Beta", company_address: "Third", lat: "15", lon: "122",
          region_id: 1, region_name: "Alpha", intern_count: 1, interns: [
            { internship_id: "i3", student_id: "u3", name: "Cy Lim", position: "Ops", course: "Information Technology", course_short_name: "BSIT",
              percent_complete: 50, date_started: "start3", date_ended: null },
          ] },
      ],
      availableRegions: [{ id: 1, name: "Alpha" }, { id: 2, name: "Zulu" }],
    });
    assert.equal(releases, 1);

    const denied = response();
    await getStudentMap({ verifiedUser: { role: "student" } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(releases, 1);
  } finally {
    db.getConnection = original;
  }
});

test("student map streaming errors return 500 without partial JSON and release connection", async () => {
  const original = db.getConnection;
  const originalError = console.error;
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    connection: { execute() { return { stream() { return Readable.from((async function* () {
      yield { company_name: "Acme", lat: 14, lon: 121, region_id: null, total_hours: 1, accumulated_hours: 0 };
      throw new Error("database stream failed");
    })()); } }; } },
  });
  console.error = () => {};
  try {
    const res = response();
    await getStudentMap({ verifiedUser: { role: "department_head" } }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "Failed to load student map data." });
    assert.equal(releases, 1);
  } finally {
    console.error = originalError;
    db.getConnection = original;
  }
});
