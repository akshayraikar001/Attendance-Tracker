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
const database = "attendance_leave_test_" + Date.now();
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
  const { registerLeave } =
    await import("../../server/src/controllers/leave.js");
  const messages = [];
  const fetches = [];
  const sync = createWhatsAppService({
    query,
    transaction,
    audit,
    request: async (_, body) => {
      fetches.push(body);
      const sorted = [...messages].sort((a, b) => b.timestamp - a.timestamp);
      const start = body.cursor
        ? sorted.findIndex((m) => m.id === body.cursor) + 1
        : 0;
      const page = sorted.slice(start, start + body.limit);
      return {
        messages: page,
        cursor: page.at(-1)?.id,
        hasMore: start + page.length < sorted.length,
      };
    },
  });
  const routes = new Map(),
    middleware = [];
  const app = {
    delete(path, handler) {
      routes.set("DELETE " + path, handler);
    },
    use(path, handler) {
      middleware.push(handler);
    },
    get(path, handler) {
      routes.set("GET " + path, handler);
    },
    put(path, handler) {
      routes.set("PUT " + path, handler);
    },
    post(path, handler) {
      routes.set("POST " + path, handler);
    },
  };
  registerLeave({
    app,
    wrap: (fn) => fn,
    query,
    transaction,
    audit,
    whatsapp: sync,
  });
  async function call(method, path, body = {}, id = null, params = {}) {
    let result;
    await routes.get(method + " " + path)(
      { body, params: { id }, query: params, user: { id: 1, role: "Admin" } },
      {
        json(value) {
          result = value;
        },
      },
    );
    return result;
  }
  let denied;
  middleware[0](
    { user: { role: "Staff" } },
    {
      status(code) {
        denied = code;
        return this;
      },
      json() {},
    },
    () => {
      throw Error("Staff should be rejected");
    },
  );
  assert.equal(denied, 403);
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...cfg,
      autoApprove: true,
      autoOverwrite: true,
      revision: 1,
    }),
  ]);
  messages.push(msg("leave-disabled", "@Bharat sir Today i am on a leave"));
  messages.push(msg("regular-in", "IN 09:30", 2, t + 1));
  await sync.poll();
  assert.equal((await query("SELECT * FROM leave_requests")).length, 0);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=2"))[0].inTime,
    "09:30",
  );
  await call("PUT", "/api/leave/config", { enabled: true });
  messages.push(
    msg(
      "leave-range",
      "@Bharat sir i will be on a leave from 8 to 10 oct",
      1,
      t + 2,
    ),
  );
  messages.push(
    msg("leave-half", "@all tommorow i may be on a halfday", 3, t + 3),
  );
  messages.push(msg("leave-unclear", "I need leave next week", 4, t + 4));
  messages.push({
    ...msg("leave-unknown", "Leave tomorrow", 5, t + 5),
    sender: "918888888888@s.whatsapp.net",
  });
  messages.push({
    ...msg("leave-private", "Leave tomorrow", 1, t + 6),
    isGroup: false,
  });
  messages.push({
    ...msg("leave-other-group", "Leave tomorrow", 1, t + 7),
    chatId: "456@g.us",
  });
  await sync.poll();
  const requests = await query(
    "SELECT * FROM leave_requests ORDER BY timestamp",
  );
  assert.equal(requests.length, 5);
  assert.ok(requests.every((r) => r.state === "pending"));
  assert.equal(
    (await query("SELECT * FROM attendance")).length,
    1,
    "Collection must never automatically approve leave",
  );
  const range = requests.find((r) => r.messageId === "leave-range");
  assert.equal(range.employeeId, 1);
  assert.equal(
    requests.find((r) => r.messageId === "leave-unknown").employeeId,
    null,
  );
  assert.equal(
    requests.find((r) => r.messageId === "leave-unclear").fromDate,
    null,
  );
  const listed = await call("GET", "/api/leave");
  assert.equal(listed.total, 5);
  assert.equal(listed.hasMore, false);
  const approval = {
    employeeId: 1,
    kind: "Absent",
    from: range.fromDate,
    to: range.toDate,
  };
  assert.equal(
    (await call("POST", "/api/leave/:id/approve", approval, range.id)).days,
    3,
  );
  const days = await query(
    "SELECT * FROM attendance WHERE employeeId=1 ORDER BY date",
  );
  assert.equal(days.length, 3);
  assert.ok(
    days.every(
      (d) =>
        d.mode === "manual" &&
        d.status === "Absent" &&
        d.inTime === null &&
        d.workedMinutes === null,
    ),
  );
  await assert.rejects(
    () => call("POST", "/api/leave/:id/approve", approval, range.id),
    (e) => e.status === 409,
  );
  await sync.poll();
  assert.equal((await query("SELECT * FROM leave_requests")).length, 5);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=1")).length,
    3,
  );
  const half = requests.find((r) => r.messageId === "leave-half");
  await call(
    "POST",
    "/api/leave/:id/approve",
    { employeeId: 3, kind: "Half day", from: half.fromDate, to: half.toDate },
    half.id,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=3"))[0].status,
    "Half day",
  );
  const unclear = requests.find((r) => r.messageId === "leave-unclear");
  await assert.rejects(() =>
    call(
      "POST",
      "/api/leave/:id/approve",
      { employeeId: 4, kind: "Absent", from: "", to: "" },
      unclear.id,
    ),
  );
  await call("POST", "/api/leave/:id/reject", {}, unclear.id);
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=4")).length,
    0,
  );
  const conflict = requests.find((r) => r.messageId === "leave-disabled");
  const current = (
    await query("SELECT * FROM attendance WHERE employeeId=2")
  )[0];
  const conflicting = {
    employeeId: 2,
    kind: "Absent",
    from: current.date,
    to: current.date,
  };
  await assert.rejects(
    () => call("POST", "/api/leave/:id/approve", conflicting, conflict.id),
    (e) => e.status === 409,
  );
  assert.deepEqual(
    (await query("SELECT * FROM attendance WHERE employeeId=2"))[0],
    current,
  );
  assert.equal(
    (
      await query("SELECT state FROM leave_requests WHERE id=?", [conflict.id])
    )[0].state,
    "pending",
  );
  await call(
    "POST",
    "/api/leave/:id/approve",
    { ...conflicting, overwrite: true },
    conflict.id,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=2"))[0].status,
    "Absent",
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=2"))[0].inTime,
    null,
  );
  // Leave can collect independently while time importing remains paused.
  const stored = await sync.config();
  await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
    JSON.stringify({
      ...stored,
      enabled: false,
      syncProgress: null,
      lastHistoryScan: 0,
      revision: stored.revision + 1,
    }),
  ]);
  messages.push(
    msg("leave-only", "Leave tomorrow", 4, t + 8),
    msg("paused-in", "IN 10:00", 5, t + 9),
  );
  await sync.poll();
  assert.ok(
    (await query("SELECT * FROM leave_requests WHERE messageId='leave-only'"))
      .length,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=5")).length,
    0,
  );
  const unknown = requests.find((r) => r.messageId === "leave-unknown");
  // A single conflict rejects the entire range; no earlier day is partially written.
  await assert.rejects(
    () =>
      call(
        "POST",
        "/api/leave/:id/approve",
        {
          employeeId: 1,
          kind: "Absent",
          from: range.fromDate.slice(0, 8) + "07",
          to: range.toDate,
        },
        unknown.id,
      ),
    (e) => e.status === 409,
  );
  assert.equal(
    (await query("SELECT * FROM attendance WHERE employeeId=1")).length,
    3,
  );
  // Re-enabling time import after leave-only syncing must catch older IN messages.
  const { createServer } = await import("node:http");
  const bridge = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: { groups: [{ id: cfg.groupId }] },
      }),
    );
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const previousURL = process.env.CHATERY_URL,
    previousPath = process.env.CHATERY_MANAGED_PATH;
  process.env.CHATERY_URL = `http://127.0.0.1:${bridge.address().port}`;
  process.env.CHATERY_MANAGED_PATH = "";
  try {
    registerWhatsApp({ app, wrap: (fn) => fn, query, transaction, audit });
    messages.push(msg("older-paused-in", "IN 10:15", 6, t - 2 * 86400));
    const beforeResume = await sync.config();
    await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
      JSON.stringify({
        ...beforeResume,
        checkedThrough: t,
        lastHistoryScan: t,
        syncProgress: null,
      }),
    ]);
    await call("PUT", "/api/whatsapp/config", {
      ...beforeResume,
      enabled: true,
    });
    assert.equal((await sync.config()).lastHistoryScan, 0);
    assert.equal((await sync.config()).leaveEnabled, true);
    await sync.poll();
    assert.equal(
      (await query("SELECT * FROM attendance WHERE employeeId=6"))[0].inTime,
      "10:15",
    );
  } finally {
    if (previousURL === undefined) delete process.env.CHATERY_URL;
    else process.env.CHATERY_URL = previousURL;
    if (previousPath === undefined) delete process.env.CHATERY_MANAGED_PATH;
    else process.env.CHATERY_MANAGED_PATH = previousPath;
    await new Promise((resolve) => bridge.close(resolve));
  }
  await call("PUT", "/api/leave/config", { enabled: false });
  const count = (await query("SELECT * FROM leave_requests")).length;
  messages.push(msg("after-pause", "Leave tomorrow", 5, t + 10));
  await sync.poll();
  assert.equal((await query("SELECT * FROM leave_requests")).length, count);
  await assert.rejects(() =>
    call(
      "POST",
      "/api/leave/:id/approve",
      {
        employeeId: 5,
        kind: "Absent",
        from: unknown.fromDate,
        to: unknown.toDate,
      },
      unknown.id,
    ),
  );
  assert.ok(
    fetches.every(
      (f) => f.sessionId === cfg.sessionId && f.chatId === cfg.groupId,
    ),
  );
  console.log(
    "PASS: gated shared fetch, all requests pending, sender matching, inclusive leave/half-day approval, deduplication, rejection, unknown dates/senders, conflict atomicity, explicit overwrite, pause, independent leave collection, and staff access restriction.",
  );
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
