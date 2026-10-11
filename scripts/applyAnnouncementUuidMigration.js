import { randomUUID } from "node:crypto";
import { db } from "../config/db.js";

// Run before deploying code that reads announcements.public_id. The existing
// numeric primary key stays in place for internal references and old links.
async function migrate() {
  const [columns] = await db.query("SHOW COLUMNS FROM announcements LIKE 'public_id'");
  if (columns.length === 0) {
    await db.query("ALTER TABLE announcements ADD COLUMN public_id CHAR(36) NULL AFTER id");
  }

  const [missingRows] = await db.query(
    "SELECT id FROM announcements WHERE public_id IS NULL OR public_id = ''",
  );
  for (const { id } of missingRows) {
    await db.execute(
      "UPDATE announcements SET public_id = ? WHERE id = ? AND (public_id IS NULL OR public_id = '')",
      [randomUUID(), id],
    );
  }

  const [[{ missing }]] = await db.query(
    "SELECT COUNT(*) AS missing FROM announcements WHERE public_id IS NULL OR public_id = ''",
  );
  if (Number(missing) !== 0) throw new Error("Some announcements still lack a UUID.");

  const [indexes] = await db.query(
    "SHOW INDEX FROM announcements WHERE Key_name = 'announcements_public_id_unique'",
  );
  if (indexes.length === 0) {
    await db.query(
      "ALTER TABLE announcements ADD UNIQUE KEY announcements_public_id_unique (public_id)",
    );
  }
  await db.query("ALTER TABLE announcements MODIFY public_id CHAR(36) NOT NULL");

  // Notifications created before this migration store the numeric key in link.
  // Keep that key for older clients, but give current clients the UUID link.
  const [notifications] = await db.query(
    `UPDATE notifications n
       JOIN announcements a ON n.link = a.id
       SET n.link_uuid = a.public_id
     WHERE n.type = 'announcement'
       AND (n.link_uuid IS NULL OR n.link_uuid = '')`,
  );
  console.log(
    `Announcement UUID migration complete: ${missingRows.length} posts backfilled, ${notifications.affectedRows} notification links updated.`,
  );
}

try {
  await migrate();
} catch (error) {
  console.error("Announcement UUID migration failed:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
