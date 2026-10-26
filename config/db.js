import mysql from "mysql2/promise"; // Promise-based query/execute APIs; no eager connection is awaited here
import dotenv from "dotenv";
dotenv.config();

export const db = mysql.createPool({
  // Create a process-local pool; callers acquire connections on demand.
  // At most ten connections are active, while queueLimit 0 leaves waiters uncapped.
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  timezone: "+08:00",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Apply SQL-session timezone/collation to each newly created pooled connection.
// The pool timezone option controls driver date conversion; SET time_zone controls
// SQL NOW()/date comparisons. Neither configures node-cron's host timezone.
db.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'");
  connection.query("SET collation_connection = 'utf8mb4_general_ci'");
});
