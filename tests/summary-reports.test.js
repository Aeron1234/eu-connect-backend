import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { listSummaryReports, saveSummaryReport, deleteSummaryReport, getSummaryAttachment, getInternshipRecordSummaryReport, getInternshipRecordSummaryAttachment } from "../controllers/summaryReportControllers.js";

const originalGetConnection = db.getConnection;
const originalExecute = db.execute;
const originalStorageFrom = supabase.storage.from;

after(async () => {
  db.getConnection = originalGetConnection;
  db.execute = originalExecute;
  supabase.storage.from = originalStorageFrom;
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; return this; },
  };
}

const paragraphs = {
  organization_experience: "I learned how the company works.",
  work_schedule: "I worked each weekday.",
  memorable_moment: "I completed a team project.",
  difficulties_solutions: "I asked my mentor for help.",
};

function request(method = "POST", extras = {}) {
  return {
    method,
    verifiedUser: { id: "student-1", role: "student" },
    params: { internshipId: "internship-1" },
    body: { ...paragraphs },
    ...extras,
  };
}

function connection({ ownsRecord = true, existing = null, images = [] } = {}) {
  const calls = [];
  const instance = {
    calls,
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM internship_records")) return [ownsRecord ? [{ id: "internship-1" }] : []];
      if (sql.includes("FROM summary_report_images")) return [images];
      if (sql.includes("FROM summary_reports")) return [existing ? [existing] : []];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => instance;
  return instance;
}

test("report list is scoped to the authenticated student", async () => {
  let params;
  db.execute = async (_sql, args) => { params = args; return [[{ internship_id: "internship-1", report_id: null }]]; };
  const res = response();
  await listSummaryReports(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(params, ["student-1"]);
  assert.equal(res.body.records[0].report_id, null);
});

test("report list includes signed previews for saved images", async () => {
  db.execute = async (sql, args) => sql.includes("FROM summary_report_images")
    ? [[{ id: "image-1", report_id: "report-1", storage_path: "summary-reports/photo.png", original_name: "photo.png", mime_type: "image/png", sort_order: 0 }]]
    : [[{ internship_id: "internship-1", report_id: "report-1" }]];
  supabase.storage.from = () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/photo.png" }, error: null }) });
  const res = response();
  await listSummaryReports(request("GET"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.records[0].images[0].url, "https://example.test/photo.png");
  assert.equal(res.body.records[0].images[0].name, "photo.png");
  assert.equal("storage_path" in res.body.records[0].images[0], false);
});

test("a student cannot submit a report for someone else's internship", async () => {
  const tx = connection({ ownsRecord: false });
  const res = response();
  await saveSummaryReport(request(), res);
  assert.equal(res.statusCode, 404);
  assert.ok(tx.calls.includes("rollback"));
  assert.ok(!tx.calls.includes("commit"));
});

test("a second POST is rejected, while PATCH updates the same report", async () => {
  let tx = connection({ existing: { id: "report-1", attachment_path: null } });
  let res = response();
  await saveSummaryReport(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(tx.calls.filter((call) => typeof call === "object" && call.sql.includes("INSERT INTO summary_reports")).length, 0);

  tx = connection({ existing: { id: "report-1", attachment_path: null } });
  res = response();
  await saveSummaryReport(request("PATCH"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(tx.calls.includes("commit"));
  assert.equal(tx.calls.filter((call) => typeof call === "object" && call.sql.includes("UPDATE summary_reports")).length, 1);
});

test("multiple images are stored privately and linked to the same report", async () => {
  const tx = connection();
  const paths = [];
  supabase.storage.from = () => ({
    upload: async (storagePath) => { paths.push(storagePath); return { error: null }; },
    remove: async () => ({ error: null }),
  });
  const res = response();
  await saveSummaryReport(request("POST", { files: [
    { mimetype: "image/png", originalname: "photo.png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), size: 9 },
    { mimetype: "image/jpeg", originalname: "second.jpg", buffer: Buffer.from([255, 216, 255, 0]), size: 4 },
  ] }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /^summary-reports\/student-1\/internship-1\/.+\.png$/);
  assert.match(paths[1], /^summary-reports\/student-1\/internship-1\/.+\.jpg$/);
  const inserts = tx.calls.filter((call) => typeof call === "object" && call.sql.includes("INSERT INTO summary_report_images"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((item) => item.params[3]), ["photo.png", "second.jpg"]);
});

test("non-image uploads are rejected", async () => {
  const res = response();
  await saveSummaryReport(request("POST", { files: [{ mimetype: "application/pdf", originalname: "report.pdf", size: 5 }] }), res);
  assert.equal(res.statusCode, 400);
});

test("an edit can remove one saved image and retain the others", async () => {
  const removed = [];
  const tx = connection({ existing: { id: "report-1", attachment_path: null }, images: [
    { id: "image-1", storage_path: "summary-reports/one.png", sort_order: 0 },
    { id: "image-2", storage_path: "summary-reports/two.png", sort_order: 1 },
  ] });
  supabase.storage.from = () => ({ remove: async (paths) => { removed.push(...paths); return { error: null }; } });
  const res = response();
  await saveSummaryReport(request("PATCH", { body: { ...paragraphs, remove_image_ids: JSON.stringify(["image-1"]) } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(removed, ["summary-reports/one.png"]);
  const deletions = tx.calls.filter((call) => typeof call === "object" && call.sql.includes("DELETE FROM summary_report_images"));
  assert.deepEqual(deletions.map((call) => call.params), [["image-1", "report-1"]]);
});

test("a file renamed as an image is rejected by its content signature", async () => {
  const res = response();
  await saveSummaryReport(request("POST", { files: [{ mimetype: "image/png", originalname: "fake.png", buffer: Buffer.from("not an image"), size: 12 }] }), res);
  assert.equal(res.statusCode, 400);
});

test("attachment links require ownership of the internship", async () => {
  let params;
  db.execute = async (_sql, args) => { params = args; return [[]]; };
  const res = response();
  await getSummaryAttachment(request("GET"), res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(params, ["internship-1", "student-1"]);
});

test("deletion checks ownership, removes the row, then cleans up the attachment", async () => {
  let committed = false;
  const removed = [];
  const tx = connection({ existing: { id: "report-1", attachment_path: "summary-reports/legacy.pdf" }, images: [{ storage_path: "summary-reports/photo.png" }] });
  tx.commit = async () => { committed = true; tx.calls.push("commit"); };
  supabase.storage.from = () => ({ remove: async (paths) => {
    assert.ok(committed, "storage cleanup must follow the database commit");
    removed.push(...paths);
    return { error: null };
  } });
  const res = response();
  await deleteSummaryReport(request("DELETE"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(removed, ["summary-reports/legacy.pdf", "summary-reports/photo.png"]);
  const deletion = tx.calls.find((call) => typeof call === "object" && call.sql.includes("DELETE FROM summary_reports"));
  assert.deepEqual(deletion.params, ["report-1", "student-1"]);

  connection({ existing: null });
  const missing = response();
  await deleteSummaryReport(request("DELETE"), missing);
  assert.equal(missing.statusCode, 404);
});

test("admin can read a submitted report for an accessible internship record", async () => {
  const calls = [];
  db.getConnection = async () => ({
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM internship_records ir")) return [[{ id: "internship-1", deleted_at: null, department_id: "dept-1" }]];
      if (sql.includes("FROM summary_report_images")) return [[]];
      return [[{ report_id: "report-1", organization_experience: "Internship work" }]];
    },
  });
  const res = response();
  await getInternshipRecordSummaryReport(request("GET", { verifiedUser: { id: "admin-1", role: "admin" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report.report_id, "report-1");
  assert.deepEqual(calls.find((call) => call.sql.includes("FROM summary_reports sr")).params, ["internship-1"]);
});

test("department head cannot read a report outside their department", async () => {
  let reportRead = false;
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      if (sql.includes("FROM internship_records ir")) return [[{ id: "internship-1", deleted_at: null, department_id: "dept-1" }]];
      if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: "dept-2" }]];
      reportRead = true;
      return [[]];
    },
  });
  const req = request("GET", { verifiedUser: { id: "head-1", role: "department_head" } });
  const res = response();
  await getInternshipRecordSummaryReport(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(reportRead, false);

  const attachment = response();
  await getInternshipRecordSummaryAttachment(req, attachment);
  assert.equal(attachment.statusCode, 403);
});
