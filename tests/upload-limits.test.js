import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import express from "express";
import {
  acceptDocumentUpload,
  acceptCertificateUpload,
  acceptSummaryImages,
} from "../middleware/multipart-uploads.js";

process.env.ACCESS_TOKEN_SECRET = "upload-limit-test-access";
process.env.REFRESH_TOKEN_SECRET = "upload-limit-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "upload-limit-test-temp";

const { signAccessToken } = await import("../config/jwt.js");
const { db } = await import("../config/db.js");
const { default: fileRoutes } = await import("../features/documents/routes/fileRoutes.js");
const { default: searchedUserRoutes } = await import("../features/users/routes/searchedUserRoutes.js");
const { default: summaryReportRoutes } = await import("../features/summary-reports/routes/summaryReportRoutes.js");

after(() => db.end());

const MB = 1024 * 1024;
const chunk = Buffer.alloc(64 * 1024, "x");
const file = (size, name = "file") => ({ name, size, filename: "document.pdf", type: "application/pdf" });

async function serve(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return server.address().port;
}

// Stream test payloads so a 50 MB boundary check doesn't also require a
// 50 MB client-side fixture or a database/storage connection.
function send(port, path, parts, { token, method = "POST" } = {}) {
  const boundary = "upload-limit-test-boundary";
  function* multipart() {
    for (const part of parts) {
      const fileHeader = part.filename ? `; filename="${part.filename}"\r\nContent-Type: ${part.type}` : "";
      yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${fileHeader}\r\n\r\n`);
      if (part.filename) {
        let remaining = part.size;
        while (remaining > 0) {
          const length = Math.min(remaining, chunk.length);
          yield chunk.subarray(0, length);
          remaining -= length;
        }
      } else {
        yield Buffer.from(part.value);
      }
      yield Buffer.from("\r\n");
    }
    yield Buffer.from(`--${boundary}--\r\n`);
  }
  return rawRequest(port, path, Readable.from(multipart()), {
    method,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function rawRequest(port, path, stream, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, ...options }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (data) => { text += data; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    stream.on("error", reject);
    stream.pipe(req);
  });
}

async function parserApp(t, parser) {
  let calls = 0;
  const app = express();
  app.post("/upload", parser, (req, res) => {
    calls++;
    const files = req.files || (req.file ? [req.file] : []);
    res.json({ fields: req.body, sizes: files.map((item) => item.buffer.length) });
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  return { port: await serve(t, app), calls: () => calls };
}

test("documents and certificates accept the exact existing size limit and reject one byte over before the handler", async (t) => {
  for (const [parser, maximum, label] of [
    [acceptDocumentUpload, 10 * MB, "10MB"],
    [acceptCertificateUpload, 50 * MB, "50MB"],
  ]) {
    const app = await parserApp(t, parser);
    const accepted = await send(app.port, "/upload", [{ name: "file_name", value: "My document" }, file(maximum)]);
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.sizes, [maximum]);
    assert.equal(accepted.body.fields.file_name, "My document");
    const rejected = await send(app.port, "/upload", [file(maximum + 1)]);
    assert.equal(rejected.status, 413);
    assert.equal(rejected.body.success, false);
    assert.ok(rejected.body.error.includes(label));
    assert.equal(app.calls(), 1, "oversized file must not reach the handler");
  }
});

test("single-file uploads reject duplicate files and unexpected file fields", async (t) => {
  for (const parser of [acceptDocumentUpload, acceptCertificateUpload]) {
    const app = await parserApp(t, parser);
    for (const parts of [[file(10), file(10)], [file(10, "unexpected")]]) {
      const result = await send(app.port, "/upload", parts);
      assert.equal(result.status, 400);
      assert.equal(result.body.success, false);
      assert.match(result.body.error, /one file/i);
    }
    assert.equal(app.calls(), 0);
  }
});

test("summary uploads allow six images, enforce 5 MB per image, and allow text-only edits", async (t) => {
  const app = await parserApp(t, acceptSummaryImages);
  const accepted = await send(app.port, "/upload", [file(5 * MB, "images"), ...Array.from({ length: 5 }, () => file(10, "images"))]);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.sizes.length, 6);
  assert.equal(accepted.body.sizes[0], 5 * MB);
  const oversized = await send(app.port, "/upload", [file(5 * MB + 1, "images")]);
  assert.equal(oversized.status, 413);
  assert.match(oversized.body.error, /5 MB/);
  const tooMany = await send(app.port, "/upload", Array.from({ length: 7 }, () => file(10, "images")));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /six/);
  const textOnly = await send(app.port, "/upload", [{ name: "organization_experience", value: "My experience." }]);
  assert.equal(textOnly.status, 200);
  assert.deepEqual(textOnly.body.sizes, []);
  assert.equal(app.calls(), 2);
});

test("excessive text fields, oversized field values, and malformed multipart bodies are validation errors", async (t) => {
  const app = await parserApp(t, acceptDocumentUpload);
  const count = await send(app.port, "/upload", Array.from({ length: 51 }, (_, i) => ({ name: `field${i}`, value: "value" })));
  assert.equal(count.status, 400);
  const size = await send(app.port, "/upload", [{ name: "file_name", value: "x".repeat(MB + 1) }]);
  assert.equal(size.status, 413);
  const malformed = await rawRequest(app.port, "/upload", Readable.from(["--broken\r\n"]), {
    method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.success, false);
  assert.equal(app.calls(), 0);
});

test("real upload routes reject bad payloads before database/storage work and retain authorization", async (t) => {
  const original = db.getConnection;
  let connections = 0;
  db.getConnection = async () => {
    connections++;
    throw new Error("Upload handler must not acquire a connection for rejected files");
  };
  t.after(() => { db.getConnection = original; });
  const app = express();
  app.use(fileRoutes, searchedUserRoutes, summaryReportRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const port = await serve(t, app);
  const student = signAccessToken({ id: "upload-limit-student", role: "student" });
  const employer = signAccessToken({ id: "upload-limit-employer", role: "employer" });
  for (const [path, token, maximum, field, method] of [
    ["/internships/files/new", student, 10 * MB, "file", "POST"],
    ["/searched-user/files/student", employer, 50 * MB, "file", "POST"],
    ["/summary-reports/internship", student, 5 * MB, "images", "POST"],
    ["/summary-reports/internship", student, 5 * MB, "images", "PATCH"],
  ]) {
    const result = await send(port, path, [file(maximum + 1, field)], { token, method });
    assert.equal(result.status, 413, `${method} ${path}`);
    assert.equal(result.body.success, false);
  }
  const unauthorized = await send(port, "/internships/files/new", [file(10)]);
  assert.equal(unauthorized.status, 401);
  const forbidden = await send(port, "/internships/files/new", [file(10)], { token: employer });
  assert.equal(forbidden.status, 403);
  assert.equal(connections, 0);
});
