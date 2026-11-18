import test from "node:test";
import assert from "node:assert/strict";
import {
  dateRange,
  addDays,
  holidayForDate,
  monthDates,
  shiftMonth,
  shiftDateRange,
} from "../../shared/calendar.js";
import { monthlyData } from "../../shared/monthly.js";
import {
  defaults,
  calculate,
  entrySchema,
  settingsSchema,
  employeeSchema,
} from "../src/services/rules.js";
test("Sunday is a neutral holiday by default, named holidays and custom weekdays work", () => {
  assert.equal(holidayForDate("2026-10-04").weekly, true);
  assert.equal(holidayForDate("2026-10-05"), null);
  assert.equal(holidayForDate("2026-10-04", [], []), null);
  assert.equal(
    holidayForDate("2026-10-04", [{ date: "2026-10-04", name: "Festival" }])
      .name,
    "Festival",
  );
  assert.equal(holidayForDate("2026-10-03", [], [6]).weekly, true);
  assert.deepEqual(settingsSchema.parse(defaults).weeklyOffDays, [0]);
});
test("date and month navigation respects leap years and inclusive ranges", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(monthDates("2028-02").length, 29);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(shiftDateRange("2026-10-01", "2026-10-07", 1), {
    from: "2026-10-08",
    to: "2026-10-14",
  });
  assert.equal(dateRange("2026-10-02", "2026-10-01").length, 0);
});
test("monthly report keeps holidays neutral while recorded Sunday attendance wins", () => {
  const employees = [
    { id: 1, name: "One", status: "Active", department: "Development" },
    { id: 2, name: "Two", status: "Active", department: "Sales" },
  ];
  const records = [
    {
      employeeId: 1,
      date: "2026-10-04",
      status: "Present",
      workedMinutes: 480,
    },
    {
      employeeId: 2,
      date: "2026-10-05",
      status: "Absent",
      workedMinutes: null,
    },
  ];
  const report = monthlyData({ employees, records, month: "2026-10" });
  assert.equal(report.days.length, 31);
  assert.equal(report.people[0].entries[3].status, "Present");
  assert.equal(report.people[1].entries[3].status, "Holiday");
  assert.equal(report.people[0].entries[4].status, "Unmarked");
  assert.equal(report.totals.Present, 1);
  assert.equal(report.totals.Absent, 1);
  assert.equal(report.people[0].totalMinutes, 480);
  const filtered = monthlyData({
    employees,
    records,
    month: "2026-10",
    department: "Sales",
  });
  assert.equal(filtered.people.length, 1);
  assert.equal(filtered.totals.Present, 0);
});
test("attended is strictly over one minute and below the half-day threshold", () => {
  const row = { mode: "time", inTime: "09:00" };
  for (const [outTime, status] of [
    ["09:01", "Absent"],
    ["09:02", "Attended"],
    ["12:59", "Attended"],
    ["13:00", "Half day"],
    ["17:00", "Present"],
  ])
    assert.equal(calculate({ ...row, outTime }, defaults).status, status);
  assert.equal(
    entrySchema.parse({
      employeeId: 1,
      date: "2026-10-01",
      mode: "manual",
      status: "Attended",
    }).status,
    "Attended",
  );
  for (const department of ["Engineering", "Engineer", "Developers"])
    assert.equal(
      employeeSchema.parse({ name: "Test User", department, role: "Developer" })
        .department,
      "Development",
    );
});

test("daily average includes only measured qualifying days and half-days are opt-in", () => {
  const input = {
    month: "2026-10",
    employees: [{ id: 1, status: "Active" }],
    records: [
      ["Present", 480],
      ["Present", 600],
      ["Half day", 240],
      ["Attended", 90],
      ["Absent", 1],
      ["Present", null],
      ["In progress", null],
      ["Half day", null],
    ].map(([status, workedMinutes], i) => ({
      employeeId: 1,
      date: `2026-10-0${i + 1}`,
      status,
      workedMinutes,
    })),
  };
  assert.equal(monthlyData(input).people[0].averageMinutes, 540);
  assert.equal(
    monthlyData({ ...input, averageIncludeHalfDays: true }).people[0]
      .averageMinutes,
    440,
  );
  assert.equal(monthlyData(input).people[0].totalMinutes, 1411);
  const halfOnly = { ...input, records: [input.records[2]] };
  assert.equal(monthlyData(halfOnly).people[0].averageMinutes, null);
  assert.equal(
    monthlyData({ ...halfOnly, averageIncludeHalfDays: true }).people[0]
      .averageMinutes,
    240,
  );
  const settings = settingsSchema.parse(defaults);
  assert.equal(settings.showDailyWorkingAverage, true);
  assert.equal(settings.averageIncludeHalfDays, false);
  const changed = settingsSchema.parse({
    ...defaults,
    showDailyWorkingAverage: false,
    averageIncludeHalfDays: true,
  });
  assert.equal(changed.showDailyWorkingAverage, false);
  assert.equal(changed.averageIncludeHalfDays, true);
});

