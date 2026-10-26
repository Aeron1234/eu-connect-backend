// Descriptions store a name snapshot; structured IDs remain authoritative.
export function formatActivityLogUserName(profile, fallback = "User name unavailable") {
  return [profile?.first_name, profile?.last_name]
    .filter(part => typeof part === "string" && part.trim())
    .map(part => part.trim()).join(" ") || fallback;
}

export async function getActivityLogUserName(connection, userId) {
  try {
    const [rows] = await connection.execute(
      "SELECT first_name, last_name FROM user_profiles WHERE user_id = ? LIMIT 1",
      [userId],
    );
    return formatActivityLogUserName(rows[0]);
  } catch (error) {
    console.error("Activity log user-name lookup failed:", error);
    return "User name unavailable";
  }
}
