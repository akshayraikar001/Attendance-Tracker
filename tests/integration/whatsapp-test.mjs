import {
  connectTestAdmin,
  testDatabaseHost,
  testDatabasePort,
} from "../helpers/database.mjs";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import {
  configSchema,
  createWhatsAppService,
} from "../../server/src/services/whatsapp.js";
import { registerWhatsApp } from "../../server/src/controllers/whatsapp.js";
const admin = await connectTestAdmin();
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
      DB_HOST: testDatabaseHost,
      DB_PORT: String(testDatabasePort),
      DB_NAME: database,
      DB_USER: "attendance",
      DB_PASSWORD: "attendance_dev",
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
    Date.parse(new Date(t * 1000).toISOString().slice(0, 10) + "T00:00:00Z") /
    1000;
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
      syncIntervalMinutes: 120,
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
  clock += 14999;
  await sync.poll({ automatic: true });
  assert.equal(
    fetches,
    firstFetches,
    "An unfinished scan resumes after 15 seconds, not another 120 minutes",
  );
  clock++;
  failPage = true;
  await sync.poll({ automatic: true });
  assert.match(sync.status.error, /Temporary connection/);
  assert.equal((await sync.config()).syncProgress.scanned, 200);
  const failedFetches = fetches;
  clock += 59999;
  await sync.poll({ automatic: true });
  assert.equal(fetches, failedFetches);
  clock++;
  await sync.poll({ automatic: true });
  assert.equal((await sync.config()).syncProgress.scanned, 400);
  sync = newService(); // Restart must resume the persisted cursor and queue.
  await sync.poll();
  assert.equal((await sync.config()).syncProgress.scanned, 600);
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
  // A previously fetched OUT is repaired when a delayed IN finally arrives,
  // even when that OUT is absent from the provider's next response.
  await query(
    "INSERT INTO employees (id,name,department,role,status,phone) VALUES (8,'Late IN','Sales','Staff','Active','+919000000008')",
  );
  await resetSync({ autoApprove: true, syncIntervalMinutes: 120 });
  let lateClock = Date.now();
  let lateFetches = 0;
  let lateMessages = [msg("late-out", "OUT 18:00", 8)];
  const lateService = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => lateClock,
    request: async () => {
      lateFetches++;
      return { messages: lateMessages, hasMore: false };
    },
  });
  await lateService.poll({ automatic: true });
  assert.equal(
    (
      await query(
        "SELECT state FROM whatsapp_events WHERE messageId='late-out'",
      )
    )[0].state,
    "review",
  );
  lateMessages = [msg("late-in", "IN 09:00", 8, t - 60)];
  lateClock += 120 * 60000 - 1;
  await lateService.poll({ automatic: true });
  assert.equal(
    lateFetches,
    1,
    "Completed scans still respect the 120-minute setting",
  );
  lateClock++;
  await lateService.poll({ automatic: true });
  assert.equal(lateService.status.error, null);
  const [lateDay] = await query("SELECT * FROM attendance WHERE employeeId=8");
  assert.equal(lateDay.inTime, "09:00");
  assert.equal(lateDay.outTime, "18:00");
  assert.equal(
    (
      await query(
        "SELECT state FROM whatsapp_events WHERE messageId='late-out'",
      )
    )[0].state,
    "applied",
  );

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
  {
    // Clearing a stuck job preserves attendance, queued messages and checkpoints,
    // survives service recreation, and waits for the user's cache-only sync.
    await resetSync({
      groupHistoryVersion: 1,
      checkedThrough: t - 100,
      syncProgress: {
        phase: "fetch",
        cursor: "stuck",
        waitingForHistory: true,
      },
    });
    const preservedAttendance = await query(
      "SELECT * FROM attendance ORDER BY id",
    );
    const preservedEvents = await query(
      "SELECT * FROM whatsapp_events ORDER BY id",
    );
    const queuedMessage = msg("clear-preserved", "IN 10:00", 1);
    await query(
      "INSERT INTO whatsapp_sync_queue (id,timestamp,message) VALUES (?,?,?)",
      [
        "clear-preserved",
        queuedMessage.timestamp,
        JSON.stringify(queuedMessage),
      ],
    );
    const beforeClear = await queued.config();
    await queued.clearStuckSync();
    const cleared = await queued.config();
    assert.equal(cleared.syncProgress, null);
    assert.equal(cleared.resumeFromCache, true);
    assert.ok(cleared.revision > (beforeClear.revision || 0));
    assert.equal(cleared.checkedThrough, beforeClear.checkedThrough);
    assert.deepEqual(
      await query("SELECT * FROM attendance ORDER BY id"),
      preservedAttendance,
    );
    assert.deepEqual(
      await query("SELECT * FROM whatsapp_events ORDER BY id"),
      preservedEvents,
    );
    assert.equal(
      Number((await query("SELECT COUNT(*) n FROM whatsapp_sync_queue"))[0].n),
      1,
    );
    let freshCalls = 0;
    const recovered = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async (_route, body) => {
        freshCalls++;
        assert.equal(body.cursor, null);
        assert.equal(body.recoverHistory, false);
        return { messages: [], scannedCount: 0, hasMore: false };
      },
    });
    await recovered.poll({ automatic: true });
    assert.equal(freshCalls, 0);
    await recovered.poll();
    assert.equal(freshCalls, 1);
    assert.equal(recovered.status.error, null);
    assert.equal((await recovered.config()).syncProgress, null);
    assert.equal((await recovered.config()).resumeFromCache, false);
    assert.equal(
      Number((await query("SELECT COUNT(*) n FROM whatsapp_sync_queue"))[0].n),
      0,
    );
  }
  // An in-flight response cannot restore the cleared job or enqueue stale data.
  {
    await resetSync({ groupHistoryVersion: 1 });
    let release, started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const delayed = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async () => {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        return {
          messages: [msg("cleared-stale-response", "IN 10:00", 1)],
          hasMore: false,
        };
      },
    });
    const oldPoll = delayed.poll();
    await entered;
    await delayed.clearStuckSync();
    release();
    await oldPoll;
    assert.equal((await delayed.config()).syncProgress, null);
    assert.equal((await delayed.config()).resumeFromCache, true);
    assert.equal(
      Number((await query("SELECT COUNT(*) n FROM whatsapp_sync_queue"))[0].n),
      0,
    );
    assert.equal(
      (
        await query(
          "SELECT id FROM whatsapp_events WHERE messageId='cleared-stale-response'",
        )
      ).length,
      0,
    );
  }
  // Cached messages are not proof that a phone history request has finished.
  await resetSync({ groupHistoryVersion: 1, checkedThrough: t - 100 });
  let phonePending = true;
  let phoneClock = Date.now();
  const phoneRecovery = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => phoneClock,
    request: async (_route, body) => {
      assert.equal(body.recoverHistory, true);
      return {
        messages: [msg("phone-recovery", "OUT 18:00", 6)],
        historyPending: phonePending,
        hasMore: false,
        scannedCount: 1,
      };
    },
  });
  await phoneRecovery.poll();
  assert.match(phoneRecovery.status.error, /history recovery is pending/);
  assert.equal((await phoneRecovery.config()).checkedThrough, t - 100);
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='phone-recovery'",
      )
    ).length,
    0,
  );
  assert.equal(
    (await phoneRecovery.config()).syncProgress.waitingForHistory,
    true,
  );
  assert.equal(
    (await phoneRecovery.config()).syncProgress.recoverHistory,
    true,
  );
  phonePending = false;
  phoneClock += 16000;
  await phoneRecovery.poll({ automatic: true });
  assert.equal(phoneRecovery.status.error, null);
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='phone-recovery'",
      )
    ).length,
    1,
  );
  // A page containing only hidden protocol messages still has a valid cursor.
  await resetSync({ groupHistoryVersion: 1, messagesPerSync: 1 });
  const rawPages = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async (_, body) =>
      body.cursor
        ? {
            messages: [msg("after-protocol-page", "IN 09:00", 6)],
            scannedCount: 1,
            hasMore: false,
          }
        : {
            messages: [],
            scannedCount: 1,
            cursor: "protocol-page",
            hasMore: true,
          },
  });
  await rawPages.poll();
  assert.equal(rawPages.status.error, null);
  assert.equal((await rawPages.config()).syncProgress.scanned, 1);
  await rawPages.poll();
  assert.equal(rawPages.status.error, null);
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='after-protocol-page'",
      )
    ).length,
    1,
  );
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
    get(path, handler) {
      routes.set("GET " + path, handler);
    },
    post(path, handler) {
      routes.set("POST " + path, handler);
    },
    delete(path, handler) {
      routes.set("DELETE " + path, handler);
    },
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
  // Production regression: a history IN had participant outside key, and
  // Chatery returned the group as sender. Retry must fetch fresh identity.
  await resetSync({ autoApprove: true });
  await query(
    "INSERT INTO employees (id,name,department,role,status,phone) VALUES (100,'History Sender','Sales','Staff','Active','+9190000000100')",
  );
  const unknown = {
    ...msg("unknown-history", "In time 2:07", 100),
    sender: cfg.groupId,
    senderName: "",
  };
  let fresh = {
    ...unknown,
    sender: "9190000000100@s.whatsapp.net",
    senderName: "History Sender",
  };
  let refreshCount = 0;
  const identityService = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async () => {
      refreshCount++;
      return { messages: [fresh], hasMore: false };
    },
  });
  assert.equal(
    (await identityService.ingest(unknown, cfg.sessionId)).state,
    "review",
  );
  const [unresolved] = await query(
    "SELECT * FROM whatsapp_events WHERE messageId='unknown-history'",
  );
  assert.equal(unresolved.senderId, "unresolved");
  assert.match(unresolved.reason, /Retry to fetch/);
  fresh = unknown;
  assert.equal(
    (await identityService.retryEvent(unresolved.id)).state,
    "review",
  );
  assert.equal(
    (
      await query("SELECT senderId FROM whatsapp_events WHERE id=?", [
        unresolved.id,
      ])
    )[0].senderId,
    "unresolved",
  );
  fresh = {
    ...unknown,
    sender: "9190000000100@s.whatsapp.net",
    senderName: "History Sender",
  };
  assert.equal(
    (await identityService.retryEvent(unresolved.id)).state,
    "applied",
  );
  assert.equal(refreshCount, 2);
  const [repairedSender] = await query(
    "SELECT * FROM whatsapp_events WHERE id=?",
    [unresolved.id],
  );
  assert.equal(repairedSender.senderId, "phone:9190000000100");
  assert.equal(repairedSender.senderName, "History Sender");
  assert.equal(repairedSender.employeeId, 100);
  assert.equal(
    (await query("SELECT inTime FROM attendance WHERE employeeId=100"))[0]
      .inTime,
    "14:07",
  );
  await identityService.retryEvent(unresolved.id);
  assert.equal(
    refreshCount,
    2,
    "Applied messages are not fetched or applied again",
  );

  // A normal rescan updates unresolved identities even with auto-approve off,
  // without turning sender recovery into approval or overwriting manual edits.
  await resetSync({ autoApprove: false });
  const unknownOut = {
    ...unknown,
    id: "unknown-history-out",
    content: "OUT 18:00",
  };
  await identityService.ingest(unknownOut, cfg.sessionId);
  fresh = { ...unknownOut, participant: "9190000000100@s.whatsapp.net" };
  await identityService.poll();
  assert.equal(identityService.status.error, null);
  const [reviewOut] = await query(
    "SELECT * FROM whatsapp_events WHERE messageId='unknown-history-out'",
  );
  assert.equal(reviewOut.senderId, "phone:9190000000100");
  assert.equal(reviewOut.state, "review");
  assert.equal(reviewOut.employeeId, 100);
  assert.equal(
    (await query("SELECT outTime FROM attendance WHERE employeeId=100"))[0]
      .outTime,
    null,
  );
  await query("UPDATE attendance SET notes='Manual edit' WHERE employeeId=100");
  assert.match(
    (await identityService.retryEvent(reviewOut.id)).reason,
    /manually/,
  );
  assert.equal(
    (await query("SELECT outTime FROM attendance WHERE employeeId=100"))[0]
      .outTime,
    null,
  );
  console.log(
    "PASS: unknown sender refresh, persistent recovered identity, no fabricated LID, exact IN time, idempotency, approval-off recovery and manual edit protection.",
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
  // Use local midnight: Thursday in India while UTC is still Wednesday.
  const boundaryNow = Date.parse("2026-10-14T19:00:00Z");
  await query(
    "INSERT INTO employees (id,name,department,role,status) VALUES (101,'Boundary','Sales','Staff','Active')",
  );
  await query(
    "INSERT INTO whatsapp_links (identity,employeeId) VALUES ('phone:919000000009',101)",
  );
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...cfg,
      since: 0,
      timeZone: "Asia/Kolkata",
      autoApprove: true,
      autoOverwrite: true,
    }),
  ]);
  const boundary = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => boundaryNow,
  });
  const oldMessage = msg(
    "boundary-old",
    "IN 10:00",
    9,
    Date.parse("2026-10-13T05:00:00Z") / 1000,
  );
  // retry=true is also used by automatic sync and must NOT bypass the limit.
  assert.equal(
    (await boundary.ingest(oldMessage, "test", true, true)).state,
    "review",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=101")).length,
    0,
  );
  let event = (
    await query("SELECT * FROM whatsapp_events WHERE messageId='boundary-old'")
  )[0];
  assert.equal((await boundary.retryEvent(event.id, true)).state, "applied");
  const correction = {
    ...oldMessage,
    id: "boundary-correction",
    content: "IN 11:00",
  };
  assert.equal(
    (await boundary.ingest(correction, "test", true, true)).state,
    "review",
  );
  assert.equal(
    (await query("SELECT inTime FROM attendance WHERE employeeId=101"))[0]
      .inTime,
    "10:00",
  );
  event = (
    await query(
      "SELECT * FROM whatsapp_events WHERE messageId='boundary-correction'",
    )
  )[0];
  assert.equal((await boundary.retryEvent(event.id, true)).state, "applied");
  assert.equal(
    (await query("SELECT inTime FROM attendance WHERE employeeId=101"))[0]
      .inTime,
    "11:00",
  );
  // An OUT posted yesterday must not change an older overnight attendance date.
  const oldOut = msg(
    "boundary-overnight",
    "OUT 04:00 AM",
    9,
    Date.parse("2026-10-13T23:00:00Z") / 1000,
  );
  assert.equal(
    (await boundary.ingest(oldOut, "test", true, true)).state,
    "review",
  );
  for (const day of [14, 15]) {
    const incoming = msg(
      "boundary-" + day,
      "IN 10:00",
      9,
      Date.parse(`2026-10-${day}T00:00:00+05:30`) / 1000,
    );
    assert.equal(
      (await boundary.ingest(incoming, "test", true, true)).state,
      "applied",
    );
  }
  const beforeClear = await query(
    "SELECT * FROM attendance WHERE employeeId=101 ORDER BY date",
  );
  await routes.get("DELETE /api/whatsapp/events")({}, { json() {} });
  assert.ok(
    (
      await query(
        "SELECT clearedAt FROM whatsapp_events WHERE messageId='boundary-correction'",
      )
    )[0].clearedAt,
  );
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE sessionId='test' AND groupId=? AND clearedAt IS NULL",
        [cfg.groupId],
      )
    ).length,
    0,
  );
  await boundary.ingest(correction, "test", true, true);
  assert.deepEqual(
    await query("SELECT * FROM attendance WHERE employeeId=101 ORDER BY date"),
    beforeClear,
  );
  console.log(
    "PASS: local today/yesterday guard, automatic retries, old manual overwrite, overnight protection, archived history and deduplication.",
  );
  // Reconnection history can arrive after today's IN advanced the checkpoint.
  // Neither yesterday's IN nor OUT may be inside a rolling 24-hour window.
  for (const timeZone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
    const catchupNow = Date.parse(
      timeZone === "Asia/Kolkata"
        ? "2026-10-27T17:30:00Z"
        : timeZone === "America/New_York"
          ? "2026-10-28T03:00:00Z"
          : "2026-10-27T23:00:00Z",
    );
    await resetSync({
      timeZone,
      groupHistoryVersion: 1,
      since: Date.parse("2026-10-24T00:00:00Z") / 1000,
      checkedThrough: catchupNow / 1000,
      lastHistoryScan: catchupNow / 1000,
      messagesPerSync: 1,
    });
    const missed = [
      msg("catchup-today-" + timeZone, "IN 09:00", 1, catchupNow / 1000 - 60),
      msg(
        "catchup-chat-" + timeZone,
        "See you tomorrow",
        1,
        catchupNow / 1000 - 26 * 3600,
      ),
      msg(
        "catchup-out-" + timeZone,
        "OUT 17:00",
        1,
        catchupNow / 1000 - 30 * 3600,
      ),
      msg(
        "catchup-in-" + timeZone,
        "IN 09:00",
        1,
        catchupNow / 1000 - 38 * 3600,
      ),
    ];
    const request = async (_, body) => {
      const offset = body.cursor
        ? missed.findIndex((m) => m.id === body.cursor) + 1
        : 0;
      return {
        messages: missed.slice(offset, offset + 1),
        cursor: missed[offset]?.id,
        hasMore: offset + 1 < missed.length,
      };
    };
    for (let attempt = 0; attempt < 8; attempt++) {
      // Restart between pages to exercise durable progress.
      const catchup = createWhatsAppService({
        query,
        transaction,
        audit,
        request,
        now: () => catchupNow,
      });
      await catchup.poll();
      assert.equal(catchup.status.error, null);
      if (!(await catchup.config()).syncProgress) break;
    }
    for (const message of missed.filter(
      (m) => !m.id.startsWith("catchup-chat-"),
    )) {
      assert.equal(
        (
          await query("SELECT * FROM whatsapp_events WHERE messageId=?", [
            message.id,
          ])
        ).length,
        1,
        message.id,
      );
    }
  }
  console.log(
    "PASS: next-day reconnect catches yesterday's messages after today's IN, across timezones and restarts.",
  );
  // Yesterday's OUT is inside the incremental window, but its IN is outside.
  // Search must cross the old cutoff and survive a one-message page limit.
  const recoveryNow = Date.parse(
    new Date().toISOString().slice(0, 10) + "T18:00:00Z",
  );
  const yesterdayStart = recoveryNow / 1000 - 18 * 3600 - 86400;
  for (const variant of [0, 1, 2]) {
    const autoApprove = variant !== 1;
    const previousOut = variant === 2;
    const employeeId = 102 + variant;
    const phone = "917777001" + employeeId;
    await query(
      "INSERT INTO employees (id,name,department,role,status,phone) VALUES (?, 'Recovery','Sales','Staff','Active',?)",
      [employeeId, "+" + phone],
    );
    await resetSync({
      autoApprove,
      messagesPerSync: 1,
      checkedThrough: recoveryNow / 1000,
      lastHistoryScan: recoveryNow / 1000,
      since: yesterdayStart - 86400,
    });
    const recoveryMessages = [
      {
        ...msg(
          "recover-out-" + employeeId,
          "OUT 19:00",
          1,
          yesterdayStart + 19 * 3600,
        ),
        sender: phone + "@s.whatsapp.net",
      },
      {
        ...msg(
          "recover-in-" + employeeId,
          "IN 09:00",
          1,
          yesterdayStart + 9 * 3600,
        ),
        sender: phone + "@s.whatsapp.net",
      },
    ];
    const requestHistory = async (_, body) => {
      const offset = previousOut || body.cursor ? 1 : 0;
      return {
        messages: [recoveryMessages[offset]],
        cursor: recoveryMessages[offset].id,
        hasMore: offset === 0,
      };
    };
    const makeRecovery = () =>
      createWhatsAppService({
        query,
        transaction,
        audit,
        now: () => recoveryNow,
        request: requestHistory,
      });
    let recovery = makeRecovery();
    if (previousOut) {
      assert.equal(
        (await recovery.ingest(recoveryMessages[0], "test")).state,
        "review",
      );
      await recovery.poll();
    } else {
      await recovery.poll();
      const progress = (await recovery.config()).syncProgress;
      assert.equal(progress.phase, "fetch");
      assert.ok(progress.cutoff < recoveryMessages[1].timestamp);
      recovery = makeRecovery(); // Persisted cursor/cutoff must survive restart.
      await recovery.poll();
      await recovery.poll();
    }
    assert.equal(recovery.status.error, null);
    const recovered = await query(
      "SELECT * FROM attendance WHERE employeeId=?",
      [employeeId],
    );
    if (autoApprove) {
      assert.equal(recovered[0].inTime, "09:00");
      assert.equal(recovered[0].outTime, "19:00");
    } else {
      assert.equal(recovered.length, 0);
      assert.equal(
        (
          await query(
            "SELECT * FROM whatsapp_events WHERE employeeId=? AND state='review'",
            [employeeId],
          )
        ).length,
        2,
      );
    }
  }
  console.log(
    "PASS: OUT widens IN history search beyond incremental cutoff, restart pagination, matching and approval-off protection.",
  );
  // Selected-day sync is durable and does not advance the normal checkpoint.
  const selectedDay = new Date(yesterdayStart * 1000)
    .toISOString()
    .slice(0, 10);
  await resetSync({
    enabled: true,
    autoApprove: false,
    since: 0,
    checkedThrough: 123,
    lastHistoryScan: 456,
    syncProgress: {
      phase: "fetch",
      cursor: null,
      scanned: 0,
      startedAt: Math.floor(recoveryNow / 1000),
      fullScan: false,
      dates: [selectedDay],
      cutoff: 0,
    },
  });
  const scoped = createWhatsAppService({
    query,
    transaction,
    audit,
    now: () => recoveryNow,
    request: async () => ({
      messages: [
        msg("scoped-today", "IN 10:00", 9, recoveryNow / 1000),
        msg("scoped-yesterday", "IN 10:00", 9, yesterdayStart + 36000),
      ],
      hasMore: false,
    }),
  });
  await scoped.poll();
  assert.equal(scoped.status.error, null);
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='scoped-today'",
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await query(
        "SELECT * FROM whatsapp_events WHERE messageId='scoped-yesterday'",
      )
    )[0].state,
    "review",
  );
  assert.equal((await scoped.config()).checkedThrough, 123);
  assert.equal((await scoped.config()).lastHistoryScan, 456);

  // Day lists use group-local dayMidnight, paginate, and clear only selected dates.
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...cfg,
      enabled: false,
      groupId: "days@g.us",
      timeZone: "Asia/Kolkata",
    }),
  ]);
  const dayMidnight = Date.parse("2026-10-20T18:30:00Z") / 1000;
  for (let i = 0; i < 102; i++)
    await query(
      "INSERT INTO whatsapp_events (id,sessionId,groupId,messageId,senderId,senderName,text,timestamp,state,reason) VALUES (?, 'test','days@g.us',?,'phone:919000000001','Test','IN 10:00',?,'review','Awaiting approval')",
      ["day" + String(i).padStart(61, "0"), "day-" + i, dayMidnight + i],
    );
  await query(
    "INSERT INTO whatsapp_events (id,sessionId,groupId,messageId,senderId,senderName,text,timestamp,state,reason) VALUES (?, 'test','days@g.us','previous-day','phone:919000000001','Test','IN 10:00',?,'review','Awaiting approval')",
    ["b".repeat(64), dayMidnight - 1],
  );
  const listDay = async (queryParams) => {
    let result;
    await routes.get("GET /api/whatsapp/messages")(
      { query: queryParams },
      {
        json(data) {
          result = data;
        },
      },
    );
    return result;
  };
  let page = await listDay({ date: "2026-10-21" });
  assert.equal(page.events.length, 100);
  assert.equal(page.hasMore, true);
  page = await listDay({ date: "2026-10-21", offset: 100 });
  assert.equal(page.events.length, 2);
  assert.equal(page.hasMore, false);
  assert.equal((await listDay({ date: "2026-10-20" })).events.length, 1);
  await routes.get("DELETE /api/whatsapp/events")(
    { body: { dates: ["2026-10-21"] } },
    { json() {} },
  );
  assert.equal((await listDay({ date: "2026-10-21" })).events.length, 0);
  assert.equal(
    (await listDay({ date: "2026-10-21", history: "archived" })).events.length,
    100,
  );
  assert.equal((await listDay({ date: "2026-10-20" })).events.length, 1);
  await assert.rejects(() => listDay({ date: "2026-02-30" }));
  console.log(
    "PASS: selected-day sync/checkpoints, timezone day boundaries, message pagination and scoped archive.",
  );

  {
    // Edits must never apply automatically, even with both automatic flags enabled.
    const editConfig = {
      ...cfg,
      groupId: "123@g.us",
      enabled: true,
      since: t - 86400,
      autoApprove: true,
      autoOverwrite: true,
      allowEditedMessages: false,
    };
    await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
      JSON.stringify(editConfig),
    ]);
    const inserted = await query(
      "INSERT INTO employees (name,department,role,status,phone) VALUES ('Edit test','Sales','Staff','Active','+919000000099')",
    );
    const employeeId = inserted.insertId;
    const editedMsg = {
      ...msg("edit-review-test", "IN 10:00"),
      sender: "919000000099@s.whatsapp.net",
    };
    assert.equal((await service.ingest(editedMsg, "test")).state, "applied");
    const readTime = async () =>
      (
        await query("SELECT inTime FROM attendance WHERE employeeId=?", [
          employeeId,
        ])
      )[0].inTime;
    assert.equal(await readTime(), "10:00");
    editedMsg.content = "IN 10:30";
    editedMsg.isEdited = true;
    assert.equal(
      (await service.ingest(editedMsg, "test", true, true)).state,
      "review",
    );
    assert.equal(await readTime(), "10:00");
    const [editedEvent] = await query(
      "SELECT * FROM whatsapp_events WHERE messageId='edit-review-test'",
    );
    assert.equal(editedEvent.isEdited, 1);
    assert.equal(editedEvent.previousText, "IN 10:00");
    assert.equal(
      (await service.retryEvent(editedEvent.id, true)).state,
      "review",
    );
    editConfig.allowEditedMessages = true;
    await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
      JSON.stringify(editConfig),
    ]);
    assert.equal(
      (await service.ingest(editedMsg, "test", true, true)).state,
      "review",
    );
    assert.equal(await readTime(), "10:00");
    assert.equal(
      (await service.retryEvent(editedEvent.id, true)).state,
      "applied",
    );
    assert.equal(await readTime(), "10:30");
    // Malformed times remain visible and can be corrected manually without changing source text.
    const badMsg = {
      ...editedMsg,
      id: "bad-time-correction",
      content: "IN wrong",
      isEdited: false,
    };
    assert.equal((await service.ingest(badMsg, "test")).state, "review");
    const [badEvent] = await query(
      "SELECT * FROM whatsapp_events WHERE messageId='bad-time-correction'",
    );
    const correction = {
      expectedText: badMsg.content,
      employeeId,
      date: new Date(t * 1000).toISOString().slice(0, 10),
      action: "in",
      time: "11:00",
    };
    await assert.rejects(
      () =>
        service.retryEvent(badEvent.id, true, {
          ...correction,
          expectedText: "stale",
        }),
      /Message changed/,
    );
    assert.equal(
      (await service.retryEvent(badEvent.id, false, correction)).state,
      "review",
    );
    assert.equal(
      (await service.ingest(badMsg, "test", true, true)).state,
      "review",
    );
    assert.equal(await readTime(), "10:30");
    assert.equal(
      (await service.retryEvent(badEvent.id, true, correction)).state,
      "applied",
    );
    assert.equal(await readTime(), "11:00");
    assert.equal(
      (
        await query("SELECT text FROM whatsapp_events WHERE id=?", [
          badEvent.id,
        ])
      )[0].text,
      "IN wrong",
    );
    const editSync = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async () => ({
        messages: [{ ...editedMsg, content: "IN 11:15" }],
        hasMore: false,
      }),
    });
    await editSync.poll();
    assert.equal(editSync.status.error, null);
    const [syncedEdit] = await query(
      "SELECT * FROM whatsapp_events WHERE id=?",
      [editedEvent.id],
    );
    assert.equal(syncedEdit.text, "IN 11:15");
    assert.equal(syncedEdit.state, "review");
    assert.equal(await readTime(), "11:00");
    const approveRoute = routes.get("POST /api/whatsapp/approve");
    await assert.rejects(
      () =>
        approveRoute(
          { body: { id: editedEvent.id, expectedText: "stale" } },
          { json() {} },
        ),
      /Message changed/,
    );
    let routeResult;
    await approveRoute(
      { body: { id: editedEvent.id, expectedText: "IN 11:15" } },
      {
        json(value) {
          routeResult = value;
        },
      },
    );
    assert.equal(routeResult.state, "applied");
    assert.equal(await readTime(), "11:15");
    const firstSeenEdit = {
      ...editedMsg,
      id: "first-seen-edit",
      content: "IN 11:20",
    };
    assert.equal(
      (await service.ingest(firstSeenEdit, "test", true, true)).state,
      "review",
    );
    assert.equal(await readTime(), "11:15");
    const groupMessage = {
      ...editedMsg,
      id: "manual-selection",
      content: "At work",
      isEdited: false,
    };
    const browser = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async (route, body) =>
        route === "/chats/messages"
          ? {
              messages: [
                groupMessage,
                { ...groupMessage, id: "arbitrary", content: "Hello everyone" },
                {
                  ...groupMessage,
                  id: "both-times",
                  content: "Update: In time 9:15 AM, Out time 7:05 PM",
                },
                {
                  ...groupMessage,
                  id: "photo",
                  type: "image",
                  content: null,
                  caption: "Team lunch",
                },
              ],
              hasMore: false,
            }
          : { message: groupMessage },
    });
    await browser.scanGroupMessages({ start: true });
    const listed = await browser.groupMessages({ date: correction.date });
    assert.equal(listed.messages.length, 4);
    assert.ok(listed.messages.some((m) => m.content === "Hello everyone"));
    assert.ok(listed.messages.some((m) => m.type === "image"));
    const times = listed.messages.find((m) => m.id === "both-times");
    assert.equal(times.inTime, "09:15");
    assert.equal(times.outTime, "19:05");
    assert.equal(times.attendanceState, null);
    assert.equal(listed.scan.state, "complete");
    await assert.rejects(
      () =>
        browser.selectGroupMessage({
          messageId: groupMessage.id,
          sessionId: "test",
          groupId: "different@g.us",
        }),
      /Group changed/,
    );
    const selected = await browser.selectGroupMessage({
      messageId: groupMessage.id,
      sessionId: "test",
      groupId: "123@g.us",
    });
    assert.equal(selected.state, "review");
    assert.equal(selected.manualOnly, 1);
    assert.equal(await readTime(), "11:15");
    assert.equal(
      (await browser.ingest(groupMessage, "test", true, true)).state,
      "review",
    );
    assert.equal(await readTime(), "11:15");
    const selectedAgain = await browser.selectGroupMessage({
      messageId: groupMessage.id,
      sessionId: "test",
      groupId: "123@g.us",
    });
    assert.equal(selectedAgain.id, selected.id);
    assert.equal(
      (
        await browser.retryEvent(selected.id, true, {
          ...correction,
          expectedText: "At work",
          time: "11:25",
        })
      ).state,
      "applied",
    );
    assert.equal(await readTime(), "11:25");
    await browser.clearGroupMessages({
      sessionId: "test",
      groupId: "123@g.us",
      date: correction.date,
    });
    assert.equal((await browser.groupMessages()).messages.length, 0);
    assert.equal(
      (await browser.groupMessages({ history: true })).messages.length,
      4,
    );
    await browser.scanGroupMessages({ start: true });
    assert.equal((await browser.groupMessages()).messages.length, 0);
    assert.equal(await readTime(), "11:25");
    const paged = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async (_route, body) =>
        body.cursor
          ? {
              messages: [
                {
                  ...groupMessage,
                  id: "page-two",
                  content: "No attendance pattern",
                },
              ],
              hasMore: false,
            }
          : {
              messages: [
                {
                  ...groupMessage,
                  id: "page-one",
                  content: "General announcement",
                },
              ],
              hasMore: true,
              cursor: "next-page",
            },
    });
    assert.equal(
      (await paged.scanGroupMessages({ start: true })).scan.state,
      "scanning",
    );
    assert.equal((await paged.scanGroupMessages()).scan.state, "complete");
    assert.equal((await paged.groupMessages()).messages.length, 2);
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const blocked = createWhatsAppService({
      query,
      transaction,
      audit,
      request: async () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const inflight = blocked.scanGroupMessages({ start: true });
    await waiting;
    await blocked.clearGroupMessages({
      sessionId: "test",
      groupId: "123@g.us",
    });
    release({
      messages: [{ ...groupMessage, id: "late-page", content: "Late fetch" }],
      hasMore: false,
    });
    await inflight;
    assert.equal((await blocked.groupMessages()).messages.length, 0);
    console.log(
      "PASS: multi-page unfiltered scan and clear invalidating an in-flight page.",
    );
    console.log(
      "PASS: unfiltered group scan, media/non-attendance retention, both time hints, scoped archive and deduplication.",
    );
    console.log(
      "PASS: group message listing, source validation, idempotent selection, manual-only review and corrected approval.",
    );
    console.log(
      "PASS: edited-message opt-in, manual-only approval, preserved original attendance, correction validation and explicit overwrite.",
    );
  }
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
