import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import { createAutoClockOut } from "../../server/src/services/auto-clockout.js";
import { defaults } from "../../server/src/services/rules.js";
import { recalculateAttendance } from "../../server/src/services/recalculate.js";
const admin = await mysql.createConnection({
  socketPath: process.cwd() + "/.local/mysql.sock",
  user: "root",
});
const database = "attendance_automation_test_" + Date.now();
let pool;
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,REFERENCES ON \`${database}\`.* TO 'attendance'@'%'`,
  );
  const setup = spawnSync(process.execPath, ["server/src/database/setup.js"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DB_HOST: "127.0.0.1",
      DB_PORT: "3307",
      DB_USER: "attendance",
      DB_PASSWORD: "attendance_dev",
      DB_NAME: database,
    },
  });
  assert.equal(setup.status, 0, setup.stderr);
  pool = mysql.createPool({
    host: "127.0.0.1",
    port: 3307,
    user: "attendance",
    password: "attendance_dev",
    database,
    dateStrings: true,
  });
  const query = async (sql, args = []) => (await pool.execute(sql, args))[0];
  const transaction = async (fn) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const r = await fn(c);
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  };
  const audit = async (c, action, entity, id, details) =>
    c.execute(
      "INSERT INTO audit (action,entity,entityId,details) VALUES (?,?,?,?)",
      [action, entity, id, JSON.stringify(details)],
    );
  let clock = Date.parse("2026-10-07T14:29:00Z"); // 7:59 PM India
  const run = createAutoClockOut({ transaction, audit, now: () => clock });
  const settings = {
    ...defaults,
    shiftStart: "10:00",
    shiftEnd: "19:00",
    attendanceTimeZone: "Asia/Kolkata",
    breakDeductionEnabled: false,
  };
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify(settings),
  ]);
  for (let id = 1; id <= 7; id++)
    await query(
      "INSERT INTO employees (id,name,department,role,status) VALUES (?,?,'Sales','Staff','Active')",
      [id, "Employee " + id],
    );
  const insert = async (
    id,
    date,
    inTime,
    outTime = null,
    mode = "time",
    overnight = 0,
  ) =>
    query(
      "INSERT INTO attendance (employeeId,date,inTime,outTime,mode,overnight,status,notes,rules) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        date,
        inTime,
        outTime,
        mode,
        overnight,
        mode === "manual" ? "Half day" : "In progress",
        "Original note",
        JSON.stringify(settings),
      ],
    );
  await insert(1, "2026-10-07", "10:00");
  await insert(2, "2026-10-07", "10:00", "18:45");
  await insert(3, "2026-10-07", null, null, "manual");
  await insert(4, "2026-10-07", "19:30");
  await insert(5, "2026-10-07", "18:00", null, "time", 1);
  await insert(6, "2026-10-06", "10:00");
  assert.equal((await run()).total, 0);
  clock = Date.parse("2026-10-07T14:30:00Z");
  const results = await Promise.all([run(), run()]);
  assert.equal(
    results.filter(Boolean).reduce((n, r) => n + r.total, 0),
    1,
  );
  let first = (await query("SELECT * FROM attendance WHERE employeeId=1"))[0];
  assert.equal(first.outTime, "19:05");
  assert.equal(first.workedMinutes, 545);
  assert.match(first.notes, /Original note\nAuto Out time/);
  assert.equal(
    (await query("SELECT outTime FROM attendance WHERE employeeId=2"))[0]
      .outTime,
    "18:45",
  );
  assert.equal(
    (
      await query("SELECT COUNT(*) AS total FROM attendance WHERE employeeId=7")
    )[0].total,
    0,
  );
  assert.equal((await run()).total, 0);
  await query("UPDATE attendance SET outTime=NULL WHERE employeeId=1");
  assert.equal((await run()).total, 0); // manual clearing is respected
  await insert(7, "2026-10-08", "10:00");
  clock = Date.parse("2026-10-09T04:30:00Z");
  assert.equal((await run()).total, 1); // missed evening catches up after reopening
  assert.equal(
    (await query("SELECT outTime FROM attendance WHERE employeeId=6"))[0]
      .outTime,
    null,
  ); // pre-activation history untouched
  const [stored] = await query("SELECT rules FROM settings WHERE id=1");
  const saved =
    typeof stored.rules === "string" ? JSON.parse(stored.rules) : stored.rules;
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify({ ...saved, autoClockOutEnabled: false }),
  ]);
  await insert(2, "2026-10-08", "10:00");
  assert.equal((await run()).total, 0);
  // Break and weekday settings recalculate historical time records, not direct statuses.
  await transaction((c) =>
    recalculateAttendance(c, {
      ...settings,
      breakDeductionEnabled: true,
      weekdayShifts: { 3: { shiftStart: "11:00", shiftEnd: "18:00" } },
    }),
  );
  first = (
    await query("SELECT * FROM attendance WHERE employeeId=2 AND date=?", [
      "2026-10-07",
    ])
  )[0];
  assert.equal(first.workedMinutes, 465);
  assert.equal(first.earlyMinutes, 0);
  assert.equal(
    (await query("SELECT status FROM attendance WHERE employeeId=3"))[0].status,
    "Half day",
  );
  console.log(
    "PASS: 8 PM local boundary, 7:05 PM fallback, preserve existing/manual/overnight/late-start entries, no attendance creation, idempotency, manual clearing, restart catch-up, activation boundary, disabling, break and weekday recalculation.",
  );
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
