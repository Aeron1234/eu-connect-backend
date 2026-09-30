// Descriptions store a name snapshot; structured IDs remain authoritative.
export async function getActivityLogUserName(connection, userId) {
  try {
    const [rows] = await connection.execute(
      "SELECT first_name, last_name FROM user_profiles WHERE user_id = ? LIMIT 1",
      [userId],
    );
    const name = [rows[0]?.first_name, rows[0]?.last_name]
      .filter(part => typeof part === "string" && part.trim())
      .map(part => part.trim()).join(" ");
    return name || "User name unavailable";
  } catch (error) {
    // Name lookup is supplementary and must not fail the business operation.
    console.error("Activity log user-name lookup failed:", error);
    return "User name unavailable";
  }
}
