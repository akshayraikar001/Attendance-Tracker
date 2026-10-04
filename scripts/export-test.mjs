import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildAttendanceWorkbook,
  buildMonthlyWorkbook,
} from "../client/src/lib/exportWorkbook.js";
const entries = [
  {
    date: "2026-10-01",
    name: "वैष्णवी, José",
    department: "Sales",
    mode: "time",
    inTime: "09:30",
    outTime: "17:43",
    workedMinutes: 433,
    status: "Present",
    overtimeMinutes: 30,
    lateMinutes: 0,
    earlyMinutes: 77,
  },
  {
    date: "2026-10-01",
    name: "=1+1",
    status: "In progress",
    mode: "time",
    inTime: "22:00",
    outTime: null,
    workedMinutes: null,
  },
  {
    date: "2026-10-01",
    name: "Night worker",
    status: "Present",
    mode: "time",
    inTime: "22:00",
    outTime: "07:00",
    overnight: true,
    workedMinutes: 480,
  },
];
for (const simple of [true, false]) {
  const book = await buildAttendanceWorkbook(entries, { simple });
  const bytes = await book.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  const sheet = loaded.worksheets[0];
  const keys = {};
  sheet.getRow(1).eachCell((c, i) => {
    keys[c.value] = i;
  });
  const cell = (row, key) => sheet.getRow(row).getCell(keys[key]);
  assert.equal(cell(2, "Name").value, "वैष्णवी, José");
  assert.equal(cell(3, "Name").value, "=1+1");
  assert.equal(cell(3, "Name").type, ExcelJS.ValueType.String);
  // ExcelJS loads clock cells with time formats as Date objects; durations remain numbers.
  const clock = cell(2, "In time").value;
  assert.equal(clock.getUTCHours(), 9);
  assert.equal(clock.getUTCMinutes(), 30);
  const out = cell(2, "Out time").value;
  assert.equal(out.getUTCHours(), 17);
  assert.equal(out.getUTCMinutes(), 43);
  const duration = cell(2, "Total hours").value;
  const serial =
    duration instanceof Date ? duration.getTime() / 86400000 + 25569 : duration;
  assert.ok(Math.abs(serial * 1440 - 433) < 0.00001);
  assert.equal(cell(2, "Total hours").numFmt, "[h]:mm");
  assert.equal(cell(3, "Out time").value, null);
  assert.equal(cell(3, "Total hours").value, null);
  assert.equal(cell(4, "Out time").numFmt, 'hh:mm "(+1 day)"');
  if (simple) assert.equal(sheet.columnCount, 5);
  else
    assert.equal(
      cell(2, "Date").value.toISOString().slice(0, 10),
      "2026-10-01",
    );
}
console.log(
  "PASS: Excel round trip preserves Unicode names, literal strings, clock times, durations, blanks, dates and overnight notation.",
);

const { monthlyData } = await import("../shared/monthly.js");
const report = monthlyData({
  month: "2026-10",
  employees: [
    { id: 1, name: "वैष्णवी", department: "Sales", status: "Active" },
  ],
  records: [
    {
      employeeId: 1,
      date: "2026-10-01",
      status: "Present",
      workedMinutes: 460,
    },
    {
      employeeId: 1,
      date: "2026-10-02",
      status: "Half day",
      workedMinutes: 240,
    },
    {
      employeeId: 1,
      date: "2026-10-03",
      status: "Absent",
      workedMinutes: null,
    },
    {
      employeeId: 1,
      date: "2026-10-11",
      status: "Present",
      workedMinutes: 480,
    },
  ],
});
const monthly = await buildMonthlyWorkbook(report, "2026-10");
const loadedMonthly = new ExcelJS.Workbook();
await loadedMonthly.xlsx.load(await monthly.xlsx.writeBuffer());
const sheet = loadedMonthly.worksheets[0];
assert.equal(sheet.getCell("A2").value, "वैष्णवी");
assert.equal(sheet.getCell("C2").value, "Present\n7h 40m");
assert.equal(sheet.getCell("F2").value, "Holiday");
assert.equal(sheet.getCell("F2").fill.fgColor.argb, "FFF3F4F6");
assert.equal(sheet.getCell("M2").value, "Present\n8h 0m");
assert.equal(sheet.getCell("AH2").value, 2);
assert.equal(sheet.getCell("AI2").value, 1);
assert.equal(sheet.getCell("AJ2").value, 1);
assert.equal(sheet.getCell("AK2").numFmt, "[h]:mm");
const total = sheet.getCell("AK2").value;
const serial =
  total instanceof Date ? total.getTime() / 86400000 + 25569 : total;
assert.ok(Math.abs(serial * 1440 - 1180) < 0.00001);
console.log(
  "PASS: Monthly Excel preserves daily statuses, neutral Sundays, Sunday attendance, Unicode names and measured totals.",
);
