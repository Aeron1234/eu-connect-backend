import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import cache from "../config/cache/cache.js";
import { uploadInternshipFile } from "../features/documents/controllers/fileControllers.js";
import { uploadFileToSearchedStudent } from "../features/users/controllers/searchedUserController.js";
import { saveSummaryReport } from "../features/summary-reports/controllers/summaryReportControllers.js";

const originalConnection = db.getConnection;
const originalStorage = supabase.storage.from;
const originalConsoleError = console.error;

beforeEach(() => { cache.flushAll(); console.error = () => {}; });
after(async () => {
  db.getConnection = originalConnection;
  supabase.storage.from = originalStorage;
  console.error = originalConsoleError;
  cache.close();
  await db.end();
});

const paragraphs = {
  organization_experience: "I worked with the team.", work_schedule: "Weekdays.",
  memorable_moment: "Completing a project.", difficulties_solutions: "Asking for guidance.",
};
const png = () => ({ mimetype: "image/png", originalname: "photo.png", size: 9,
  buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) });
const document = () => ({ mimetype: "application/pdf", originalname: "document.pdf", size: 4, buffer: Buffer.from("test") });
const cases = [
  ["student documents", uploadInternshipFile, () => ({ verifiedUser: { id: "student", role: "student" },
    body: { file_name: "Requirement", company_name: "Company", requirement_type_id: 1 }, file: document() })],
  ["employer certificates", uploadFileToSearchedStudent, () => ({ verifiedUser: { id: "employer", role: "employer" },
    params: { searchedUserId: "student" }, body: { file_name: "Certificate", company_name: "Company" }, file: document() })],
  ["summary images", saveSummaryReport, () => ({ method: "POST", verifiedUser: { id: "student", role: "student" },
    params: { internshipId: "internship" }, body: { ...paragraphs }, files: [png()] })],
];

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fixture(options = {}) {
  const state = { held: 0, acquisitions: 0, releases: 0, begins: 0, commits: 0, rollbacks: 0,
    calls: [], uploaded: [], removed: [], emitted: [], eligible: true, supervisor: "employer",
    existing: options.existing || null, images: options.images || [] };
  db.getConnection = async () => {
    state.acquisitions++;
    state.held++;
    let released = false;
    return {
      async beginTransaction() { state.begins++; },
      async commit() {
        if (options.commitError) throw new Error("Lost COMMIT acknowledgement");
        state.commits++;
      },
      async rollback() { state.rollbacks++; },
      release() {
        assert.equal(released, false, "release each connection exactly once");
        released = true;
        state.held--;
        state.releases++;
      },
      async execute(sql, params) {
        assert.equal(released, false, "never query a released connection");
        state.calls.push({ sql, params });
        if (sql.includes("FROM internship_records")) {
          if (!state.eligible) return [[]];
          if (sql.includes("FOR UPDATE") && params.length > 1 && !sql.includes("user_id = ? AND deleted_at")) {
            assert.ok(params.includes("internship"), "final document checks pin the original internship");
          }
          return [[{ id: "internship", employer_id: state.supervisor }]];
        }
        if (sql.includes("FROM requirement_types")) return [[{ id: 1, category: "post" }]];
        if (sql.includes("FROM user_profiles")) return [[{ first_name: "Test", last_name: "Person" }]];
        if (sql.includes("FROM summary_reports")) return [state.existing ? [state.existing] : []];
        if (sql.includes("FROM summary_report_images")) return [state.images];
        if (options.insertError && sql.includes("INSERT INTO internship_documents")) throw new Error("Insert failed");
        if (options.insertError && sql.includes("INSERT INTO summary_report_images")) throw new Error("Image insert failed");
        return [{ affectedRows: 1, insertId: 42 }];
      },
    };
  };
  supabase.storage.from = () => ({
    async upload(path) {
      assert.equal(state.held, 0, "storage upload must not reserve any database connection");
      state.uploaded.push(path);
      await options.onUpload?.(state);
      return { error: options.storageError || null };
    },
    async remove(paths) {
      assert.equal(state.held, 0, "storage cleanup must follow connection release");
      state.removed.push(...paths);
      if (options.cleanupError) throw new Error("Storage cleanup unavailable");
      return { error: null };
    },
  });
  state.app = { get: () => ({ to: (room) => ({ emit(event, payload) {
    assert.equal(state.commits, 1, "notify only after commit");
    assert.equal(state.held, 0, "notify after releasing the connection");
    if (options.socketError) throw new Error("Socket unavailable");
    state.emitted.push({ room, event, payload });
  } }) }) };
  return state;
}

test("all upload flows release preflight connections before storage and commit only database work", async () => {
  for (const [name, handler, request] of cases) {
    const state = fixture();
    const res = response();
    await handler({ ...request(), app: state.app }, res);
    assert.equal(res.statusCode, 201, name);
    assert.equal(state.acquisitions, 2, name);
    assert.equal(state.releases, 2, name);
    assert.equal(state.held, 0);
    assert.equal(state.begins, 1);
    assert.equal(state.commits, 1);
    assert.equal(state.removed.length, 0);
    assert.ok(state.calls.some(({ sql }) => sql.includes("FOR UPDATE")));
    if (handler === uploadFileToSearchedStudent) {
      assert.equal(state.emitted[0].payload.type, "certificate_uploaded");
      assert.equal(state.emitted[0].payload.link, 42);
    }
  }
});

