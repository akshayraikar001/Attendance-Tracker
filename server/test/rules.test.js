import test from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  defaults,
  ruleSchema,
  entrySchema,
  employeeSchema,
  settingsSchema,
  resolveRules,
} from "../src/rules.js";
const entry = {
  mode: "time",
  inTime: "09:00",
  outTime: "18:00",
  overnight: false,
};
test("full day includes all time between clock-in and clock-out", () =>
  assert.deepEqual(calculate(entry, defaults), {
    status: "Present",
    workedMinutes: 540,
    lateMinutes: 0,
    earlyMinutes: 0,
    overtimeMinutes: 60,
  }));
test("half-day threshold is inclusive", () =>
  assert.equal(
    calculate({ ...entry, outTime: "13:00" }, defaults).status,
    "Half day",
  ));
test("recorded work below half day counts as attended", () =>
  assert.equal(
    calculate({ ...entry, outTime: "12:59" }, defaults).status,
    "Attended",
  ));
test("late grace boundary and early departure", () => {
  assert.equal(
    calculate({ ...entry, inTime: "09:15" }, defaults).lateMinutes,
    0,
  );
  const r = calculate(
    { ...entry, inTime: "09:16", outTime: "17:00" },
    defaults,
  );
  assert.equal(r.lateMinutes, 16);
  assert.equal(r.earlyMinutes, 60);
});
test("overtime uses elapsed hours", () =>
  assert.equal(
    calculate({ ...entry, outTime: "20:00" }, defaults).overtimeMinutes,
    180,
  ));
test("overnight shift", () => {
  const r = calculate(
    { ...entry, inTime: "22:00", outTime: "07:00", overnight: true },
    { ...defaults, shiftStart: "22:00", shiftEnd: "07:00" },
  );
  assert.equal(r.workedMinutes, 540);
  assert.equal(r.earlyMinutes, 0);
});
test("reversed times rejected", () =>
  assert.throws(() => calculate({ ...entry, outTime: "08:00" }, defaults)));
test("manual entries never invent measured hours", () =>
  assert.deepEqual(
    calculate({ mode: "manual", status: "Half day" }, defaults),
    {
      status: "Half day",
      workedMinutes: null,
      lateMinutes: null,
      earlyMinutes: null,
      overtimeMinutes: null,
    },
  ));
test("invalid thresholds and missing times rejected", () => {
  assert.equal(
    ruleSchema.safeParse({ ...defaults, halfDayHours: 9 }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ employeeId: 1, date: "2026-02-30", mode: "time" })
      .success,
    false,
  );
});

test("clock-in only remains in progress and records lateness without inventing hours", () => {
  const open = entrySchema.parse({
    employeeId: 1,
    date: "2026-10-01",
    mode: "time",
    inTime: "09:25",
    outTime: "",
  });
  assert.equal(open.outTime, null);
  assert.deepEqual(calculate(open, defaults), {
    status: "In progress",
    workedMinutes: null,
    lateMinutes: 25,
    earlyMinutes: null,
    overtimeMinutes: null,
  });
  assert.equal(
    calculate({ ...open, outTime: "18:30" }, defaults).status,
    "Present",
  );
});
test("clock-out can be omitted but clock-in is still required", () => {
  const open = entrySchema.parse({
    employeeId: 1,
    date: "2026-10-01",
    mode: "time",
    inTime: "09:00",
  });
  assert.equal(open.outTime, null);
  assert.equal(calculate(open, defaults).lateMinutes, 0);
  assert.equal(
    entrySchema.safeParse({ ...open, inTime: "", outTime: "18:00" }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...open, outTime: "25:00" }).success,
    false,
  );
});

test("optional emails normalize to null while invalid addresses are rejected", () => {
  const employee = {
    name: "Test Person",
    department: "Operations",
    role: "Associate",
  };
  for (const email of [undefined, null, "", "   "])
    assert.equal(employeeSchema.parse({ ...employee, email }).email, null);
  assert.equal(
    employeeSchema.parse({ ...employee, email: " team@example.com " }).email,
    "team@example.com",
  );
  assert.equal(
    employeeSchema.safeParse({ ...employee, email: "invalid" }).success,
    false,
  );
});

