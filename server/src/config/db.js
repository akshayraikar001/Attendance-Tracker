import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});
export const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "attendance",
  password: process.env.DB_PASSWORD || "attendance_dev",
  database: process.env.DB_NAME || "attendance_tracker",
  dateStrings: true,
};
export const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
});
export async function query(sql, args = []) {
  const [rows] = await pool.execute(sql, args);
  return rows;
}
