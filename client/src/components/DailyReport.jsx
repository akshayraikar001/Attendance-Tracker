import { useTimeFormatter } from "./TimeDisplay.jsx";
import DateNavigator from "./DateNavigator.jsx";
import { holidayForDate } from "../../../shared/calendar.js";
import { downloadAttendanceWorkbook } from "../lib/exportWorkbook.js";
import React, { useState } from "react";
import { Download, Printer } from "lucide-react";
export default function DailyReport({
  employees,
  records,
  date,
  setDate,
  holidays = [],
  weeklyOffDays = [0],
}) {
  const clock = useTimeFormatter();
  const [group, setGroup] = useState("All groups");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const holiday = holidayForDate(date, holidays, weeklyOffDays);
  const daily = records.filter((r) => r.date === date);
  const rows = employees
    .filter(
      (e) => e.status === "Active" || daily.some((r) => r.employeeId === e.id),
    )
    .filter((e) => group === "All groups" || e.department === group)
    .map((e) => ({
      ...e,
      ...daily.find((r) => r.employeeId === e.id),
      employeeId: e.id,
      status:
        daily.find((r) => r.employeeId === e.id)?.status ??
        (holiday ? "Holiday" : "Unmarked"),
    }));
  const groups = [...new Set(employees.map((e) => e.department))];
  const fields = ["Name", "In time", "Out time", "Total hours", "Status"];
  const values = (r) => [
    r.name,
    clock(r.inTime),
    clock(r.outTime) + (r.outTime && r.overnight ? " (+1 day)" : ""),
    r.workedMinutes == null
      ? "—"
      : `${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m`,
    r.status,
  ];
  async function download() {
    setExporting(true);
    setExportError("");
    try {
      await downloadAttendanceWorkbook(rows, {
        simple: true,
        filename: `daily-attendance-${date}.xlsx`,
      });
    } catch {
      setExportError("Could not export Excel. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="card daily-report">
      <div className="card-heading">
        <div>
          <h2>Daily report · {date}</h2>
          <p>
            {group} · {rows.length} employees
            {holiday ? ` · Holiday: ${holiday.name}` : ""}
          </p>
        </div>
        <div className="heading-actions">
          <button className="button" onClick={download} disabled={exporting}>
            <Download size={16} />
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button className="button" onClick={() => window.print()}>
            <Printer size={16} />
            Print
          </button>
        </div>
      </div>
      <div className="table-toolbar report-controls">
        <DateNavigator
          label="Day"
          value={date}
          onChange={(v) => v && setDate(v)}
          required
        />

        <label>
          Group
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option>All groups</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      {exportError && (
        <p className="error-text" role="alert">
          {exportError}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                {values(r).map((v, i) => (
                  <td key={i}>
                    {i === fields.length - 1 ? (
                      <span
                        className={
                          "badge " + r.status.toLowerCase().replaceAll(" ", "-")
                        }
                      >
                        <i aria-hidden="true" />
                        {v}
                      </span>
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">No employees in this group.</div>
        )}
      </div>
    </section>
  );
}
