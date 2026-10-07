// Explicit recovery check for the managed internal workspace. Briefly stops MariaDB.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { query, pool, config } from "../../server/src/config/db.js";
const execute = promisify(execFile);
assert.equal(process.env.DB_LOCAL_MANAGED, "true");
assert.equal(config.port, 3307);
assert.equal(config.database, "attendance_tracker");
async function snapshot() {
  const data = {};
  for (const table of [
    "employees",
    "attendance",
    "settings",
    "holidays",
    "audit",
    "users",
  ]) {
    const rows = await query("SELECT * FROM " + table + " ORDER BY id");
    data[table] = {
      count: rows.length,
      hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return data;
}
try {
  const before = await snapshot();
  const pidBefore = (await execute("cat", [".local/mysql.pid"])).stdout.trim();
  await execute("mysqladmin", [
    "--socket=" + process.cwd() + "/.local/mysql.sock",
    "-uroot",
    "shutdown",
  ]);
  let recovered = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetch("http://127.0.0.1:3001/api/health");
      if (response.ok) {
        recovered = true;
        break;
      }
    } catch {}
  }
  assert.ok(recovered, "Database must automatically recover within 30 seconds");
  const pidAfter = (await execute("cat", [".local/mysql.pid"])).stdout.trim();
  assert.notEqual(pidAfter, pidBefore);
  assert.deepEqual(await snapshot(), before);
  console.log(
    "PASS: local database automatically restarted; all workspace records unchanged.",
  );
  console.log(
    Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])),
  );
} finally {
  await pool.end();
}
