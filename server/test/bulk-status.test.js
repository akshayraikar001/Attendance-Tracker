import test from "node:test";
import assert from "node:assert/strict";
import { registerAdminRoutes } from "../src/controllers/admin.js";
import { defaults } from "../src/services/rules.js";

for (const status of ["Present", "Absent", "Half day", "Attended"]) {
  test(`bulk status preserves ${status} without an In time`, async () => {
    const routes = new Map();
    let saved;
    const connection = {
      execute: async (sql, values) => {
        if (sql.startsWith("SELECT rules")) return [[{ rules: defaults }]];
        if (sql.startsWith("SELECT * FROM employees"))
          return [[{ id: 1, name: "Example", status: "Active" }]];
        if (sql.startsWith("SELECT")) return [[]];
        if (sql.startsWith("INSERT INTO attendance")) saved = values;
        return [{}];
      },
    };
    registerAdminRoutes({
      app: {
        get() {},
        delete() {},
        put() {},
        post: (path, handler) => routes.set(path, handler),
      },
      wrap: (handler) => handler,
      transaction: (fn) => fn(connection),
      audit: async () => {},
      query: async () => [],
    });
    const req = {
      body: {
        employeeIds: [1],
        from: "2026-11-13",
        to: "2026-11-13",
        status,
        entryMode: "status",
        skipHolidays: false,
      },
      user: { id: 1 },
    };
    let preview;
    await routes.get("/api/attendance/bulk-attendance/preview")(req, {
      json: (value) => {
        preview = value;
      },
    });
    req.body.previewToken = preview.previewToken;
    await routes.get("/api/attendance/bulk-attendance")(req, { json() {} });
    assert.equal(saved[2], "manual");
    assert.equal(saved[6], status);
  });
}

function bulkFixture(
  existing = [],
  people = [{ id: 1, name: "Example", status: "Active" }],
) {
  const routes = new Map(),
    writes = [];
  const connection = {
    execute: async (sql, values) => {
      if (sql.startsWith("SELECT rules")) return [[{ rules: defaults }]];
      if (sql.startsWith("SELECT * FROM employees")) return [people];
      if (sql.startsWith("SELECT * FROM attendance")) return [existing];
      if (sql.startsWith("SELECT")) return [[]];
      if (sql.startsWith("INSERT INTO attendance")) writes.push(values);
      return [{}];
    },
  };
  registerAdminRoutes({
    app: { get() {}, delete() {}, put() {}, post: (p, h) => routes.set(p, h) },
    wrap: (h) => h,
    transaction: (fn) => fn(connection),
    audit: async () => {},
    query: async () => [],
  });
  const call = async (preview, body) => {
    let result;
    await routes.get(
      "/api/attendance/bulk-attendance" + (preview ? "/preview" : ""),
    )(
      {
        body: {
          employeeIds: people.map((p) => p.id),
          from: "2026-11-13",
          to: "2026-11-13",
          skipHolidays: false,
          ...body,
        },
        user: { id: 1 },
      },
      { json: (v) => (result = v) },
    );
    return result;
  };
  return { call, writes };
}
const existingTime = {
  employeeId: 1,
  date: "2026-11-13",
  mode: "time",
  status: "In progress",
  inTime: "09:30",
  outTime: null,
  overnight: 0,
};

test("bulk time preserves each filled side unless overwrite is enabled; preview matches save", async () => {
  for (const [old, input, expectedIn, expectedOut] of [
    [existingTime, { inTime: "10:00", outTime: "19:00" }, "09:30", "19:00"],
    [
      { ...existingTime, inTime: null, outTime: "18:30" },
      { inTime: "10:00", outTime: "19:00" },
      "10:00",
      "18:30",
    ],
    [
      existingTime,
      { inTime: "10:00", outTime: "19:00", overwrite: true },
      "10:00",
      "19:00",
    ],
    [
      { ...existingTime, outTime: "18:30" },
      { inTime: "10:00", overwrite: true },
      "10:00",
      "18:30",
    ],
  ]) {
    const f = bulkFixture([old]),
      body = { entryMode: "time", ...input };
    const preview = await f.call(true, body);
    assert.equal(preview.sample[0].inTime, expectedIn);
    assert.equal(preview.sample[0].outTime, expectedOut);
    assert.equal(f.writes.length, 0);
    await f.call(false, { ...body, previewToken: preview.previewToken });
    assert.equal(f.writes[0][3], expectedIn);
    assert.equal(f.writes[0][4], expectedOut);
  }
  const f = bulkFixture([{ ...existingTime, outTime: "18:30" }]);
  const preview = await f.call(true, {
    entryMode: "time",
    inTime: "10:00",
    outTime: "19:00",
  });
  assert.equal(preview.total, 0);
  assert.equal(preview.skippedExisting, 1);
});

test("bulk blocks Out-only entry for all affected people before any writes, including direct Apply", async () => {
  const f = bulkFixture(
    [existingTime],
    [
      { id: 1, name: "Example", status: "Active" },
      { id: 2, name: "Missing", status: "Active" },
    ],
  );
  for (const preview of [true, false]) {
    await assert.rejects(
      () => f.call(preview, { entryMode: "time", outTime: "19:00" }),
      /Add In time before entering Out time: Missing \(2026-11-13\)/,
    );
    assert.equal(f.writes.length, 0);
  }
  for (const [old, times] of [
    [existingTime, { outTime: "19:00" }],
    [null, { inTime: "10:00", outTime: "19:00" }],
  ]) {
    const f = bulkFixture(old ? [old] : []),
      body = { entryMode: "time", ...times };
    const p = await f.call(true, body);
    await f.call(false, { ...body, previewToken: p.previewToken });
    assert.equal(f.writes.length, 1);
  }
});

test("bulk status preserves overnight times and measured hours", async () => {
  for (const [inTime, outTime, overnight] of [
    ["22:00", "06:00", 1],
    ["09:00", "17:00", 0],
  ]) {
    const f = bulkFixture([{ ...existingTime, inTime, outTime, overnight }]);
    const body = { entryMode: "status", status: "Half day", overwrite: true };
    const p = await f.call(true, body);
    await f.call(false, { ...body, previewToken: p.previewToken });
    assert.equal(f.writes[0][3], inTime);
    assert.equal(f.writes[0][4], outTime);
    assert.equal(f.writes[0][5], Boolean(overnight));
    assert.equal(f.writes[0][6], "Half day");
    assert.equal(f.writes[0][7], 480);
  }
});

test("legacy Out-only rows do not block recalculation of valid entries", async () => {
  const { recalculateAttendance } =
    await import("../src/services/recalculate.js");
  const legacy = {
    ...existingTime,
    id: 1,
    inTime: null,
    outTime: "19:00",
    rules: defaults,
  };
  const normal = {
    ...existingTime,
    id: 2,
    employeeId: 2,
    outTime: "18:30",
    rules: defaults,
  };
  const updates = [];
  const c = {
    execute: async (sql, args) =>
      sql.startsWith("SELECT")
        ? [[legacy, normal]]
        : (updates.push(args), [{}]),
  };
  assert.equal(await recalculateAttendance(c, defaults), 1);
  assert.equal(updates[0].at(-1), 2);
  assert.equal(legacy.inTime, null);
});
