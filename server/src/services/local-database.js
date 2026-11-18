import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { config, query } from "../config/db.js";
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));
let recovering;

export async function startLocalDatabaseMonitor() {
  if (process.env.DB_LOCAL_MANAGED !== "true") return;
  if (
    !["127.0.0.1", "localhost"].includes(config.host) ||
    config.port !== 3307 ||
    config.database !== "attendance_tracker"
  ) {
    throw new Error(
      "DB_LOCAL_MANAGED requires the local attendance_tracker database on port 3307.",
    );
  }
  async function ensureRunning() {
    if (recovering) return recovering;
    recovering = (async () => {
      try {
        await query("SELECT 1");
      } catch (error) {
        if (
          ![
            "ECONNREFUSED",
            "ENOENT",
            "PROTOCOL_CONNECTION_LOST",
            "ECONNRESET",
          ].includes(error.code)
        )
          throw error;
        console.log("Starting the local attendance database…");
        await execute("bash", ["scripts/local-db.sh"], {
          cwd: root,
          timeout: 45000,
        });
        await query("SELECT 1");
        console.log("Local attendance database is ready.");
      }
    })().finally(() => {
      recovering = undefined;
    });
    return recovering;
  }
  await ensureRunning();
  // Idempotent schema setup preserves all existing attendance and accounts.
  await execute(process.execPath, ["server/src/database/setup.js"], {
    cwd: root,
    timeout: 45000,
  });
  const timer = setInterval(() => {
    ensureRunning().catch((error) =>
      console.error(
        "Local database recovery failed:",
        error.code || error.message,
      ),
    );
  }, 5000);
  timer.unref();
}
