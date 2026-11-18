import { holidayAdjustedRecords } from "../../../shared/calendar.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { monthDates, holidayForDate } from "../../../shared/calendar.js";
import { attendanceNotes } from "../../../shared/attendance-notes.js";
import { formatTime } from "../../../shared/time.js";

export const reportMime = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export function reportFilename(name, month, format) {
  const words = name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const person =
    words.length > 1
      ? `${words[0]} ${Array.from(words.at(-1))[0].toUpperCase()}`
      : words[0] || "Employee";
  const label = new Date(month + "-01T12:00:00Z").toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${person} ${label} Attendence.${format}`;
}
export function employeeMonthRows(employee, month, records, holidays, rules) {
  records = holidayAdjustedRecords(records, holidays, rules.weeklyOffDays ?? [0]);
  const saved = new Map(
    records.filter((r) => r.employeeId === employee.id).map((r) => [r.date, r]),
  );
  return monthDates(month).map((date) => {
    const row = saved.get(date);
    return {
      ...row,
      date,
      status:
        row?.status ||
        (holidayForDate(date, holidays, rules.weeklyOffDays ?? [0])
          ? "Holiday"
          : "Unmarked"),
      notes: attendanceNotes(row?.notes),
    };
  });
}
const statusColors = {
  Present: ["DCFCE7", "166534"],
  Absent: ["FEE2E2", "991B1B"],
  "Half day": ["FEF3C7", "92400E"],
  Attended: ["DBEAFE", "1E40AF"],
  "In progress": ["E0E7FF", "3730A3"],
  Holiday: ["F3E8FF", "6B21A8"],
  Unmarked: ["F3F4F6", "4B5563"],
};
const hours = (value) =>
  value == null ? "—" : `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`;
export async function buildEmployeeReport({
  employee,
  month,
  records,
  holidays = [],
  rules = {},
  detail,
  format,
}) {
  const rows = employeeMonthRows(employee, month, records, holidays, rules);
  const label = new Date(month + "-01T12:00:00Z").toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const detailed = detail === "detailed";
  const counts = [
    "Present",
    "Absent",
    "Half day",
    "Attended",
    "In progress",
    "Holiday",
    "Unmarked",
  ]
    .map(
      (status) =>
        `${status}: ${rows.filter((r) => r.status === status).length}`,
    )
    .join(" · ");
  const clock = (value) => formatTime(value, rules.timeFormat || "12h");
  let bytes;
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    book.creator = "Dayline";
    const sheet = book.addWorksheet("Monthly attendance");
    sheet.columns = [
      { key: "date", width: 16 },
      { key: "status", width: 18 },
      ...(detailed
        ? [
            { key: "in", width: 16 },
            { key: "out", width: 20 },
            { key: "hours", width: 16 },
          ]
        : []),
    ];
    const width = sheet.columns.length;
    for (const text of [`${employee.name} — ${label}`, counts]) {
      const row = sheet.addRow([text]);
      sheet.mergeCells(row.number, 1, row.number, width);
      row.alignment = { wrapText: true, vertical: "middle" };
      row.height = 38;
    }
    const header = sheet.addRow([
      "Date",
      "Status",
      ...(detailed ? ["In time", "Out time", "Hours"] : []),
    ]);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF256B52" },
      };
    });
    for (const r of rows) {
      const row = sheet.addRow([
        r.date,
        r.status,
        ...(detailed
          ? [
              clock(r.inTime),
              clock(r.outTime) + (r.overnight ? " (+1 day)" : ""),
              r.workedMinutes == null ? null : r.workedMinutes / 1440,
            ]
          : []),
      ]);
      row.alignment = { vertical: "middle", wrapText: true };
      row.height = 22;
      const [bg, fg] = statusColors[r.status] || statusColors.Unmarked;
      row.getCell(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + bg },
      };
      row.getCell(2).font = { bold: true, color: { argb: "FF" + fg } };
      if (detailed) {
        row.getCell(5).numFmt = "[h]:mm";
      }
    }
    if (detailed)
      sheet
        .addRow([
          "Total hours",
          "",
          "",
          "",
          rows.reduce((n, r) => n + (r.workedMinutes || 0), 0) / 1440,
        ])
        .getCell(5).numFmt = "[h]:mm";
    sheet.views = [{ state: "frozen", ySplit: 3 }];
    sheet.pageSetup = {
      orientation: detailed ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    bytes = Buffer.from(await book.xlsx.writeBuffer());
  } else {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      compress: true,
      info: {
        Title: `${employee.name} — ${label} attendance`,
        Author: "Dayline",
      },
    });
    const chunks = [];
    const complete = new Promise((resolve, reject) => {
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.font(
      fileURLToPath(new URL("../../assets/DejaVuSans.ttf", import.meta.url)),
    );
    const left = 40,
      tableWidth = doc.page.width - 80;
    const columns = detailed
      ? [
          ["Date", 100],
          ["In time", 90],
          ["Out time", 110],
          ["Hours", 90],
          ["Status", tableWidth - 390],
        ]
      : [
          ["Date", 180],
          ["Status", tableWidth - 180],
        ];
    let y;
    const heading = () => {
      doc.fontSize(19).fillColor("#256B52").text("Attendance report", left, 38);
      doc
        .fontSize(12)
        .fillColor("#222222")
        .text(employee.name, left, doc.y + 5, { width: tableWidth });
      doc
        .fontSize(10)
        .fillColor("#555555")
        .text(label + " · " + (detailed ? "With times" : "Simple attendance"));
      doc.moveDown(0.6).fontSize(8).text(counts, { width: tableWidth });
      y = doc.y + 12;
      doc.rect(left, y, tableWidth, 24).fill("#256B52");
      let x = left;
      for (const [title, width] of columns) {
        doc
          .fontSize(8)
          .fillColor("#FFFFFF")
          .text(title, x + 6, y + 7, { width: width - 12, lineBreak: false });
        x += width;
      }
      y += 24;
    };
    heading();
    for (const [index, r] of rows.entries()) {
      const values = detailed
        ? [
            r.date,
            clock(r.inTime),
            clock(r.outTime) + (r.overnight ? " (+1 day)" : ""),
            hours(r.workedMinutes),
            r.status,
          ]
        : [r.date, r.status];
      doc.fontSize(8);
      const cells = values;
      const height = Math.max(
        24,
        ...cells.map(
          (v, i) => doc.heightOfString(v, { width: columns[i][1] - 12 }) + 12,
        ),
      );
      if (y + height > doc.page.height - 55) {
        doc.addPage();
        heading();
      }
      doc
        .rect(left, y, tableWidth, height)
        .fill(index % 2 ? "#F8FAFC" : "#FFFFFF");
      let x = left;
      cells.forEach((value, i) => {
        const width = columns[i][1];
        const isStatus = i === (detailed ? 4 : 1);
        const [bg, fg] = statusColors[r.status] || statusColors.Unmarked;
        if (isStatus) doc.rect(x, y, width, height).fill("#" + bg);
        doc
          .fontSize(8)
          .fillColor(isStatus ? "#" + fg : "#222222")
          .text(value, x + 6, y + 6, { width: width - 12 });
        x += width;
      });
      y += height;
      doc
        .moveTo(left, y)
        .lineTo(left + tableWidth, y)
        .strokeColor("#E2E8F0")
        .lineWidth(0.4)
        .stroke();
    }
    if (detailed) {
      if (y + 32 > doc.page.height - 55) {
        doc.addPage();
        heading();
      }
      doc
        .fontSize(10)
        .fillColor("#256B52")
        .text(
          "Total hours: " +
            hours(rows.reduce((n, r) => n + (r.workedMinutes || 0), 0)),
          left,
          y + 14,
        );
    }
    doc.end();
    bytes = await complete;
  }
  return {
    bytes,
    filename: reportFilename(employee.name, month, format),
    mime: reportMime[format],
  };
}
