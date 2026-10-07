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
const database = "attendance_admin_test_" + Date.now();
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  DB_LOCAL_MANAGED: "false",
  CHATERY_MANAGED_PATH: "",
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
  const setup = spawnSync(process.execPath, ["server/src/database/setup.js"], {
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
  const first = await api(
    "/employees",
    { name: "Developer Test", department: "Engineering", role: "Developer" },
    "POST",
    201,
  );
  const second = await api(
    "/employees",
    { name: "Sales Test", department: "Sales", role: "Sales" },
    "POST",
    201,
  );
  assert.equal(first.department, "Development");
  let settings = await api("/settings");
  const originalEntries = await api("/attendance");
  await api("/settings", { ...settings, timeFormat: "24h" });
  assert.equal((await api("/settings")).timeFormat, "24h");
  await api("/settings", { ...settings, timeFormat: "12h" });
  assert.equal((await api("/settings")).timeFormat, "12h");
  assert.deepEqual(await api("/attendance"), originalEntries);
  console.log(
    "PASS: time format persists across API reads and does not create attendance.",
  );
  settings = {
    ...settings,
    weeklyOffDays: [0],
    groupRules: {
      Development: { ...settings, shiftStart: "10:00", shiftEnd: "19:00" },
    },
  };
  await api("/settings", settings);
  await api(
    "/attendance",
    {
      employeeId: first.id,
      date: "2026-10-01",
      mode: "time",
      inTime: "10:00",
      outTime: "18:00",
    },
    "POST",
  );
  await api("/holidays/2026-10-05", { name: "Team holiday" });
  const payload = {
    employeeIds: [first.id, second.id],
    from: "2026-10-01",
    to: "2026-10-07",
    skipHolidays: true,
    overwrite: false,
    notes: "Range absence",
  };
  const before = await api("/attendance");
  let preview = await api("/attendance/bulk-absence/preview", payload, "POST");
  assert.equal(preview.create, 9);
  assert.equal(preview.replace, 0);
  assert.equal(preview.skippedHolidays, 4);
  assert.equal(preview.skippedExisting, 1);
  assert.deepEqual(await api("/attendance"), before);
  await api("/attendance/bulk-absence", payload, "POST", 409);
  await api(
    "/attendance",
    {
      employeeId: second.id,
      date: "2026-10-02",
      mode: "manual",
      status: "Attended",
    },
    "POST",
  );
  await api(
    "/attendance/bulk-absence",
    { ...payload, previewToken: preview.previewToken },
    "POST",
    409,
  );
  preview = await api("/attendance/bulk-absence/preview", payload, "POST");
  assert.equal(preview.create, 8);
  await api(
    "/attendance/bulk-absence",
    { ...payload, previewToken: preview.previewToken },
    "POST",
  );
  let all = await api("/attendance");
  assert.equal(all.length, 10);
  assert.equal(all.filter((r) => r.status === "Absent").length, 8);
  assert.equal(
    all.find((r) => r.employeeId === first.id && r.date === "2026-10-01")
      .status,
    "Present",
  );
  assert.ok(!all.some((r) => ["2026-10-04", "2026-10-05"].includes(r.date)));
  await api(
    "/attendance",
    {
      employeeId: first.id,
      date: "2026-10-04",
      mode: "time",
      inTime: "10:00",
      outTime: "18:00",
    },
    "POST",
  );
  assert.equal(
    (await api("/attendance")).find((r) => r.date === "2026-10-04").status,
    "Present",
  );
  const replace = {
    ...payload,
    employeeIds: [first.id],
    to: "2026-10-01",
    overwrite: true,
  };
  preview = await api("/attendance/bulk-absence/preview", replace, "POST");
  assert.equal(preview.replace, 1);
  await api(
    "/attendance/bulk-absence",
    { ...replace, previewToken: preview.previewToken },
    "POST",
  );
  const replaced = (await api("/attendance")).find(
    (r) => r.employeeId === first.id && r.date === "2026-10-01",
  );
  assert.equal(replaced.status, "Absent");
  assert.equal(replaced.inTime, null);
  assert.equal(replaced.workedMinutes, null);
  const explicitHoliday = {
    ...payload,
    employeeIds: [second.id],
    from: "2026-10-04",
    to: "2026-10-04",
    skipHolidays: false,
  };
  preview = await api(
    "/attendance/bulk-absence/preview",
    explicitHoliday,
    "POST",
  );
  assert.equal(preview.create, 1);
  await api(
    "/attendance/bulk-absence",
    { ...explicitHoliday, previewToken: preview.previewToken },
    "POST",
  );
  await api(
    "/attendance/bulk-absence/preview",
    { ...payload, from: "2026-10-08" },
    "POST",
    400,
  );
  await api(
    "/attendance/bulk-absence/preview",
    { ...payload, employeeIds: [99999] },
    "POST",
    400,
  );
  await api(
    "/attendance/bulk-absence/preview",
    { ...payload, from: "2024-01-01", to: "2026-10-07" },
    "POST",
    400,
  );
  // Reset only the chosen people and dates, including worked holidays.
  const reset = {
    employeeIds: [first.id],
    from: "2026-10-01",
    to: "2026-10-04",
  };
  const beforeReset = await api("/attendance");
  let resetPreview = await api("/attendance/bulk-reset/preview", reset, "POST");
  assert.equal(resetPreview.total, 4);
  assert.deepEqual(await api("/attendance"), beforeReset);
  await api("/attendance/bulk-reset", reset, "POST", 409);
  await api(
    "/attendance",
    {
      employeeId: first.id,
      date: "2026-10-02",
      mode: "manual",
      status: "Half day",
    },
    "POST",
  );
  const afterEdit = await api("/attendance");
  await api(
    "/attendance/bulk-reset",
    { ...reset, previewToken: resetPreview.previewToken },
    "POST",
    409,
  );
  assert.deepEqual(await api("/attendance"), afterEdit);
  resetPreview = await api("/attendance/bulk-reset/preview", reset, "POST");
  // A preview for absence must never authorize deletion.
  await api(
    "/attendance/bulk-reset",
    { ...reset, previewToken: preview.previewToken },
    "POST",
    409,
  );
  const cleared = await api(
    "/attendance/bulk-reset",
    { ...reset, previewToken: resetPreview.previewToken },
    "POST",
  );
  assert.equal(cleared.total, 4);
  assert.deepEqual(
    await api("/attendance"),
    afterEdit.filter(
      (r) =>
        !(
          r.employeeId === first.id &&
          r.date >= reset.from &&
          r.date <= reset.to
        ),
    ),
  );
  assert.equal(
    (await api("/attendance/bulk-reset/preview", reset, "POST")).total,
    0,
  );
  assert.ok((await api("/holidays")).some((h) => h.date === "2026-10-05"));
  await api(
    "/attendance/bulk-reset/preview",
    { ...reset, employeeIds: [] },
    "POST",
    400,
  );
  await api(
    "/attendance/bulk-reset/preview",
    { ...reset, from: "2026-10-08" },
    "POST",
    400,
  );
  await api(
    "/attendance/bulk-reset/preview",
    { ...reset, employeeIds: [99999] },
    "POST",
    400,
  );
  await api(
    "/attendance/bulk-reset/preview",
    { ...reset, from: "2024-01-01" },
    "POST",
    400,
  );
  console.log(
    "PASS: reset previews without writes, requires a fresh preview, clears selected date ranges including holiday work, preserves other attendance and holidays, validates input, and skips empty dates.",
  );
  let catalog = await api("/catalog");
  const development = catalog.departments.find((d) => d.name === "Development");
  await api("/catalog/departments/" + development.id, {
    name: "Product Development",
  });
  assert.equal(
    (await api("/employees")).find((e) => e.id === first.id).department,
    "Product Development",
  );
  const renamedSettings = await api("/settings");
  assert.equal(
    renamedSettings.groupRules["Product Development"].shiftStart,
    "10:00",
  );
  assert.equal(renamedSettings.groupRules.Development, undefined);
  await api("/catalog/departments/" + development.id, {}, "DELETE", 400);
  await api(
    "/catalog/departments/" + development.id,
    { name: "Sales" },
    "PUT",
    409,
  );
  const empty = await api(
    "/catalog/departments",
    { name: "Empty Department" },
    "POST",
    201,
  );
  await api("/catalog/departments/" + empty.id, {}, "DELETE");
  assert.ok(
    !(await api("/catalog")).departments.some(
      (d) => d.name === "Empty Department",
    ),
  );
  await api("/catalog/departments", { name: "Empty Department" }, "POST", 201);
  const salesRole = (await api("/catalog")).roles.find(
    (r) => r.name === "Sales",
  );
  await api("/catalog/roles/" + salesRole.id, { name: "Sales Associate" });
  assert.equal(
    (await api("/employees")).find((e) => e.id === second.id).role,
    "Sales Associate",
  );
  assert.ok(
    (await api("/audit")).some((e) => e.action === "Bulk absence recorded"),
  );
  console.log(
    "PASS: bulk preview, guarded apply, stale-preview rejection, overwrite opt-in, weekly/custom holiday skipping, Sunday work, ranges, department/role renames, timing preservation and empty-item removal.",
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
