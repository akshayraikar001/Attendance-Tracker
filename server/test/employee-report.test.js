import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildEmployeeReport,
  employeeMonthRows,
  reportFilename,
} from "../src/services/employee-report.js";
import { attendanceNotes } from "../../shared/attendance-notes.js";
import { buildAttendanceWorkbook } from "../../client/src/utils/exportWorkbook.js";
const employee = { id: 1, name: "Akshay Raj Rao" };
const records = [
  {
    employeeId: 1,
    date: "2026-10-01",
    status: "Present",
    inTime: "10:00",
    outTime: "19:00",
    workedMinutes: 540,
    overtimeMinutes: 60,
    notes: "Imported from WhatsApp",
  },
  {
    employeeId: 2,
    date: "2026-10-01",
    status: "Absent",
    notes: "OTHER EMPLOYEE PRIVATE NOTE",
  },
];
const input = {
  employee,
  month: "2026-10",
  records,
  rules: { weeklyOffDays: [0] },
  holidays: [],
};
test("monthly reports isolate employee records and retain unmarked/holiday dates", () => {
  const rows = employeeMonthRows(
    employee,
    input.month,
    records,
    [],
    input.rules,
  );
  assert.equal(rows.length, 31);
  assert.equal(rows[0].status, "Present");
  assert.equal(rows[0].notes, "Auto from WA");
  assert.equal(rows[3].status, "Holiday");
  assert.equal(rows[1].status, "Unmarked");
  assert.equal(JSON.stringify(rows).includes("OTHER EMPLOYEE"), false);
  assert.equal(employeeMonthRows(employee, "2024-02", [], [], {}).length, 29);
  assert.equal(
    reportFilename(employee.name, "2026-10", "pdf"),
    "Akshay R Oct Attendence.pdf",
  );
  assert.equal(
    reportFilename("Akshay", "2026-10", "xlsx"),
    "Akshay Oct Attendence.xlsx",
  );
});
test("automatic notes are shortened without deleting personal notes", () => {
  assert.equal(
    attendanceNotes(
      "Personal note\nAuto Out time: 7:05 PM — no Out time received by 8:00 PM.\nImported from WhatsApp",
    ),
    "Personal note\n!! Auto Out time Added\nAuto from WA",
  );
  assert.equal(attendanceNotes("Keep my note"), "Keep my note");
});
test("simple Excel omits times, notes and methods; detailed Excel retains only own details", async () => {
  for (const detail of ["simple", "detailed"]) {
    const file = await buildEmployeeReport({
      ...input,
      detail,
      format: "xlsx",
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.bytes);
    const s = book.worksheets[0];
    const values = JSON.stringify(s.getSheetValues());
    assert.equal(values.includes("OTHER EMPLOYEE"), false);
    assert.equal(s.getRow(3).getCell(1).value, "Date");
    assert.equal(s.getRow(3).getCell(2).value, "Status");
    assert.equal(s.columnCount, detail === "simple" ? 2 : 5);
    assert.equal(values.includes("Auto from WA"), false);
    assert.equal(s.getRow(4).getCell(2).fill.fgColor.argb, "FFDCFCE7");
    for (const forbidden of [
      "Late",
      "Early departure",
      "Entry method",
      "Overtime",
      "Notes",
    ])
      assert.equal(s.getRow(3).values.includes(forbidden), false);
  }
});
test("both PDF variants are generated as documents within the connector size limit", async () => {
  for (const detail of ["simple", "detailed"]) {
    const file = await buildEmployeeReport({ ...input, detail, format: "pdf" });
    assert.equal(file.bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(file.bytes.toString("latin1").includes("%%EOF"));
    assert.ok(file.bytes.toString("base64").length < 90 * 1024);
    assert.equal(file.filename, "Akshay R Oct Attendence.pdf");
  }
});
test("employee Excel export hides Late/Early/Method without altering general exports", async () => {
  const employeeBook = await buildAttendanceWorkbook(records, {
    employeeReport: true,
  });
  const general = await buildAttendanceWorkbook(records);
  for (const header of ["Late", "Early departure", "Entry method"]) {
    assert.equal(
      employeeBook.worksheets[0].getRow(1).values.includes(header),
      false,
    );
    assert.equal(general.worksheets[0].getRow(1).values.includes(header), true);
  }
});
