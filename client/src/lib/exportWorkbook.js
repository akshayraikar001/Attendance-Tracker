// Excel serial values keep local wall-clock times unchanged across time zones.
const clockValue = (time) =>
  time
    ? (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) / 1440
    : null;
const durationValue = (minutes) => (minutes == null ? null : minutes / 1440);
const dateValue = (date) =>
  date
    ? Date.UTC(
        ...date.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)),
      ) /
        86400000 +
      25569
    : null;
export async function buildAttendanceWorkbook(
  records,
  { simple = false } = {},
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Dayline";
  const sheet = book.addWorksheet(simple ? "Daily report" : "Attendance", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const columns = simple
    ? [
        ["Name", "name", 26],
        ["In time", "inTime", 16],
        ["Out time", "outTime", 20],
        ["Total hours", "workedMinutes", 18],
        ["Status", "status", 18],
      ]
    : [
        ["Date", "date", 16],
        ["Name", "name", 26],
        ["Department", "department", 24],
        ["Status", "status", 18],
        ["Entry method", "mode", 18],
        ["In time", "inTime", 16],
        ["Out time", "outTime", 20],
        ["Total hours", "workedMinutes", 18],
        ["Late", "lateMinutes", 16],
        ["Early departure", "earlyMinutes", 20],
        ["Overtime", "overtimeMinutes", 16],
        ["Notes", "notes", 40],
      ];
  sheet.columns = columns.map(([header, key, width]) => ({
    header,
    key,
    width,
  }));
  const colors = {
    Present: ["DCFCE7", "166534"],
    Absent: ["FEE2E2", "991B1B"],
    "Half day": ["FEF3C7", "92400E"],
    Attended: ["EDE9FE", "5B21B6"],
    "In progress": ["DBEAFE", "1E40AF"],
    Unmarked: ["E5E7EB", "374151"],
    Holiday: ["F3F4F6", "6B7280"],
  };
  for (const entry of records) {
    const values = {
      ...entry,
      date: dateValue(entry.date),
      inTime: clockValue(entry.inTime),
      outTime: entry.outTime
        ? clockValue(entry.outTime) + (entry.overnight ? 1 : 0)
        : null,
      mode:
        entry.mode === "time"
          ? "In / out time"
          : entry.mode === "manual"
            ? "Direct status"
            : "",
    };
    for (const key of [
      "workedMinutes",
      "lateMinutes",
      "earlyMinutes",
      "overtimeMinutes",
    ])
      values[key] = durationValue(entry[key]);
    const row = sheet.addRow(values);
    row.height = 26;
    for (const [, key] of columns) {
      const cell = row.getCell(key);
      cell.font = { name: "Calibri", size: 12 };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (key === "date") cell.numFmt = "yyyy-mm-dd";
      if (key === "inTime" || key === "outTime")
        cell.numFmt =
          key === "outTime" && entry.overnight ? 'hh:mm "(+1 day)"' : "hh:mm";
      if (key.endsWith("Minutes")) cell.numFmt = "[h]:mm";
    }
    const status = row.getCell("status");
    const [bg, fg] = colors[entry.status] || colors.Unmarked;
    status.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF" + bg },
    };
    status.font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: "FF" + fg },
    };
  }
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF256B52" },
    };
    cell.alignment = { vertical: "middle" };
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: columns.length },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  return book;
}
export async function downloadAttendanceWorkbook(
  records,
  { filename = "dayline-attendance.xlsx", simple = false } = {},
) {
  const book = await buildAttendanceWorkbook(records, { simple });
  const bytes = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to begin reading the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function buildMonthlyWorkbook(report, month) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Monthly " + month, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Name", key: "name", width: 25 },
    { header: "Department", key: "department", width: 22 },
    ...report.days.map((day) => ({
      header: day.date.slice(-2) + " " + day.weekday,
      key: day.date,
      width: 16,
    })),
    { header: "Present", key: "present", width: 12 },
    { header: "Absent", key: "absent", width: 12 },
    { header: "Half day", key: "half", width: 12 },
    { header: "Total hours", key: "total", width: 16 },
  ];
  const colors = {
    Present: ["DCFCE7", "166534"],
    Absent: ["FEE2E2", "991B1B"],
    "Half day": ["FEF3C7", "92400E"],
    Attended: ["EDE9FE", "5B21B6"],
    "In progress": ["DBEAFE", "1E40AF"],
    Holiday: ["F3F4F6", "6B7280"],
    Unmarked: ["FFFFFF", "6B7280"],
  };
  for (const person of report.people) {
    const row = sheet.addRow({
      name: person.name,
      department: person.department,
      present: person.counts.Present,
      absent: person.counts.Absent,
      half: person.counts["Half day"],
      total: person.totalMinutes / 1440,
    });
    row.height = 42;
    row.getCell("total").numFmt = "[h]:mm";
    for (const entry of person.entries) {
      const cell = row.getCell(entry.date);
      cell.value =
        entry.status +
        (entry.workedMinutes == null
          ? ""
          : `\n${Math.floor(entry.workedMinutes / 60)}h ${entry.workedMinutes % 60}m`);
      cell.alignment = {
        wrapText: true,
        vertical: "middle",
        horizontal: "center",
      };
      const [bg, fg] = colors[entry.status] || colors.Unmarked;
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FF" + fg },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + bg },
      };
    }
  }
  sheet.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF256B52" },
    };
  });
  sheet.getRow(1).height = 25;
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  return book;
}
export async function downloadMonthlyWorkbook(report, month) {
  const book = await buildMonthlyWorkbook(report, month);
  const bytes = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `monthly-attendance-${month}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
