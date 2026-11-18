import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3001/api";
async function request(path, data, method = "POST", expected = 200) {
  const response = await fetch(
    base + path,
    data
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : undefined,
  );
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}
assert.equal((await request("/health")).ok, true);
const employee = await request(
  "/employees",
  {
    name: "Smoke Test Employee",
    email: `smoke-${Date.now()}@example.test`,
    department: "Testing",
    role: "QA",
    status: "Active",
  },
  "POST",
  201,
);
const original = await request("/settings");
try {
  await request(
    "/settings",
    {
      ...original,
      fullDayHours: 8,
      halfDayHours: 4,
      shiftStart: "09:00",
      shiftEnd: "18:00",
      graceMinutes: 15,
      overtimeAfterHours: 8,
      breakMinutes: 60,
    },
    "PUT",
  );
  const entry = {
    employeeId: employee.id,
    date: "2026-10-01",
    mode: "time",
    inTime: "09:30",
    outTime: "19:00",
    overnight: false,
    notes: "API smoke test",
  };
  let result = await request("/attendance", entry);
  assert.equal(result.status, "Present");
  assert.equal(result.workedMinutes, 570);
  assert.equal(result.lateMinutes, 30);
  assert.equal(result.overtimeMinutes, 90);
  await request("/attendance", {
    ...entry,
    mode: "manual",
    status: "Half day",
  });
  let records = await request("/attendance?from=2026-10-01&to=2026-10-01");
  let matching = records.filter((r) => r.employeeId === employee.id);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].workedMinutes, null);
  assert.equal(matching[0].inTime, null);
  assert.equal(matching[0].status, "Half day");
  await request("/attendance", { ...entry, outTime: "08:00" }, "POST", 400);
  await request("/attendance", { ...entry, date: "2026-02-30" }, "POST", 400);
  await request("/settings", { ...original, halfDayHours: 24 }, "PUT", 400);
  const log = await request("/audit");
  assert.ok(
    log.some(
      (a) => a.entityId === employee.id && a.action === "Attendance updated",
    ),
  );
  await request(
    "/employees/" + employee.id,
    { ...employee, status: "Inactive" },
    "PUT",
  );
  await request("/attendance", entry, "POST", 400);
  console.log(
    "PASS: MySQL health, employee create/update, rule updates, computed attendance, manual overwrite, unique employee/date, input rejection, inactivity, and audit log.",
  );
  console.log("Test employee ID: " + employee.id);
} finally {
  await request("/settings", original, "PUT");
}
