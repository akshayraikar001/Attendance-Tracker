import {
  connectTestAdmin,
  testDatabaseHost,
  testDatabasePort,
} from "../helpers/database.mjs";
import { localDate } from "../../shared/location-time.js";
// Integration check against an isolated database on the optional local MariaDB.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
const admin = await connectTestAdmin();
const database = "attendance_auth_test_" + Date.now();
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  DB_LOCAL_MANAGED: "false",
  CHATERY_MANAGED_PATH: "",
  DB_HOST: testDatabaseHost,
  DB_PORT: String(testDatabasePort),
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
  let cookie = "";
  async function request(
    path,
    body,
    {
      method = body ? "POST" : "GET",
      expected = 200,
      session = cookie,
      csrf = true,
    } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Cookie: session,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(csrf ? { "X-Requested-With": "Dayline" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return {
      result,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  assert.equal((await request("/auth/status")).result.setupRequired, true);
  await request("/employees", null, { expected: 401 });
  await request("/users", null, { expected: 401 });
  const initial = {
    name: "Real Admin",
    email: "owner@example.test",
    password: "secure-password-123",
    confirmPassword: "secure-password-123",
  };
  await request("/auth/register", initial, { csrf: false, expected: 403 });
  await request(
    "/auth/register",
    { ...initial, confirmPassword: "different" },
    { expected: 400 },
  );
  await request(
    "/auth/register",
    { ...initial, email: "invalid" },
    { expected: 400 },
  );
  await request(
    "/auth/register",
    { ...initial, password: "short", confirmPassword: "short" },
    { expected: 400 },
  );
  // Race two initial signups: exactly one must become administrator.
  const second = {
    ...initial,
    email: "second@example.test",
    name: "Second User",
    role: "Admin",
  };
  const race = await Promise.all(
    [initial, second].map((body) =>
      fetch(base + "/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "Dayline",
        },
        body: JSON.stringify(body),
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 403]);
  const winner = race.find((r) => r.status === 201);
  const initialLogin = {
    result: await winner.json(),
    cookie: winner.headers.get("set-cookie").split(";")[0],
    headers: winner.headers,
  };
  const ownerCredentials =
    initialLogin.result.email === initial.email ? initial : second;
  cookie = initialLogin.cookie;
  assert.match(initialLogin.headers.get("set-cookie"), /HttpOnly/);
  assert.match(initialLogin.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(initialLogin.result.passwordHash, undefined);
  assert.equal(
    (await request("/auth/me")).result.email,
    ownerCredentials.email,
  );
  assert.equal((await request("/auth/status")).result.setupRequired, false);
  // Exercise the actual HTTP route registration, not only isolated handlers.
  const leave = (await request("/leave")).result;
  assert.equal(leave.enabled, false);
  assert.deepEqual(leave.requests, []);
  assert.equal(leave.total, 0);
  await request("/leave/config", { enabled: false }, { method: "PUT" });
  await request("/leave/sync", {}, { expected: 400 });
  await request(
    "/auth/register",
    { ...ownerCredentials, email: ownerCredentials.email.toUpperCase() },
    { expected: 409 },
  );
  await request(
    "/auth/login",
    { ...initial, password: "wrong-password" },
    { expected: 401 },
  );
  await request("/auth/login", {
    ...ownerCredentials,
    email: ownerCredentials.email.toUpperCase(),
  });
  const [stored] = await admin.query(
    `SELECT passwordHash FROM \`${database}\`.users WHERE email=?`,
    [ownerCredentials.email],
  );
  assert.notEqual(stored[0].passwordHash, initial.password);
  assert.match(stored[0].passwordHash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  await request(
    "/auth/register",
    { ...initial, email: "other@example.test" },
    { expected: 403 },
  );
  const staff = (
    await request(
      "/users",
      {
        username: "staff",
        name: "Staff User",
        password: "staff-password-123",
        role: "Staff",
        active: true,
      },
      { expected: 201 },
    )
  ).result;
  await request(
    "/users/" + initialLogin.result.id,
    { name: "Admin", role: "Staff", active: true },
    { method: "PUT", expected: 400 },
  );
  await request(
    "/users/" + initialLogin.result.id,
    { name: "Admin", role: "Admin", active: false },
    { method: "PUT", expected: 400 },
  );
  const signedStaff = await request("/auth/login", {
    username: "staff",
    password: "staff-password-123",
  });
  const staffCookie = signedStaff.cookie;
  await request("/employees", null, { session: staffCookie });
  await request("/users", null, { session: staffCookie, expected: 403 });
  await request("/whatsapp", null, { session: staffCookie, expected: 403 });
  await request("/leave", null, { session: staffCookie, expected: 403 });
  await request(
    "/leave/config",
    { enabled: true },
    { method: "PUT", session: staffCookie, expected: 403 },
  );
  await request(
    "/whatsapp/connect",
    {},
    { session: staffCookie, expected: 403 },
  );
  const settings = (await request("/settings")).result;
  await request("/settings", settings, {
    method: "PUT",
    session: staffCookie,
    expected: 403,
  });
  await request(
    "/catalog/departments",
    { name: "Blocked" },
    { session: staffCookie, expected: 403 },
  );
  await request(
    "/employees",
    { name: "Allowed Employee", department: "Sales", role: "Sales" },
    { session: staffCookie, expected: 201 },
  );
  await request(
    "/users/" + staff.id,
    { name: "Staff User", role: "Staff", active: false },
    { method: "PUT" },
  );
  await request("/employees", null, { session: staffCookie, expected: 401 });
  await request(
    "/auth/login",
    { username: "staff", password: "staff-password-123" },
    { expected: 403 },
  );
  await request(
    "/users/" + staff.id,
    {
      name: "Staff User",
      role: "Staff",
      active: true,
      password: "reset-password-123",
    },
    { method: "PUT" },
  );
  await request(
    "/auth/login",
    { username: "staff", password: "staff-password-123" },
    { expected: 401 },
  );
  const reset = await request("/auth/login", {
    username: "staff",
    password: "reset-password-123",
  });
  await request(
    "/auth/password",
    { currentPassword: "reset-password-123", password: "changed-password-123" },
    { session: reset.cookie },
  );
  await request("/auth/me", null, { session: reset.cookie, expected: 401 });
  const changed = await request("/auth/login", {
    username: "staff",
    password: "changed-password-123",
  });
  await request("/auth/logout", {}, { session: changed.cookie });
  await request("/auth/me", null, { session: changed.cookie, expected: 401 });
  const employees = (await request("/employees")).result;
  const employeeId = employees[0].id;
  const account = {
    username: "employee",
    name: "Employee User",
    password: "employee-password-123",
    role: "Employee",
    employeeId,
    active: true,
  };
  await request("/users", { ...account, employeeId: null }, { expected: 400 });
  const employeeUser = (await request("/users", account, { expected: 201 }))
    .result;
  const employeeSession = (
    await request("/auth/login", {
      username: account.username,
      password: account.password,
    })
  ).cookie;
  for (const path of [
    "/employees",
    "/attendance",
    "/settings",
    "/users",
    "/audit",
    "/leave",
    "/time-away",
  ])
    await request(path, null, { session: employeeSession, expected: 403 });
  await request(
    "/attendance",
    { employeeId },
    { session: employeeSession, expected: 403 },
  );
  await request(
    "/time-away",
    { employeeId },
    { session: staffCookie, expected: 401 },
  );
  assert.equal(
    (await request("/me/profile", null, { session: employeeSession })).result
      .employee.id,
    employeeId,
  );
  await request("/attendance", {
    employeeId,
    date: "2026-10-07",
    mode: "manual",
    status: "Present",
    notes: "Personal attendance note",
  });
  const otherEmployee = (
    await request(
      "/employees",
      { name: "Other Employee", department: "Sales", role: "Sales" },
      { expected: 201 },
    )
  ).result;
  await request("/attendance", {
    employeeId: otherEmployee.id,
    date: "2026-10-07",
    mode: "manual",
    status: "Absent",
    notes: "Other private note",
  });
  const own = (
    await request("/me/attendance?employeeId=999", null, {
      session: employeeSession,
    })
  ).result;
  assert.ok(own.length > 0 && own.every((r) => r.employeeId === employeeId));
  assert.ok(own.some((r) => r.notes === "Personal attendance note"));
  const interval = {
    employeeId,
    date: "2026-10-07",
    departedAt: "2026-10-07T12:00",
    returnedAt: null,
    reason: "Appointment",
  };
  const away = (await request("/time-away", interval, { expected: 201 }))
    .result;
  await request("/time-away", interval, { expected: 400 });
  await request(
    "/time-away",
    { ...interval, returnedAt: "2026-10-07T11:00" },
    { expected: 400 },
  );
  await request(
    "/time-away/" + away.id,
    { ...interval, returnedAt: "2026-10-07T13:00" },
    { method: "PUT" },
  );
  await request(
    "/time-away",
    {
      ...interval,
      departedAt: "2026-10-07T12:30",
      returnedAt: "2026-10-07T14:00",
    },
    { expected: 400 },
  );
  await request(
    "/time-away",
    {
      ...interval,
      departedAt: "2026-10-07T13:00",
      returnedAt: "2026-10-07T13:30",
    },
    { expected: 201 },
  );
  await request(
    "/time-away",
    { ...interval, employeeId: otherEmployee.id },
    { expected: 201 },
  );
  const ownAway = (
    await request("/me/time-away", null, { session: employeeSession })
  ).result;
  assert.equal(ownAway.length, 2);
  const datedAway = (await request("/time-away?date=2026-10-07")).result;
  assert.equal(datedAway.length, 3);
  assert.equal(datedAway[0].departedAt, "2026-10-07 13:00:00");
  assert.equal((await request("/time-away?date=2026-10-08")).result.length, 0);
  assert.equal(
    (
      await request(
        "/me/time-away?date=2026-10-07&employeeId=" + otherEmployee.id,
        null,
        { session: employeeSession },
      )
    ).result.length,
    2,
  );
  assert.equal(
    (
      await request("/me/time-away?date=2026-10-08", null, {
        session: employeeSession,
      })
    ).result.length,
    0,
  );
  await request("/time-away?date=2026-02-30", null, { expected: 400 });
  await request("/me/time-away?date=invalid", null, {
    session: employeeSession,
    expected: 400,
  });
  assert.deepEqual(
    (await request("/me/attendance", null, { session: employeeSession }))
      .result,
    own,
  );

  await request("/time-away/" + away.id, interval, {
    method: "PUT",
    session: employeeSession,
    expected: 403,
  });
  const location = {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 12,
    capturedAt: new Date().toISOString(),
    note: "Customer visit",
  };
  const utcDay = localDate(new Date(), "Asia/Kolkata");
  const locationQuery = "?date=" + utcDay;
  await request("/me/locations", location, {
    session: employeeSession,
    expected: 403,
  });
  await request(
    "/locations/employees/" + employeeId,
    { enabled: true },
    { method: "PUT", session: employeeSession, expected: 403 },
  );
  await request(
    "/locations/employees/" + employeeId,
    { enabled: true },
    { method: "PUT" },
  );
  const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  const visit = (
    await request(
      "/me/locations",
      { ...location, photo },
      { session: employeeSession, expected: 201 },
    )
  ).result;
  await request("/me/locations", location, {
    session: employeeSession,
    expected: 201,
  });
  await request(
    "/me/locations",
    { ...location, employeeId: otherEmployee.id },
    { session: employeeSession, expected: 400 },
  );
  await request(
    "/me/locations",
    { ...location, latitude: 91 },
    { session: employeeSession, expected: 400 },
  );
  await request(
    "/me/locations",
    { ...location, capturedAt: "2020-01-01T00:00:00.000Z" },
    { session: employeeSession, expected: 400 },
  );
  await request(
    "/me/locations",
    { ...location, photo: "data:image/png;base64,SGVsbG8=" },
    { session: employeeSession, expected: 400 },
  );
  await request("/locations/config", null, {
    session: employeeSession,
    expected: 403,
  });
  await request(
    "/locations/config",
    { embedKey: "test-embed-key", geocodingKey: "test-private-geocoding-key" },
    { method: "PUT" },
  );
  const config = (await request("/locations/config")).result;
  assert.deepEqual(config, {
    provider: "google",
    geoapifyConfigured: false,
    embedConfigured: true,
    geocodingConfigured: true,
  });
  assert.ok(!JSON.stringify(config).includes("test-private"));
  await request("/locations/config", { geocodingKey: "" }, { method: "PUT" });
  assert.deepEqual((await request("/locations/config")).result, {
    provider: "google",
    geoapifyConfigured: false,
    embedConfigured: true,
    geocodingConfigured: false,
  });
  await request(
    "/locations/config",
    { provider: "geoapify", geoapifyKey: "private-geoapify-test-key" },
    { method: "PUT" },
  );
  const geoConfig = (await request("/locations/config")).result;
  assert.equal(geoConfig.provider, "geoapify");
  assert.equal(geoConfig.geoapifyConfigured, true);
  const geoList = (
    await request("/me/locations" + locationQuery, null, {
      session: employeeSession,
    })
  ).result;
  assert.equal(geoList.mapProvider, "geoapify");
  assert.equal(geoList.mapsConfigured, true);
  assert.equal(geoList.mapsKey, "");
  assert.ok(!JSON.stringify(geoList).includes("private-geoapify"));
  await request(
    "/locations/config",
    { provider: "geoapify", geoapifyKey: "" },
    { method: "PUT" },
  );
  await request("/location-maps/" + visit.id, null, {
    session: employeeSession,
    expected: 400,
  });
  await request("/locations/config", { provider: "google" }, { method: "PUT" });
  const noArea = (
    await request("/location-areas/" + visit.id, null, {
      session: employeeSession,
    })
  ).result;
  assert.equal(noArea.status, "unconfigured");
  await request(
    "/locations?employeeId=" + employeeId + "&from=2026-10-01&to=2026-10-02",
    null,
    { expected: 400 },
  );
  const visits = (
    await request(
      "/me/locations" + locationQuery + "&employeeId=" + otherEmployee.id,
      null,
      { session: employeeSession },
    )
  ).result;
  assert.equal(visits.records.length, 2);
  assert.equal(visits.records[1].id, visit.id);
  assert.equal(visits.timeZone, "Asia/Kolkata");
  assert.equal(visits.date, utcDay);
  assert.equal(visits.geocodingKey, undefined);
  assert.ok(visits.records.every((r) => r.employeeId === employeeId));
  assert.equal(
    (
      await request(
        "/locations" + locationQuery + "&employeeId=" + otherEmployee.id,
      )
    ).result.records.length,
    0,
  );
  await request(
    "/locations" + locationQuery + "&employeeId=" + employeeId,
    null,
    { session: employeeSession, expected: 403 },
  );
  await request("/me/locations/" + visit.id, location, {
    method: "PUT",
    session: employeeSession,
    expected: 403,
  });
  const image = await fetch(base + "/location-photos/" + visit.id, {
    headers: { Cookie: employeeSession },
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  const otherAccount = {
    username: "other.employee",
    name: "Other Employee",
    role: "Employee",
    employeeId: otherEmployee.id,
    password: "other-password-123",
    active: true,
  };
  await request("/users", otherAccount, { expected: 201 });
  const otherSession = (
    await request("/auth/login", {
      username: otherAccount.username,
      password: otherAccount.password,
    })
  ).cookie;
  await request("/location-maps/" + visit.id, null, {
    session: otherSession,
    expected: 404,
  });
  await request("/location-areas/" + visit.id, null, {
    session: otherSession,
    expected: 404,
  });
  await request("/location-photos/" + visit.id, null, {
    session: otherSession,
    expected: 404,
  });
  await request("/location-photos/" + visit.id, null, {
    session: "",
    expected: 401,
  });
  const currentStaff = (
    await request("/auth/login", {
      username: "staff",
      password: "changed-password-123",
    })
  ).cookie;
  await request(
    "/me/locations" + locationQuery + "&employeeId=" + employeeId,
    null,
    { session: currentStaff, expected: 403 },
  );
  await request("/location-photos/" + visit.id, null, {
    session: currentStaff,
    expected: 403,
  });
  await request(
    "/locations/employees/" + employeeId,
    { enabled: false },
    { method: "PUT" },
  );
  await request("/me/locations", location, {
    session: employeeSession,
    expected: 403,
  });
  assert.equal(
    (await request("/locations" + locationQuery + "&employeeId=" + employeeId))
      .result.records.length,
    2,
  );
  await request("/locations/" + visit.id, null, {
    method: "DELETE",
    session: employeeSession,
    expected: 403,
  });
  await request("/locations/" + visit.id, null, {
    method: "DELETE",
    session: currentStaff,
    expected: 403,
  });
  await request("/locations/" + visit.id, null, { method: "DELETE" });
  await request("/locations/" + visit.id, null, {
    method: "DELETE",
    expected: 404,
  });
  await request("/location-photos/" + visit.id, null, {
    session: employeeSession,
    expected: 404,
  });
  const afterDelete = (
    await request("/me/locations" + locationQuery, null, {
      session: employeeSession,
    })
  ).result;
  assert.equal(afterDelete.records.length, 1);
  assert.ok(!afterDelete.records.some((r) => r.id === visit.id));
  // Filtering follows local capture date even if server receipt has a different date.
  await admin.query(
    `UPDATE \`${database}\`.location_checkins SET capturedAt='2026-01-01 19:00:00', receivedAt='2026-01-03 00:00:00' WHERE id=?`,
    [afterDelete.records[0].id],
  );
  const localDayVisits = (
    await request("/me/locations?date=2026-01-02", null, {
      session: employeeSession,
    })
  ).result;
  assert.equal(localDayVisits.records.length, 1);
  assert.equal(
    (
      await request("/me/locations?date=2026-01-01", null, {
        session: employeeSession,
      })
    ).result.records.length,
    0,
  );
  assert.equal(
    (await request("/me/locations", null, { session: employeeSession })).result
      .date,
    localDate(new Date(), "Asia/Kolkata"),
  );
  assert.deepEqual((await request("/audit")).result, []);
  await request(
    "/users/" + employeeUser.id,
    { ...account, active: false },
    { method: "PUT" },
  );
  await request("/me/attendance", null, {
    session: employeeSession,
    expected: 401,
  });
  const listed = (await request("/users")).result;
  assert.ok(listed.every((u) => !u.passwordHash && !u.password));
  const audits = (await request("/audit")).result;
  assert.ok(!JSON.stringify(audits).includes("password-123"));
  assert.ok(!JSON.stringify(audits).includes("test-private-geocoding-key"));
  await admin.query(
    `UPDATE \`${database}\`.sessions SET expiresAt=DATE_SUB(NOW(), INTERVAL 1 DAY)`,
  );
  await request("/auth/me", null, { expected: 401 });
  console.log(
    "PASS: location permissions, immutable check-ins, coordinate/photo validation and private photos; employee isolation, read-only enforcement, time-away validation/overlap/returns, admin-only signup, password confirmation, duplicate emails, concurrent first-admin creation, password hashing, login, secure cookie flags, CSRF checks, protected routes, role enforcement, self-lockout protection, disabled accounts, password reset/change, logout, expiry, and secret-free responses/audit.",
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
