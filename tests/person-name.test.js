import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCreatorPreparedBy, formatPersonName } from "../config/personName.js";

test("PDF names include the optional initial between first and last names", () => {
  assert.equal(formatPersonName("Jane", "a", "Cruz"), "Jane A. Cruz");
  assert.equal(formatPersonName("Jane", null, "Cruz"), "Jane Cruz");
});

test("Annex C leaves another signatory's prepared-by text unchanged", () => {
  assert.equal(formatCreatorPreparedBy("Maria Santos", "Jane", "A", "Cruz"), "Maria Santos");
  assert.equal(formatCreatorPreparedBy("Jane Cruzer", "Jane", "A", "Cruz"), "Jane Cruzer");
  assert.equal(formatCreatorPreparedBy("Jane Cruz", "Jane", null, "Cruz"), "Jane Cruz");
});
