import mysql from "mysql2/promise"; // Added /promise
import dotenv from "dotenv";
dotenv.config();

export const db = mysql.createPool({
  // Added await here
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
  port: 3307,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
