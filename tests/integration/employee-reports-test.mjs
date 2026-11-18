import {
  connectTestAdmin,
  testDatabaseHost,
  testDatabasePort,
} from "../helpers/database.mjs";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import express from "express";
import ExcelJS from "exceljs";
import { registerEmployeeReports } from "../../server/src/controllers/employee-reports.js";
let server;
const admin = await connectTestAdmin();
const database = "attendance_report_test_" + Date.now();
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

  await query(
    "INSERT INTO employees (name,phone,department,role) VALUES ('Akshay Rao','+919000000001','Sales','Staff'),('Other Employee','+919000000002','Sales','Staff'),('No Phone',NULL,'Sales','Staff')",
  );
  await query(
    "INSERT INTO attendance (employeeId,date,mode,status,inTime,outTime,workedMinutes,notes,rules) VALUES (1,'2026-10-01','time','Present','10:00','19:00',540,'Imported from WhatsApp','{}'),(2,'2026-10-01','manual','Absent',NULL,NULL,NULL,'OTHER EMPLOYEE PRIVATE NOTE','{}')",
  );
  const before = await query("SELECT * FROM attendance ORDER BY id");
  const sent = [];
  let connected = true,
    networkFailure = false,
    hold = null;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, role: req.get("Test-Role") || "Admin" };
    next();
  });
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  registerEmployeeReports({
    app,
    wrap,
    query,
    transaction,
    audit,
    send: async (path, body) => {
      if (path.endsWith("/status")) return { isConnected: connected };
      assert.equal(path, "/chats/send-document");
      sent.push(body);
      if (hold) await hold;
      if (networkFailure) throw new Error("simulated uncertain timeout");
      return { messageId: "test-message-" + sent.length };
    },
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url =
    "http://127.0.0.1:" + server.address().port + "/api/employee-reports";
  const input = {
    employeeId: 1,
    month: "2026-10",
    format: "xlsx",
    detail: "simple",
  };
  const params = "?month=2026-10&format=xlsx&detail=simple";
  async function request(path = "", body, role = "Admin") {
    const response = await fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "Test-Role": role },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  for (const role of ["Employee", "Staff"]) {
    assert.equal((await request(params, null, role)).status, 403);
    assert.equal((await request("/send", input, role)).status, 403);
    assert.equal(
      (
        await fetch(url + "/1/download" + params, {
          headers: { "Test-Role": role },
        })
      ).status,
      403,
    );
  }
  for (const invalid of [
    { month: "2026-13" },
    { employeeId: 999 },
    { format: "csv" },
  ])
    assert.ok((await request("/send", { ...input, ...invalid })).status >= 400);
  assert.equal(
    (await request("/send", { ...input, employeeId: 3 })).status,
    400,
  );
  assert.equal(sent.length, 0);
  connected = false;
  assert.equal((await request("/send", input)).status, 409);
  connected = true;
  assert.equal((await request("/send", input)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "919000000001@s.whatsapp.net");
  assert.equal(sent[0].filename, "Akshay R Oct Attendence.xlsx");
  assert.equal(
    sent[0].caption,
    "Hi Akshay, Kindly Review your October Attendence",
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    Buffer.from(sent[0].documentUrl.split(",")[1], "base64"),
  );
  assert.equal(book.worksheets[0].columnCount, 2);
  assert.equal(
    JSON.stringify(book.worksheets[0].getSheetValues()).includes(
      "OTHER EMPLOYEE",
    ),
    false,
  );
  assert.equal((await request("/send", input)).status, 409);
  assert.equal(sent.length, 1);
  let list = (await request(params)).data;
  assert.equal(list[0].delivery.state, "sent");
  assert.equal(list.find((r) => r.id === 2).delivery, null);
  assert.equal(
    (await request("?month=2026-11&format=xlsx&detail=simple")).data[0]
      .delivery,
    null,
  );
  assert.equal(
    (await request("?month=2026-10&format=xlsx&detail=detailed")).data[0]
      .delivery,
    null,
  );
  assert.equal(
    (await request("/send", { ...input, resend: true })).status,
    200,
  );
  assert.equal(sent.length, 2);
  networkFailure = true;
  assert.equal(
    (await request("/send", { ...input, detail: "detailed" })).status,
    502,
  );
  assert.equal(
    (await request("?month=2026-10&format=xlsx&detail=detailed")).data[0]
      .delivery.state,
    "unknown",
  );
  assert.equal(
    (await request("/send", { ...input, detail: "detailed" })).status,
    409,
  );
  networkFailure = false;
  // Concurrent identical sends cannot both reach the connector.
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  const prior = sent.length;
  const first = request("/send", { ...input, format: "pdf" });
  for (let n = 0; sent.length === prior && n < 100; n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, prior + 1);
  assert.equal(
    (await request("/send", { ...input, format: "pdf", resend: true })).status,
    409,
  );
  release();
  hold = null;
  assert.equal((await first).status, 200);
  const download = await fetch(
    url + "/1/download?month=2026-10&format=pdf&detail=detailed",
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /application\/pdf/);
  assert.equal(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  await query(
    "UPDATE employee_report_sends SET state='sending',updatedAt=UTC_TIMESTAMP()-INTERVAL 3 MINUTE WHERE employeeId=1 AND format='xlsx' AND detail='simple'",
  );
  assert.equal((await request(params)).data[0].delivery.state, "unknown");
  assert.deepEqual(await query("SELECT * FROM attendance ORDER BY id"), before);
  console.log(
    "PASS: monthly private report isolation, formats/downloads, permissions, sent tracking, duplicate/concurrent protection, uncertain delivery, restart recovery; attendance unchanged. No real messages sent.",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
