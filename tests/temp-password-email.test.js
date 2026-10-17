import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "react-email";
import { Resend } from "resend";
import TempPasswordEmail from "../emails/TempPasswordEmail.js";
import { LOGO_BASE64 } from "../config/emailAssets.js";

// Test delivery without contacting Resend or using application credentials.
process.env.RESEND_API_KEY = "re_test_only_no_delivery";
process.env.MAIL_FROM = "EU Connect <noreply@example.test>";
const { sendTempPasswordEmail } = await import("../services/mailer.js");
const { sendTempPasswordEmail: sendConfigEmail } = await import("../config/mailer.js");

test("temporary-password email retains its branding, instructions and default expiration", async () => {
  const html = await render(createElement(TempPasswordEmail, {
    username: "Demo Student", tempPassword: "TEST-ONLY-123",
  }));
  assert.ok(html.includes(LOGO_BASE64));
  assert.match(html, /MSEUF-CI Seal/);
  assert.match(html, /MANUEL S\. ENVERGA UNIVERSITY FOUNDATION - CANDELARIA, INC\./);
  assert.match(html, /Hi Demo Student/);
  assert.match(html, /TEST-ONLY-123/);
  assert.match(html, /expires in 10 minutes and can only be used once/);
  assert.match(html, /set a new password right after signing in/);
  assert.match(html, /max-width:480px/);
  assert.match(html, /#A30000/);
  assert.match(html, /#FAF6F0/);
  assert.match(html, /font-family:Georgia/);
});

test("email rendering escapes dynamic text and honors a custom expiration", async () => {
  const html = await render(createElement(TempPasswordEmail, {
    username: '<script>alert("test")</script> & classmate',
    tempPassword: "TEST-ONLY-<code>&123",
    expiresInMinutes: 15,
  }));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp; classmate"));
  assert.ok(html.includes("TEST-ONLY-&lt;code&gt;&amp;123"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("TEST-ONLY-<code>"));
  assert.match(html, /expires in 15 minutes/);
});

test("both mailer entry points render HTML and keep the existing Resend delivery payload", async (t) => {
  const post = t.mock.method(Resend.prototype, "post", async () => ({
    data: { id: "test-email" }, error: null,
  }));
  for (const send of [sendTempPasswordEmail, sendConfigEmail]) {
    await send({ to: "student@example.test", username: "Demo Student", tempPassword: "TEST-ONLY-456", expiresInMinutes: 12 });
  }
  assert.equal(post.mock.callCount(), 2);
  for (const { arguments: [path, payload] } of post.mock.calls) {
    assert.equal(path, "/emails");
    assert.equal(payload.from, process.env.MAIL_FROM);
    assert.equal(payload.to, "student@example.test");
    assert.equal(payload.subject, "Your temporary EU Connect password");
    assert.match(payload.html, /Hi Demo Student/);
    assert.match(payload.html, /TEST-ONLY-456/);
    assert.match(payload.html, /expires in 12 minutes/);
    assert.ok(payload.html.includes(LOGO_BASE64));
  }
});
