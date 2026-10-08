import { readFileSync } from "node:fs";
import { db } from "../config/db.js";

try {
  const sql = readFileSync(new URL("../docs/error-tracking.sql", import.meta.url), "utf8");
  await db.query(sql);
  const [tables] = await db.query("SHOW TABLES LIKE 'error_events'");
  if (tables.length !== 1) throw new Error("error_events table was not created");
  console.log("error_events table is ready");
} finally {
  await db.end();
}
