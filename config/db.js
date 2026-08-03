import mysql from "mysql2/promise"; // Added /promise
import dotenv from "dotenv";
dotenv.config();

export const db = mysql.createPool({
  // Added await here
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  timezone: "+08:00",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'");
  connection.query("SET collation_connection = 'utf8mb4_general_ci'");
});
