import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

// This small support directory is separate from account administration. Only
// students and department heads receive active admins' published contact fields.
export async function getHelpAdminContacts(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (!["student", "department_head"].includes(req.verifiedUser?.role)) {
    return res.status(403).json({ error: "Administrator support contacts are not available for this role." });
  }
  try {
    const [rows] = await db.execute(
      `SELECT up.first_name, up.last_name, u.email, up.contact_number
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE r.role = 'admin' AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY up.first_name, up.last_name, u.id`,
    );
    const contacts = rows.flatMap(row => {
      const rawEmail = String(row.email ?? "").trim();
      const rawPhone = String(row.contact_number ?? "").trim();
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
      const contact_number = /^\+?[\d\s().-]{6,39}$/.test(rawPhone) && rawPhone.replace(/\D/g, "").length >= 7 ? rawPhone : null;
      if (!email && !contact_number) return [];
      return [{ name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "System administrator", email, contact_number }];
    });
    return res.json({ success: true, contacts });
  } catch (error) {
    reportError("Help administrator contacts read failed:", error);
    return res.status(500).json({ error: "Could not load administrator contacts. Please try again." });
  }
}
