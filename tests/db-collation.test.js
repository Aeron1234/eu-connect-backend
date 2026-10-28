import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";

after(() => db.end());

test("database handshake and session use the same utf8mb4 collation without opening a connection", () => {
  // Protocol collation ID 45 is utf8mb4_general_ci. mysql2 otherwise defaults
  // to unicode_ci, despite the separate session SET performed by this app.
  assert.equal(db.pool.config.connectionConfig.charsetNumber, 45);
  const commands = [];
  db.pool.emit("connection", { query(sql) { commands.push(sql); } });
  assert.deepEqual(commands, [
    "SET time_zone = '+08:00'",
    "SET collation_connection = 'utf8mb4_general_ci'",
  ]);
});