test("internship eligibility is rechecked after storage completes and rejected uploads are cleaned up", async () => {
  for (const [name, handler, request] of cases) {
    const state = fixture({ onUpload: (current) => { current.eligible = false; } });
    const res = response();
    await handler({ ...request(), app: state.app }, res);
    assert.equal(res.statusCode, handler === uploadInternshipFile ? 403 : 404, name);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
    assert.deepEqual(state.removed, state.uploaded);
    assert.equal(state.held, 0);
    assert.equal(state.emitted.length, 0);
    assert.equal(state.calls.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
  }
});

test("removing the supervisor during upload blocks the employer's final save", async () => {
  const state = fixture({ onUpload: (current) => { current.supervisor = "another-employer"; } });
  const res = response();
  await uploadFileToSearchedStudent({ ...cases[1][2](), app: state.app }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(state.removed, state.uploaded);
  assert.equal(state.emitted.length, 0);
});

test("storage and insert failures release connections, clean staged objects, and do not notify", async () => {
  for (const options of [{ storageError: new Error("Upload failed") }, { insertError: true }]) {
    for (const [name, handler, request] of cases) {
      const state = fixture(options);
      const res = response();
      await handler({ ...request(), app: state.app }, res);
      assert.equal(res.statusCode, 500, name);
      assert.equal(state.held, 0);
      assert.equal(state.acquisitions, state.releases);
      assert.equal(state.commits, 0);
      assert.equal(state.emitted.length, 0);
      assert.deepEqual(state.removed, state.uploaded);
    }
  }
});

test("lost commit acknowledgements retain objects that may already be referenced by a saved record", async () => {
  for (const [name, handler, request] of cases) {
    const state = fixture({ commitError: true });
    const res = response();
    await handler({ ...request(), app: state.app }, res);
    assert.equal(res.statusCode, 500, name);
    assert.equal(state.held, 0);
    assert.equal(state.removed.length, 0);
    assert.equal(state.emitted.length, 0);
  }
});

test("a socket error after commit cannot remove an employer certificate or fail the completed upload", async () => {
  const state = fixture({ socketError: true });
  const res = response();
  await uploadFileToSearchedStudent({ ...cases[1][2](), app: state.app }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(state.commits, 1);
  assert.equal(state.removed.length, 0);
  assert.equal(state.rollbacks, 0);
});

test("a partial image upload failure cleans staged files without writing the summary", async () => {
  const state = fixture({ onUpload: (current) => {
    if (current.uploaded.length === 2) throw new Error("Second upload failed");
  } });
  const res = response();
  await saveSummaryReport({ ...cases[2][2](), files: [png(), png()] }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.acquisitions, 1);
  assert.deepEqual(state.removed, state.uploaded);
  assert.equal(state.commits, 0);
  assert.equal(state.calls.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
});

test("concurrent summary creation and image additions are revalidated before committing", async () => {
  for (const mode of ["duplicate", "full", "replaced"]) {
    const existing = mode === "duplicate" ? null : { id: "report", attachment_path: null };
    const state = fixture({ existing, onUpload: (current) => {
      if (mode === "duplicate") current.existing = { id: "other-report" };
      if (mode === "replaced") current.existing = { id: "replacement-report" };
      if (mode === "full") current.images = Array.from({ length: 6 }, (_, i) => ({ id: `image-${i}`, sort_order: i }));
    } });
    const res = response();
    await saveSummaryReport({ ...cases[2][2](), method: mode === "duplicate" ? "POST" : "PATCH" }, res);
    assert.equal(res.statusCode, mode === "full" ? 400 : 409);
    assert.equal(state.commits, 0);
    assert.deepEqual(state.removed, state.uploaded);
  }
});

test("text-only edits use one short transaction and remove old images after release", async () => {
  const state = fixture({ existing: { id: "report" }, images: [{ id: "image", storage_path: "old-photo.png", sort_order: 0 }] });
  const res = response();
  await saveSummaryReport({ ...cases[2][2](), method: "PATCH", files: [],
    body: { ...paragraphs, remove_image_ids: JSON.stringify(["image"]) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.acquisitions, 1);
  assert.equal(state.commits, 1);
  assert.deepEqual(state.removed, ["old-photo.png"]);
});

test("cleanup failure does not replace the original permission error", async () => {
  const state = fixture({ cleanupError: true, onUpload: (current) => { current.supervisor = "removed"; } });
  const res = response();
  await uploadFileToSearchedStudent({ ...cases[1][2](), app: state.app }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(state.held, 0);
});

test("15 slow uploads leave a ten-connection pool available for an unrelated read", { timeout: 5000 }, async () => {
  const state = fixture();
  const acquire = db.getConnection;
  let active = 0;
  const queue = [];
  db.getConnection = async () => {
    if (active >= 10) await new Promise((resolve) => queue.push(resolve));
    active++;
    const connection = await acquire();
    const release = connection.release.bind(connection);
    connection.release = () => {
      release(); active--;
      queue.shift()?.();
    };
    return connection;
  };
  let allowUploads;
  const waiting = new Promise((resolve) => { allowUploads = resolve; });
  let allUploading;
  const allStarted = new Promise((resolve) => { allUploading = resolve; });
  const paths = [];
  supabase.storage.from = () => ({ upload: async (path) => {
    paths.push(path);
    if (paths.length === 15) allUploading();
    await waiting;
    return { error: null };
  } });
  const jobs = Array.from({ length: 15 }, async () => {
    const res = response();
    await uploadInternshipFile(cases[0][2](), res);
    return res;
  });
  try {
    await allStarted;
    assert.equal(active, 0, "all uploads are waiting on storage with no reserved connections");
    const probe = await db.getConnection();
    await probe.execute("SELECT 1");
    probe.release();
    assert.equal(new Set(paths).size, 15, "concurrent files have distinct storage paths");
  } finally {
    allowUploads();
    const results = await Promise.all(jobs);
    assert.ok(results.every((res) => res.statusCode === 201));
  }
  assert.equal(active, 0);
  assert.equal(state.held, 0);
});