test("monthly report and print average visibility persist independently", () => {
  for (const show of [true, false])
    for (const print of [true, false]) {
      const saved = settingsSchema.parse({
        ...defaults,
        showDailyWorkingAverage: show,
        printDailyWorkingAverage: print,
      });
      assert.equal(saved.showDailyWorkingAverage, show);
      assert.equal(saved.printDailyWorkingAverage, print);
    }
  assert.equal(
    settingsSchema.parse(defaults).printDailyWorkingAverage,
    undefined,
  );
});

test("half-day extra hours increase the Present-day average without adding days", () => {
  const input = {
    month: "2026-10",
    weeklyOffDays: [],
    halfDayHours: 4.5,
    employees: [{ id: 1, status: "Active" }],
    records: Array.from({ length: 10 }, (_, i) => ({
      employeeId: 1,
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      status: "Present",
      workedMinutes: 540,
    })).concat([
      {
        employeeId: 1,
        date: "2026-10-11",
        status: "Half day",
        workedMinutes: 360,
      },
      {
        employeeId: 1,
        date: "2026-10-12",
        status: "Half day",
        workedMinutes: 240,
      },
      {
        employeeId: 1,
        date: "2026-10-13",
        status: "Half day",
        workedMinutes: null,
      },
      {
        employeeId: 1,
        date: "2026-10-14",
        status: "Present",
        workedMinutes: null,
      },
    ]),
  };
  const avg = (options) =>
    monthlyData({ ...input, ...options }).people[0].averageMinutes;
  assert.equal(avg({}), 540);
  assert.equal(avg({ averageIncludeHalfDayOvertime: true }), 549);
  assert.equal(
    avg({ averageIncludeHalfDayOvertime: true, averageIncludeHalfDays: true }),
    549,
  );
  assert.equal(
    avg({ averageIncludeHalfDayOvertime: true, halfDayHours: 5 }),
    546,
  );
  assert.equal(
    avg({
      averageIncludeHalfDayOvertime: true,
      records: input.records.slice(10),
    }),
    null,
  );
  assert.equal(
    settingsSchema.parse(defaults).averageIncludeHalfDayOvertime,
    false,
  );
  assert.equal(
    settingsSchema.parse({ ...defaults, averageIncludeHalfDayOvertime: true })
      .averageIncludeHalfDayOvertime,
    true,
  );
});

test("half-day extra average uses dated snapshots, with custom/group/default fallback for legacy entries", () => {
  const input = {
    employees: [
      { id: 1, name: "Example", department: "Sales", status: "Active" },
    ],
    month: "2026-11",
    weeklyOffDays: [],
    averageIncludeHalfDayOvertime: true,
    halfDayHours: 4,
    records: [
      {
        employeeId: 1,
        date: "2026-11-02",
        status: "Present",
        workedMinutes: 480,
      },
      {
        employeeId: 1,
        date: "2026-11-03",
        status: "Half day",
        workedMinutes: 300,
        rules: { halfDayHours: 3 },
      },
    ],
  };
  const average = (options) =>
    monthlyData({ ...input, ...options }).people[0].averageMinutes;
  assert.equal(average({}), 600);
  const recordsWith = (rules) => [
    input.records[0],
    { ...input.records[1], rules },
  ];
  assert.equal(
    average({ records: recordsWith(JSON.stringify({ halfDayHours: 3 })) }),
    600,
  );
  assert.equal(
    average({
      records: recordsWith({ halfDayHours: 2 }),
      employeeRules: { 1: { halfDayHours: 3 } },
    }),
    660,
  );
  assert.equal(
    average({
      records: recordsWith(null),
      employeeRules: { 1: { halfDayHours: 3 } },
      groupRules: { Sales: { halfDayHours: 2 } },
    }),
    600,
  );
  assert.equal(
    average({
      records: recordsWith(null),
      groupRules: { Sales: { halfDayHours: 3 } },
    }),
    600,
  );
  assert.equal(average({ records: recordsWith("invalid") }), 540);
  assert.equal(average({ records: recordsWith({ halfDayHours: 0 }) }), 540);
  assert.equal(average({ records: [input.records[1]] }), null);
  assert.equal(average({ averageIncludeHalfDayOvertime: false }), 480);
});
