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
} from "../src/rules.js";
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
