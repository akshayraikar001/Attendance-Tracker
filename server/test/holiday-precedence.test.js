import test from "node:test";
import assert from "node:assert/strict";
import { holidayAdjustedRecords } from "../../shared/calendar.js";
import { monthlyData } from "../../shared/monthly.js";
import { employeeMonthRows } from "../src/services/employee-report.js";

test("adding/removing holidays updates absence totals without modifying saved entries", () => {
  const employee = { id: 1, status: "Active" };
  const records = [{ employeeId: 1, date: "2026-11-02", status: "Absent" }];
  const holidays = [{ date: "2026-11-02", name: "Holiday" }];
  const input = { employees: [employee], records, month: "2026-11", weeklyOffDays: [] };
  assert.equal(monthlyData(input).totals.Absent, 1);
  const report = monthlyData({ ...input, holidays });
  assert.equal(report.totals.Absent, 0);
  assert.equal(report.totals.Holiday, 1);
  assert.equal(employeeMonthRows(employee, input.month, records, holidays, {weeklyOffDays: []})[1].status, "Holiday");
  assert.equal(holidayAdjustedRecords(records, holidays, [])[0].status, "Holiday");
  assert.equal(records[0].status, "Absent");
  assert.equal(monthlyData(input).totals.Absent, 1);
  assert.equal(holidayAdjustedRecords(records, [{...holidays[0], active: false}], [])[0].status, "Absent");
});

test("weekly holidays neutralize absence and preserve recorded work", () => {
  const records = ["Absent", "Present", "Half day", "Attended", "In progress"].map(status => ({date: "2026-11-01", status}));
  assert.deepEqual(holidayAdjustedRecords(records).map(r => r.status), ["Holiday", "Present", "Half day", "Attended", "In progress"]);
  assert.equal(holidayAdjustedRecords(records, [], [])[0].status, "Absent");
});
