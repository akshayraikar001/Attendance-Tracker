import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import {
  configSchema,
  createWhatsAppService,
} from "../../server/src/services/whatsapp.js";
import { registerWhatsApp } from "../../server/src/controllers/whatsapp.js";
const admin = await mysql.createConnection({
  socketPath: process.cwd() + "/.local/mysql.sock",
  user: "root",
});
const database = "attendance_whatsapp_test_" + Date.now();
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
      DB_NAME: database,
      DB_USER: "attendance",
      DB_PASSWORD: "attendance_dev",
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
  const query = async (sql, args = []) => {
    const [r] = await pool.execute(sql, args);
    return r;
  };
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
  const t = Math.floor(Date.now() / 1000) - 600;
  const cfg = {
    enabled: true,
    sessionId: "test",
    groupId: "123@g.us",
    timeZone: "UTC",
    since: t - 3 * 86400,
  };
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify(cfg),
  ]);
  for (let i = 1; i <= 6; i++)
    await query(
      "INSERT INTO employees (name,department,role,status) VALUES (?,'Sales','Staff','Active')",
      ["Test " + i],
    );
  for (let i = 1; i <= 6; i++)
    await query(
      "INSERT INTO whatsapp_links (identity,employeeId) VALUES (?,?)",
      ["phone:91900000000" + i, i],
    );
  const calls = [];
  const service = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async (path, body) => {
      calls.push({ path, body });
      return { messages: [], hasMore: false };
    },
  });
  const msg = (id, text, n = 1, ts = t) => ({
    id,
    chatId: cfg.groupId,
    isGroup: true,
    type: "text",
    content: text,
    timestamp: ts,
    sender: "91900000000" + n + "@s.whatsapp.net",
    senderName: "Person " + n,
  });
  assert.equal(
    (await service.ingest(msg("one", "IN 09:00"), "test")).state,
    "applied",
  );
  await service.ingest(msg("one", "IN 09:00"), "test");
  assert.equal((await query("SELECT * FROM attendance")).length, 1);
  assert.equal(
    (await service.ingest(msg("two", "OUT 18:00"), "test")).state,
    "applied",
  );
  const [day] = await query("SELECT * FROM attendance WHERE employeeId=1");
  assert.equal(day.inTime, "09:00");
  assert.equal(day.outTime, "18:00");
  assert.equal(day.workedMinutes, 540);
  for (const [id, text] of [
    ["invalid-in", "IN 2:99"],
    ["invalid-out", "OUT 6:60"],
  ]) {
    const invalid = msg(id, text);
    for (const overwrite of [false, true]) {
      const result = await service.ingest(
        invalid,
        "test",
        overwrite,
        overwrite,
      );
      assert.equal(result.state, "review");
      assert.equal(result.reason, "Invalid time; review this message.");
      assert.deepEqual(
        (await query("SELECT * FROM attendance WHERE employeeId=1"))[0],
        day,
      );
    }
  }
  assert.equal(
    (await service.ingest(msg("dup", "OUT 18:00"), "test")).state,
    "ignored",
  );
  assert.equal(
    (await service.ingest(msg("conflict", "OUT 19:00"), "test")).state,
    "review",
  );
  const before = (await query("SELECT * FROM whatsapp_events")).length;
  await service.ingest({ ...msg("wrong", "IN"), chatId: "456@g.us" }, "test");
  await service.ingest({ ...msg("private", "IN"), isGroup: false }, "test");
  await service.ingest(msg("history", "IN", 1, t - 4 * 86400), "test");
  await service.ingest(msg("chatter", "Hello team"), "test");
  assert.equal((await query("SELECT * FROM whatsapp_events")).length, before);
  assert.equal(
    (await service.ingest(msg("outfirst", "OUT 18:00", 2), "test")).state,
    "review",
  );
  await service.ingest(msg("insecond", "IN 09:30", 2), "test");
  assert.equal(
    (await service.ingest(msg("outfirst", "OUT 18:00", 2), "test", true)).state,
    "applied",
  );
  await service.ingest(msg("editable", "IN 10:00", 3), "test");
  await query(
    "UPDATE attendance SET notes='Manual correction' WHERE employeeId=3",
  );
  assert.equal(
    (await service.ingest(msg("manual", "OUT 18:00", 3), "test")).state,
    "review",
  );
  assert.equal(
    (await query("SELECT outTime FROM attendance WHERE employeeId=3"))[0]
      .outTime,
    null,
  );
  const midnight =
    Date.parse(
      new Date((t - 86400) * 1000).toISOString().slice(0, 10) + "T00:00:00Z",
    ) / 1000;
  await service.ingest(msg("nightin", "IN 20:00", 4, midnight - 3600), "test");
  assert.equal(
    (
      await service.ingest(
        msg("nightout", "OUT 04:00 AM", 4, midnight + 6 * 3600),
        "test",
      )
    ).state,
    "applied",
  );
  assert.equal(
    (
      await query(
        "SELECT overnight,workedMinutes FROM attendance WHERE employeeId=4",
      )
    )[0].workedMinutes,
    480,
  );
  const lid = {
    ...msg("lid", "IN 09:00", 5),
    sender: "123456@lid",
    senderPhone: "123456",
  };
  assert.equal((await service.ingest(lid, "test")).state, "review");
  await query("INSERT INTO whatsapp_links (identity,employeeId) VALUES (?,?)", [
    "lid:123456",
    5,
  ]);
  assert.equal((await service.ingest(lid, "test", true)).state, "applied");
  const manualDate = new Date(t * 1000).toISOString().slice(0, 10);
  await query(
    "INSERT INTO attendance (employeeId,date,mode,status,notes,rules) SELECT 6,?,'manual','Absent','Manually marked absent',rules FROM settings WHERE id=1",
    [manualDate],
  );
  const readManualDay = async () =>
    (
      await query("SELECT * FROM attendance WHERE employeeId=6 AND date=?", [
        manualDate,
      ])
    )[0];
  const manualDay = await readManualDay();
  const overwriteMessage = msg("manual-status-overwrite", "IN 10:31", 6);
  assert.equal(
    (await service.ingest(overwriteMessage, "test", true)).state,
    "review",
  );
  assert.deepEqual(await readManualDay(), manualDay);
  assert.equal(
    (await service.ingest(overwriteMessage, "test", true, true)).state,
    "applied",
  );
  const overwritten = await readManualDay();
  assert.equal(overwritten.mode, "time");
  assert.equal(overwritten.inTime, "10:31");
  assert.equal(overwritten.outTime, null);
  assert.equal(overwritten.status, "In progress");
  assert.equal(overwritten.notes, manualDay.notes);
  assert.equal(
    (await service.ingest(msg("manual-status-out", "OUT 18:00", 6), "test"))
      .state,
    "applied",
  );
  const completed = await readManualDay();
  assert.equal(completed.mode, "time");
  assert.equal(completed.inTime, "10:31");
  assert.equal(completed.outTime, "18:00");
  assert.equal(completed.workedMinutes, 449);
  await service.poll();
  assert.equal(calls[0].body.chatId, cfg.groupId);
  assert.equal(service.status.error, null);
  // Large histories resume across syncs/restarts, and apply IN before OUT.
  assert.equal(configSchema.parse(cfg).messagesPerSync, 200);
  assert.equal(configSchema.parse(cfg).syncIntervalMinutes, 5);
  for (const value of [0, -1, 1.5, 2001, "200"])
    assert.equal(
      configSchema.safeParse({ ...cfg, messagesPerSync: value }).success,
      false,
    );
  for (const value of [0, -1, 1.5, 1441, "5"])
    assert.equal(
      configSchema.safeParse({ ...cfg, syncIntervalMinutes: value }).success,
      false,
    );
  await query(
    "INSERT INTO employees (name,department,role,status,phone) VALUES ('Backlog Test','Sales','Staff','Active','+919000000007')",
  );
  const history = Array.from({ length: 2105 }, (_, i) =>
    msg(
      "backlog-" + i,
      i === 0 ? "IN 09:00" : i === 2104 ? "OUT 18:00" : "Hello team",
      7,
      t - 2200 + i,
    ),
  ).reverse();
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...cfg,
      autoApprove: true,
      messagesPerSync: 200,
      syncIntervalMinutes: 5,
      revision: 100,
    }),
  ]);
  let clock = Date.now(),
    fetches = 0,
    failPage = false;
  const request = async (path, body) => {
    fetches++;
    assert.ok(body.limit <= 100);
    if (failPage) {
      failPage = false;
      throw new Error("Temporary connection failure");
    }
    const offset = body.cursor
      ? history.findIndex((m) => m.id === body.cursor) + 1
      : 0;
    assert.ok(!body.cursor || offset > 0);
    const messages = history.slice(offset, offset + body.limit);
    return {
      messages,
      cursor: messages.at(-1)?.id,
      hasMore: offset + messages.length < history.length,
    };
  };
  const newService = () =>
    createWhatsAppService({
      query,
      transaction,
      audit,
      request,
      now: () => clock,
    });
  let sync = newService();
  await sync.poll({ automatic: true });
  assert.equal((await sync.config()).syncProgress.scanned, 200);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=7")).length,
    0,
  );
  const firstFetches = fetches;
  await sync.poll({ automatic: true });
  clock += 299999;
  await sync.poll({ automatic: true });
  assert.equal(
    fetches,
    firstFetches,
    "Automatic sync must honor its interval, including page refreshes",
  );
  clock++;
  failPage = true;
  await sync.poll({ automatic: true });
  assert.match(sync.status.error, /Temporary connection/);
  assert.equal((await sync.config()).syncProgress.scanned, 200);
  sync = newService(); // Restart must resume the persisted cursor and queue.
  await sync.poll();
  assert.equal((await sync.config()).syncProgress.scanned, 400);
  for (let i = 0; i < 20 && (await sync.config()).syncProgress; i++)
    await sync.poll();
  assert.equal((await sync.config()).syncProgress, null);
  assert.equal(sync.status.error, null);
  const [backlogDay] = await query(
    "SELECT * FROM attendance WHERE employeeId=7",
  );
  assert.equal(backlogDay.inTime, "09:00");
  assert.equal(backlogDay.outTime, "18:00");
  assert.equal(backlogDay.workedMinutes, 540);
  assert.equal(
    (await query("SELECT * FROM whatsapp_events WHERE employeeId=7")).length,
    2,
  );
  // A message delivered while closed is found; overlap does not apply old events twice.
  history.unshift(
    msg("backlog-offline", "OUT 19:00", 7, Math.floor(clock / 1000) - 10),
  );
  await sync.poll(); // Manual sync bypasses the automatic interval.
  for (let i = 0; i < 20 && (await sync.config()).syncProgress; i++)
    await sync.poll();
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='backlog-offline'",
      )
    )[0].state,
    "review",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=7"))[0].outTime,
    "18:00",
  );
  assert.equal(
    (await query("SELECT * FROM whatsapp_events WHERE employeeId=7")).length,
    3,
  );
  // Paused importing never fetches, even when manually requested.
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({ ...(await sync.config()), enabled: false }),
  ]);
  const pausedFetches = fetches;
  await sync.poll();
  assert.equal(fetches, pausedFetches);
  console.log(
    "PASS: configurable limits/intervals, 2,105-message backlog, restart and failure recovery, chronological application, offline catch-up, deduplication and manual sync.",
  );
  const resetSync = async (extra = {}) => {
    await query("DELETE FROM whatsapp_sync_queue");
    await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
      JSON.stringify({
        ...cfg,
        autoApprove: false,
        messagesPerSync: 200,
        syncIntervalMinutes: 5,
        revision: 200,
        ...extra,
      }),
    ]);
  };
  // Applying a large pending queue is also bounded and survives a restart.
  await resetSync();
  let queueCalls = 0;
  const pendingHistory = Array.from({ length: 300 }, (_, i) =>
    msg("pending-" + i, "IN 10:31", 6, t - 1000 + i),
  ).reverse();
  const queueRequest = async (_, body) => {
    queueCalls++;
    const offset = body.cursor
      ? pendingHistory.findIndex((m) => m.id === body.cursor) + 1
      : 0;
    const messages = pendingHistory.slice(offset, offset + body.limit);
    return {
      messages,
      cursor: messages.at(-1)?.id,
      hasMore: offset + messages.length < pendingHistory.length,
    };
  };
  let queued = createWhatsAppService({
    query,
    transaction,
    audit,
    request: queueRequest,
  });
  await queued.poll();
  await queued.poll();
  assert.equal((await queued.config()).syncProgress.phase, "apply");
  assert.equal(
    Number(
      (await query("SELECT COUNT(*) AS total FROM whatsapp_sync_queue"))[0]
        .total,
    ),
    100,
  );
  const beforeDrainCalls = queueCalls;
  queued = createWhatsAppService({
    query,
    transaction,
    audit,
    request: queueRequest,
  });
  await queued.poll();
  assert.equal(queueCalls, beforeDrainCalls);
  assert.equal((await queued.config()).syncProgress, null);
  const pendingEvents = await query(
    "SELECT * FROM whatsapp_events WHERE messageId LIKE 'pending-%'",
  );
  assert.equal(pendingEvents.length, 300);
  assert.ok(pendingEvents.every((e) => e.state === "review"));
  assert.equal((await readManualDay()).inTime, "10:31");
  // A stuck cursor reports an error without applying an incomplete history.
  await resetSync();
  let stalledCalls = 0;
  const stalled = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async () => {
      stalledCalls++;
      return {
        messages: [msg("stalled", "IN 11:00", 6)],
        cursor: "stalled-cursor",
        hasMore: true,
      };
    },
  });
  await stalled.poll();
  assert.equal(stalledCalls, 2);
  assert.match(stalled.status.error, /pagination stalled/);
  assert.equal((await stalled.config()).syncProgress.scanned, 1);
  assert.equal(
    (await query("SELECT * FROM whatsapp_events WHERE messageId='stalled'"))
      .length,
    0,
  );
  // Settings edited during an outstanding fetch invalidate that response.
  await resetSync();
  const changed = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async () => {
      await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
        JSON.stringify({ ...cfg, autoApprove: false, revision: 201 }),
      ]);
      return {
        messages: [msg("stale-response", "IN 11:00", 6)],
        hasMore: false,
      };
    },
  });
  await changed.poll();
  assert.equal(
    Number(
      (await query("SELECT COUNT(*) AS total FROM whatsapp_sync_queue"))[0]
        .total,
    ),
    0,
  );
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='stale-response'",
      )
    ).length,
    0,
  );
  // The real settings route preserves progress for this source, and clears it
  // when selecting a different group. Client-supplied checkpoints are ignored.
  await resetSync({
    syncProgress: { phase: "fetch", cursor: "saved-cursor", scanned: 100 },
  });
  const routes = new Map();
  const app = {
    use() {},
    get() {},
    post() {},
    delete() {},
    put(path, handler) {
      routes.set(path, handler);
    },
  };
  registerWhatsApp({ app, wrap: (fn) => fn, query, transaction, audit });
  const saveConfig = async (body) => {
    let saved;
    await routes.get("/api/whatsapp/config")(
      { body, user: { id: 1 } },
      {
        json(data) {
          saved = data.config;
        },
      },
    );
    return saved;
  };
  const same = await saveConfig({
    ...cfg,
    enabled: false,
    messagesPerSync: 400,
    syncIntervalMinutes: 2,
    syncProgress: null,
    since: 1,
  });
  assert.equal(same.messagesPerSync, 400);
  assert.equal(same.syncIntervalMinutes, 2);
  assert.equal(same.syncProgress.cursor, "saved-cursor");
  assert.equal(same.since, cfg.since);
  await query(
    "INSERT INTO whatsapp_sync_queue (id,timestamp,message) VALUES (?, ?, ?)",
    ["a".repeat(64), t, JSON.stringify(msg("old-source", "IN 09:00"))],
  );
  const other = await saveConfig({ ...same, groupId: "456@g.us" });
  assert.equal(other.syncProgress, null);
  assert.equal(
    Number(
      (await query("SELECT COUNT(*) AS total FROM whatsapp_sync_queue"))[0]
        .total,
    ),
    0,
  );
  const returned = await saveConfig({
    ...same,
    groupHistory: {}, // A client cannot erase the server's saved boundaries.
    groupHistoryVersion: 1,
  });
  assert.equal(returned.since, cfg.since);
  assert.equal(returned.syncProgress, null);
  assert.equal(returned.lastHistoryScan, 0);
  const anotherDevice = await saveConfig({
    ...returned,
    sessionId: "different-device",
  });
  assert.equal(anotherDevice.since, 0);
  const returnedAgain = await saveConfig({ ...same, sessionId: cfg.sessionId });
  assert.equal(returnedAgain.since, cfg.since);
  // An unusually late old message is recovered by the daily full-history scan.
  clock = Date.now();
  await resetSync({
    checkedThrough: Math.floor(clock / 1000),
    lastHistoryScan: Math.floor(clock / 1000),
  });
  const delayed = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => clock,
    request: async () => ({
      messages: [msg("delayed-history", "IN 09:00", 7, t - 2 * 86400)],
      hasMore: false,
    }),
  });
  await delayed.poll();
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='delayed-history'",
      )
    ).length,
    0,
  );
  clock += 86401000;
  await delayed.poll();
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='delayed-history'",
      )
    )[0].state,
    "review",
  );
  console.log(
    "PASS: bounded pending queue, approval-off protection, stalled pagination, concurrent settings changes, persisted settings, source isolation and delayed-history recovery.",
  );
  // Reproduce an old installation: IN was imported, a group switch advanced
  // `since`, then valid OUT and leave messages from before that cutoff vanished.
  await query(
    "INSERT INTO employees (id,name,department,role,status,phone) VALUES (99,'Recovery Test','Sales','Staff','Active','+919111111111')",
  );
  const recoveryConfig = {
    ...cfg,
    groupId: "recovery@g.us",
    since: t - 200,
    autoApprove: true,
    autoOverwrite: false,
    leaveEnabled: true,
  };
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify(recoveryConfig),
  ]);
  const recoveryMessage = (id, text, timestamp) => ({
    ...msg(id, text, 1, timestamp),
    chatId: recoveryConfig.groupId,
    sender: "919111111111@s.whatsapp.net",
  });
  const recoveryIn = recoveryMessage("recovery-in", "Intime 09:30", t - 100);
  const recoveryOut = recoveryMessage("recovery-out", "Outtime 6:55", t);
  const recoveryLeave = recoveryMessage(
    "recovery-leave",
    "Tomorrow I am on leave",
    t + 1,
  );
  const recoveryService = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async () => ({
      messages: [recoveryLeave, recoveryOut, recoveryIn],
      hasMore: false,
    }),
  });
  await recoveryService.ingest(recoveryIn, cfg.sessionId);
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...recoveryConfig,
      since: t + 100,
      checkedThrough: t + 100,
      lastHistoryScan: t + 100,
      syncProgress: null,
    }),
  ]);
  await recoveryService.poll();
  assert.equal(recoveryService.status.error, null);
  const recoveredConfig = await recoveryService.config();
  assert.equal(recoveredConfig.since, t - 100);
  const recoveredAttendance = await query(
    "SELECT * FROM attendance WHERE employeeId=99",
  );
  assert.equal(recoveredAttendance.length, 1);
  assert.equal(recoveredAttendance[0].inTime, "09:30");
  assert.equal(recoveredAttendance[0].outTime, "18:55");
  assert.equal(
    (
      await query(
        "SELECT state FROM leave_requests WHERE messageId='recovery-leave'",
      )
    )[0].state,
    "pending",
  );
  await recoveryService.poll();
  assert.deepEqual(
    await query("SELECT * FROM attendance WHERE employeeId=99"),
    recoveredAttendance,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*) AS total FROM whatsapp_events WHERE groupId=?",
        [recoveryConfig.groupId],
      )
    )[0].total,
    2,
  );
  // Switching away and back catches messages sent while another group was selected.
  await saveConfig({
    ...recoveredConfig,
    enabled: false,
    leaveEnabled: false,
    groupId: "456@g.us",
  });
  const resumed = await saveConfig({
    ...recoveredConfig,
    enabled: false,
    leaveEnabled: false,
  });
  assert.equal(resumed.since, recoveredConfig.since);
  assert.equal(resumed.lastHistoryScan, 0);
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({ ...resumed, enabled: true, autoApprove: false }),
  ]);
  const laterOut = recoveryMessage("recovery-later-out", "OUT 7:15", t + 2);
  const resumedService = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async () => ({
      messages: [laterOut, recoveryOut, recoveryIn],
      hasMore: false,
    }),
  });
  await resumedService.poll();
  assert.equal(
    (
      await query(
        "SELECT state FROM whatsapp_events WHERE messageId='recovery-later-out'",
      )
    )[0].state,
    "review",
  );
  assert.deepEqual(
    await query("SELECT * FROM attendance WHERE employeeId=99"),
    recoveredAttendance,
  );
  console.log(
    "PASS: group/device boundaries persist across switches, legacy cutoff recovery imports missing OUT, deduplication preserves existing times, leave stays pending, and auto-approval off stays off.",
  );
  const count = (await query("SELECT * FROM attendance")).length;
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({ ...cfg, enabled: false }),
  ]);
  await service.ingest(msg("paused", "IN 11:00"), "test");
  assert.equal((await query("SELECT * FROM attendance")).length, count);
  console.log(
    "PASS: selected-group privacy, phone/LID mapping, IN/OUT calculation, deduplication, conflicts, manual-edit protection, manual-status overwrite and subsequent OUT, out-before-in review, overnight shifts, pause and polling.",
  );
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
