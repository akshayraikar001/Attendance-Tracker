// Integration check against an isolated database on the optional local MariaDB.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
const admin = await mysql.createConnection({
  socketPath: process.cwd() + "/.local/mysql.sock",
  user: "root",
});
const database = "attendance_holiday_test_" + Date.now();
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  DB_LOCAL_MANAGED: "false",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3307",
  DB_NAME: database,
  DB_USER: "attendance",
  DB_PASSWORD: "attendance_dev",
  PORT: String(port),
};
let child;
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, REFERENCES ON \`${database}\`.* TO 'attendance'@'%'`,
  );
  const setup = spawnSync(process.execPath, ["server/src/setup.js"], {
    env,
    encoding: "utf8",
  });
  assert.equal(setup.status, 0, setup.stderr);
  child = spawn(process.execPath, ["server/src/index.js"], {
    env,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const credentials = {
    name: "Test Admin",
    email: "owner@example.test",
    password: "test-password-12345",
    confirmPassword: "test-password-12345",
  };
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Dayline",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post("/auth/register", credentials)).status, 201);
  const auth = await post("/auth/login", credentials);
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get("set-cookie").split(";")[0];
  async function api(path, body, method = "PUT", status = 200) {
    const response = await fetch(
      base + path,
      body
        ? {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "Dayline",
              Cookie: cookie,
            },
            body: JSON.stringify(body),
          }
        : { headers: { Cookie: cookie } },
    );
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  const employee = await api(
    "/employees",
    { name: "Holiday Test", department: "Operations", role: "Tester" },
    "POST",
    201,
  );
  await api(
    "/attendance",
    {
      employeeId: employee.id,
      date: "2028-02-29",
      mode: "time",
      inTime: "09:00",
      outTime: "18:00",
    },
    "POST",
  );
  const before = await api("/attendance");
  assert.deepEqual(await api("/holidays"), []);
  await api("/holidays/2028-02-29", { name: "Team holiday" });
  assert.equal((await api("/holidays"))[0].name, "Team holiday");
  await api("/holidays/2028-02-29", { name: "Updated holiday" });
  assert.equal((await api("/holidays")).length, 1);
  assert.equal((await api("/holidays"))[0].name, "Updated holiday");
  await api("/holidays/2027-02-29", { name: "Invalid day" }, "PUT", 400);
  await api("/holidays/2028-03-01", { name: " " }, "PUT", 400);
  await api("/holidays/2028-02-29", { name: "Updated holiday", active: false });
  assert.deepEqual(await api("/holidays"), []);
  assert.deepEqual(await api("/attendance"), before);
  const events = (await api("/audit")).filter((e) => e.entity === "holiday");
  assert.equal(events.length, 3);
  assert.ok(events.some((e) => e.action === "Holiday removed"));
  await api("/holidays/2028-02-29", { name: "Restored holiday" });
  assert.equal((await api("/holidays"))[0].name, "Restored holiday");
  console.log(
    "PASS: holiday persistence, rename, removal, restoration, validation, audit, and preservation of recorded attendance.",
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