test("timing rules resolve employee, group, then workspace and validate nested overrides", () => {
  const employee = { id: 15, department: "Sales" };
  const group = { ...defaults, shiftStart: "10:00", shiftEnd: "19:00" };
  const individual = { ...group, shiftStart: "11:00", shiftEnd: "20:00" };
  const settings = settingsSchema.parse({
    ...defaults,
    groupRules: { Sales: group },
    employeeRules: { 15: individual },
  });
  assert.equal(resolveRules(settings, employee).shiftStart, "11:00");
  assert.equal(
    resolveRules(settings, { ...employee, id: 16 }).shiftStart,
    "10:00",
  );
  assert.equal(
    resolveRules(settings, { id: 17, department: "Engineering" }).shiftStart,
    "09:00",
  );
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      groupRules: { Sales: { ...group, halfDayHours: 12 } },
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      employeeRules: { invalid: individual },
    }).success,
    false,
  );
  const result = calculate(
    { mode: "time", inTime: "11:00", outTime: "20:00" },
    resolveRules(settings, employee),
  );
  assert.equal(result.lateMinutes, 0);
  assert.equal(result.earlyMinutes, 0);
  assert.equal(result.workedMinutes, 540);
});

test("early arrival counts as work but only excess hours earn overtime", () => {
  const policy = {
    ...defaults,
    shiftStart: "10:00",
    shiftEnd: "19:00",
    fullDayHours: 6.5,
    halfDayHours: 3,
  };
  const r = calculate(
    { mode: "time", inTime: "09:30", outTime: "17:43" },
    policy,
  );
  assert.equal(r.workedMinutes, 493);
  assert.equal(r.status, "Present");
  assert.equal(r.overtimeMinutes, 13);
  const long = calculate(
    { mode: "time", inTime: "09:00", outTime: "20:00" },
    policy,
  );
  assert.equal(long.workedMinutes, 660);
  assert.equal(long.overtimeMinutes, 180);
});
test("early arrival alone cannot turn a short visit into a full day", () => {
  const r = calculate(
    { mode: "time", inTime: "08:30", outTime: "09:15" },
    defaults,
  );
  assert.equal(r.workedMinutes, 45);
  assert.equal(r.status, "Attended");
  assert.equal(r.overtimeMinutes, 0);
});
test("overnight shift earns overtime only from excess hours", () => {
  const r = calculate(
    { mode: "time", inTime: "21:00", outTime: "07:00", overnight: true },
    { ...defaults, shiftStart: "22:00", shiftEnd: "07:00" },
  );
  assert.equal(r.status, "Present");
  assert.equal(r.workedMinutes, 600);
  assert.equal(r.overtimeMinutes, 120);
});

test("09:35 to 17:15 has no overtime and shift times never affect hour-based outcomes", () => {
  const entry = { mode: "time", inTime: "09:35", outTime: "17:15" };
  const rules = { ...defaults, fullDayHours: 6.5, halfDayHours: 3 };
  for (const [shiftStart, shiftEnd] of [
    ["09:00", "18:00"],
    ["10:00", "19:00"],
    ["08:00", "16:00"],
  ]) {
    const r = calculate(entry, { ...rules, shiftStart, shiftEnd });
    assert.equal(r.workedMinutes, 460);
    assert.equal(r.status, "Present");
    assert.equal(r.overtimeMinutes, 0);
  }
  assert.equal(
    calculate(entry, { ...rules, fullDayHours: 8 }).status,
    "Half day",
  );
  const noBreak = calculate(entry, { ...rules, breakMinutes: 0 });
  assert.equal(noBreak.workedMinutes, 460);
  assert.equal(noBreak.overtimeMinutes, 0);
});

test("legacy break settings never deduct time at any policy level", () => {
  const entry = { mode: "time", inTime: "09:35", outTime: "17:15" };
  assert.equal(
    calculate(entry, { ...defaults, breakMinutes: 60 }).workedMinutes,
    460,
  );
  const rules = settingsSchema.parse({
    ...defaults,
    breakMinutes: 60,
    groupRules: { Sales: { ...defaults, breakMinutes: 90 } },
    employeeRules: { 1: { ...defaults, breakMinutes: 120 } },
  });
  assert.equal(rules.breakMinutes, 0);
  assert.equal(rules.groupRules.Sales.breakMinutes, 0);
  assert.equal(rules.employeeRules[1].breakMinutes, 0);
});
