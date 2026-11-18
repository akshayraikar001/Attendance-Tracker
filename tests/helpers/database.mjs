import { existsSync } from "node:fs";
import mysql from "mysql2/promise";

// Test databases are disposable; never derive their names from the live .env.
export const testDatabaseHost = process.env.TEST_DB_HOST || "127.0.0.1";
export const testDatabasePort = Number(process.env.TEST_DB_PORT || 3307);
export async function connectTestAdmin() {
  const socket =
    process.env.TEST_DB_SOCKET || process.cwd() + "/.local/mysql.sock";
  const useSocket =
    process.env.TEST_DB_SOCKET ||
    (!process.env.TEST_DB_HOST &&
      !process.env.TEST_DB_PORT &&
      existsSync(socket));
  return mysql.createConnection({
    ...(useSocket
      ? { socketPath: socket }
      : {
          host: testDatabaseHost,
          port: testDatabasePort,
        }),
    user: process.env.TEST_DB_ADMIN_USER || "root",
    password: process.env.TEST_DB_ADMIN_PASSWORD || "",
    connectTimeout: 5000,
  });
}
