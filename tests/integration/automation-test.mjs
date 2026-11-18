import {
  connectTestAdmin,
  testDatabaseHost,
  testDatabasePort,
} from "../helpers/database.mjs";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import { createAutoAbsent } from "../../server/src/services/auto-absence.js";
import { createWhatsAppService } from "../../server/src/services/whatsapp.js";
import { createAutoClockOut } from "../../server/src/services/auto-clockout.js";
import { defaults, settingsSchema } from "../../server/src/services/rules.js";
import { recalculateAttendance } from "../../server/src/services/recalculate.js";
const admin = await connectTestAdmin();
const decoded = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
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
      DB_HOST: testDatabaseHost,
      DB_PORT: String(testDatabasePort),
      DB_USER: "attendance",
      DB_PASSWORD: "attendance_dev",
      DB_NAME: database,
    },
  });
  assert.equal(setup.status, 0, setup.stderr);
  pool = mysql.createPool({
    host: testDatabaseHost,
    port: testDatabasePort,
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
  assert.match(first.notes, /Original note\n!! Auto Out time Added/);
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
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      autoClockOutCutoff: "19:00",
      autoClockOutTime: "20:00",
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      autoClockOutCutoff: "21:00",
      autoClockOutTime: "19:30",
    }).success,
    true,
  );
  // Custom cutoff, assigned time, and optional restart catch-up.
  const custom = {
    ...saved,
    autoClockOutEnabled: true,
    autoClockOutCutoff: "21:00",
    autoClockOutTime: "19:30",
    autoClockOutCatchUp: false,
  };
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify(custom),
  ]);
  await insert(7, "2026-10-09", "10:00");
  clock = Date.parse("2026-10-09T15:29:00Z");
  assert.equal((await run()).total, 0);
  clock += 60000;
  assert.equal((await run()).total, 1);
  const customRow = (
    await query(
      "SELECT * FROM attendance WHERE employeeId=7 AND date='2026-10-09'",
    )
  )[0];
  assert.equal(customRow.outTime, "19:30");
  assert.match(customRow.notes, /!! Auto Out time Added/);
  assert.equal(
    (
      await query(
        "SELECT outTime FROM attendance WHERE employeeId=2 AND date='2026-10-08'",
      )
    )[0].outTime,
    null,
  );
  console.log(
    "PASS: custom cutoff boundary, assigned Out time, notes and disabled catch-up.",
  );
  // Automatic absence is opt-in and based on completed local calendar days.
  await query("DELETE FROM attendance");
  await query(
    "UPDATE employees SET createdAt='2026-10-01 00:00:00',status='Active'",
  );
  await query("UPDATE employees SET status='Inactive' WHERE id=5");
  await query(
    "UPDATE employees SET createdAt='2026-10-09 00:00:00' WHERE id=6",
  );
  await query("UPDATE employees SET phone='+919999999999' WHERE id=1");
  const absenceSettings = {
    ...settings,
    weeklyOffDays: [0],
    autoClockOutEnabled: false,
    employeeRules: {
      7: { ...defaults, shiftStart: "22:00", shiftEnd: "06:00" },
    },
  };
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify(absenceSettings),
  ]);
  const absent = createAutoAbsent({ transaction, audit, now: () => clock });
  assert.equal((await absent()).total, 0);
  clock = Date.parse("2026-10-07T18:29:00Z"); // 11:59 PM India
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify({ ...absenceSettings, autoAbsentEnabled: true }),
  ]);
  assert.equal((await absent()).total, 0);
  assert.equal(
    decoded((await query("SELECT rules FROM settings"))[0].rules)
      .autoAbsentSince,
    "2026-10-07",
  );
  await insert(2, "2026-10-07", "10:00");
  await insert(3, "2026-10-07", null, null, "manual");
  clock = Date.parse("2026-10-07T18:30:00Z"); // midnight India
  const concurrent = await Promise.all([absent(), absent()]);
  assert.equal(
    concurrent.filter(Boolean).reduce((n, r) => n + r.total, 0),
    2,
  );
  const generated = await query(
    "SELECT * FROM attendance WHERE status='Absent'",
  );
  assert.deepEqual(generated.map((r) => r.employeeId).sort(), [1, 4]);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=2"))[0].inTime,
    "10:00",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=3"))[0].status,
    "Half day",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=7")).length,
    0,
  );
  await query("DELETE FROM attendance WHERE employeeId=4");
  assert.equal(
    (await absent()).total,
    0,
    "Reset automatic absence must not be re-added",
  );
  clock = Date.parse("2026-10-08T00:30:00Z"); // 6 AM India: overnight shift complete
  assert.equal((await absent()).total, 1);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=7"))[0].status,
    "Absent",
  );
  assert.equal(
    (await createAutoAbsent({ transaction, audit, now: () => clock })()).total,
    0,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE date<'2026-10-07'")).length,
    0,
  );

  // Delayed genuine IN replaces only an untouched system absence, respecting auto-approval.
  const config = {
    enabled: true,
    sessionId: "test",
    groupId: "test@g.us",
    timeZone: "Asia/Kolkata",
    since: 1,
    groupHistoryVersion: 1,
    autoApprove: false,
    autoOverwrite: false,
  };
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify(config),
  ]);
  const service = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => clock,
  });
  const message = {
    id: "delayed-in",
    chatId: "test@g.us",
    sender: "919999999999@s.whatsapp.net",
    senderName: "Employee 1",
    timestamp: Date.parse("2026-10-07T04:30:00Z") / 1000,
    content: "IN 10:00",
    type: "text",
    isGroup: true,
  };
  await service.ingest(message, "test");
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=1"))[0].status,
    "Absent",
  );
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({ ...config, autoApprove: true }),
  ]);
  await service.ingest({ ...message, id: "delayed-in-approved" }, "test");
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=1"))[0].inTime,
    "10:00",
  );
  const changed = generated.find((r) => r.employeeId === 4);
  await query(
    "INSERT INTO attendance (employeeId,date,mode,status,notes,rules) VALUES (4,'2026-10-07','manual','Absent','Manually confirmed absence',?)",
    [JSON.stringify(decoded(changed.rules))],
  );
  await query("UPDATE employees SET phone='+918888888888' WHERE id=4");
  await service.ingest(
    { ...message, id: "manual-absence", sender: "918888888888@s.whatsapp.net" },
    "test",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=4"))[0].notes,
    "Manually confirmed absence",
  );
  assert.equal(
    (
      await query(
        "SELECT state FROM whatsapp_events WHERE messageId='manual-absence'",
      )
    )[0].state,
    "review",
  );

  // Named/weekly holidays and inactive/new employees are protected during catch-up.
  await query(
    "INSERT INTO holidays (date,name,active) VALUES ('2026-10-08','Office holiday',1)",
  );
  clock = Date.parse("2026-10-12T02:00:00Z");
  await absent();
  assert.equal(
    (
      await query(
        "SELECT * FROM attendance WHERE date IN ('2026-10-08','2026-10-11')",
      )
    ).length,
    0,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=5")).length,
    0,
  );
  const savedAbsence = decoded(
    (await query("SELECT rules FROM settings"))[0].rules,
  );
  await query("UPDATE settings SET rules=? WHERE id=1", [
    JSON.stringify({ ...savedAbsence, autoAbsentEnabled: false }),
  ]);
  clock = Date.parse("2026-10-14T02:00:00Z");
  assert.equal((await absent()).total, 0);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE date='2026-10-12'")).length,
    0,
  );
  assert.ok(
    (
      await query(
        "SELECT * FROM audit WHERE action='Automatic absence recorded'",
      )
    ).length > 0,
  );
  console.log(
    "PASS: auto absence opt-in, timezone midnight, overnight protection, no historical backfill, preservation, reset idempotency, catch-up, holidays and delayed WhatsApp ownership/approval rules.",
  );
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
