import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
process.env.ACCESS_TOKEN_SECRET = "feedback-test-access";
process.env.REFRESH_TOKEN_SECRET = "feedback-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "feedback-test-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "test-key";
process.env.SUPABASE_BUCKET = "test-bucket";
const { db } = await import("../config/db.js");
const { supabase } = await import("../config/supabase.js");
const { signAccessToken } = await import("../config/jwt.js");
const { default: routes } = await import("../features/feedback/routes/feedbackRoutes.js");
const { default: cache } = await import("../config/cache/cache.js");
const originalConnection = db.getConnection;
const originalStorage = supabase.storage.from;
let server, base, databaseCalls = 0, storageCalls = 0;
before(async () => {
  db.getConnection = async () => {
    databaseCalls++;
    return { release() {}, async execute(sql, values) {
      if (sql.includes("FROM feedback_posts p") && values[1] === "owner") return [[{ id: values[0], author_id: "owner", status: "open" }]];
      if (sql.includes("SELECT storage_path")) return [[{ storage_path: "feedback/private/test.pdf", filename: "proof.pdf", mime_type: "application/pdf" }]];
      return [[]];
    } };
  };
  supabase.storage.from = () => ({ async createSignedUrl() { storageCalls++; return { data: { signedUrl: "https://example.supabase.co/private-signed" } }; } });
  const app = express(); app.use(express.json()); app.use("/api/v1", routes);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = "http://127.0.0.1:" + server.address().port + "/api/v1";
});
after(async () => {
  db.getConnection = originalConnection; supabase.storage.from = originalStorage;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  cache.close(); await db.end();
});
function auth(role, id = role) { return { Authorization: "Bearer " + signAccessToken({ id, role }) }; }
test("HTTP routes reject missing authentication and all student reads/writes before DB or storage", async () => {
  assert.equal((await fetch(base + "/feedback")).status, 401);
  for (const [method, path] of [
    ["GET","/feedback"], ["GET","/feedback/interns"], ["POST","/feedback"], ["GET","/feedback/post"],
    ["GET","/feedback/post/replies?before=reply"], ["POST","/feedback/post/replies"],
    ["PATCH","/feedback/post/status"], ["GET","/feedback/post/attachments/file"],
    ["PATCH","/feedback/post"], ["DELETE","/feedback/post"], ["PATCH","/feedback/post/replies/reply"], ["DELETE","/feedback/post/replies/reply"],
  ]) {
    const res = await fetch(base + path, { method, headers: { ...auth("student"), "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) });
    assert.equal(res.status, 403, method + " " + path);
  }
  assert.equal(databaseCalls, 0); assert.equal(storageCalls, 0);
});
test("attachment signing requires authorized access to the exact parent discussion", async () => {
  let res = await fetch(base + "/feedback/post/attachments/file", { headers: auth("employer", "outsider") });
  assert.equal(res.status, 404); assert.equal(storageCalls, 0);
  res = await fetch(base + "/feedback/post/attachments/file", { headers: auth("employer", "owner") });
  assert.equal(res.status, 200); assert.equal(storageCalls, 1);
  assert.match(res.headers.get("cache-control"), /private, no-store/);
  assert.equal((await res.json()).filename, "proof.pdf");
});
test("school roles cannot create employer posts", async () => {
  for (const role of ["department_head","admin"]) {
    const res = await fetch(base + "/feedback", { method: "POST", headers: { ...auth(role), "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403);
  }
});
test("multipart boundaries enforce attachment count and byte limits with JSON errors", async () => {
  for (const kind of ["count","size"]) {
    const form = new FormData();
    form.set("category", "platform_feedback"); form.set("subject", "Feedback"); form.set("description", "Description");
    for (let index = 0; index < (kind === "count" ? 4 : 1); index++) {
      form.append("attachments", new Blob([kind === "size" ? Buffer.alloc(5*1024*1024+1) : "%PDF-1.7"], { type: "application/pdf" }), "test.pdf");
    }
    const res = await fetch(base + "/feedback", { method: "POST", headers: auth("employer", "upload-" + kind), body: form });
    assert.equal(res.status, kind === "size" ? 413 : 400);
    const data = await res.json(); assert.equal(data.success, false); assert(data.error);
  }
  assert.equal(storageCalls, 1, "invalid uploads never reach storage");
});
