import { useTimeFormatter } from "../../components/common/TimeDisplay.jsx";
import React, { useState } from "react";
import { Download, Printer } from "lucide-react";
import DateNavigator from "../../components/common/DateNavigator.jsx";
import { monthlyData } from "../../../../shared/monthly.js";
import { downloadMonthlyWorkbook } from "../../utils/exportWorkbook.js";
const short = {
  Present: "P",
  Absent: "A",
  "Half day": "½",
  Attended: "AT",
  "In progress": "IP",
  Holiday: "H",
  Unmarked: "—",
};
const hours = (n) => (n == null ? "" : `${Math.floor(n / 60)}h ${n % 60}m`);
export default function MonthlyReport({
  employees,
  records,
  holidays,
  rules,
  onEdit,
}) {
  const clock = useTimeFormatter();
  const [month, setMonth] = useState(
      new Date().toLocaleDateString("en-CA").slice(0, 7),
    ),
    [group, setGroup] = useState("All groups"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const report = monthlyData({
    employees,
    records,
    month,
    holidays,
    weeklyOffDays: rules.weeklyOffDays ?? [0],
    department: group,
  });
  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadMonthlyWorkbook(report, month);
    } catch {
      setError("Could not export the monthly report. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card monthly-report">
      <div className="card-heading">
        <div>
          <h2>Monthly attendance · {month}</h2>
          <p>
            Statuses first, hours underneath. Select a day to record or edit
            attendance.
          </p>
        </div>
        <div className="heading-actions">
          <button className="button" disabled={busy} onClick={download}>
            <Download size={16} />
            {busy ? "Exporting…" : "Export Excel"}
          </button>
          <button className="button" onClick={() => window.print()}>
            <Printer size={16} />
            Print
          </button>
        </div>
      </div>
      <div className="table-toolbar">
        <DateNavigator
          label="Report month"
          type="month"
          value={month}
          onChange={(value) => value && setMonth(value)}
        />
        <label>
          Department
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option>All groups</option>
            {[...new Set(employees.map((e) => e.department))].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="monthly-summary">
        {["Present", "Absent", "Half day"].map((s) => (
          <div
            key={s}
            className={"month-summary " + s.toLowerCase().replace(" ", "-")}
          >
            <strong>{report.totals[s]}</strong>
            <span>{s} days</span>
          </div>
        ))}
      </div>
      <div className="monthly-legend">
        {Object.entries(short).map(([status, abbr]) => (
          <span key={status}>
            <b className={"badge " + status.toLowerCase().replace(" ", "-")}>
              {abbr}
            </b>
            {status}
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" className="error-text bulk-message">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table className="month-table">
          <thead>
            <tr>
              <th className="month-name">Employee</th>
              {report.days.map((day) => (
                <th
                  className={day.holiday ? "weekly-holiday" : ""}
                  key={day.date}
                  title={day.holiday?.name}
                >
                  <strong>{Number(day.date.slice(-2))}</strong>
                  <small>{day.weekday}</small>
                </th>
              ))}
              <th>P</th>
              <th>A</th>
              <th>½</th>
              <th>Total hours</th>
            </tr>
          </thead>
          <tbody>
            {report.people.map((person) => (
              <tr key={person.id}>
                <td className="month-name">
                  <strong>{person.name}</strong>
                  <small>{person.department}</small>
                </td>
                {person.entries.map((entry) => (
                  <td
                    key={entry.date}
                    className={
                      "month-cell " +
                      entry.status.toLowerCase().replace(" ", "-")
                    }
                  >
                    <button
                      disabled={person.status !== "Active"}
                      aria-label={`${person.name}, ${entry.date}, ${entry.status}${entry.workedMinutes != null ? ", " + hours(entry.workedMinutes) : ""}`}
                      title={
                        entry.status +
                        (entry.inTime
                          ? ` · ${clock(entry.inTime)}–${entry.outTime ? clock(entry.outTime) : "open"}`
                          : "")
                      }
                      onClick={() =>
                        onEdit({ employeeId: person.id, date: entry.date })
                      }
                    >
                      <strong>{short[entry.status]}</strong>
                      {entry.workedMinutes != null && (
                        <small>{hours(entry.workedMinutes)}</small>
                      )}
                    </button>
                  </td>
                ))}
                <td className="month-total">{person.counts.Present}</td>
                <td className="month-total">{person.counts.Absent}</td>
                <td className="month-total">{person.counts["Half day"]}</td>
                <td>{hours(person.totalMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.people.length && (
          <p className="empty">No employees for this selection.</p>
        )}
      </div>
      <p className="table-footer">
        Unrecorded holidays stay neutral. Unmarked days are not automatically
        absent. AT means attended for more than 1 minute but less than a half
        day.
      </p>
    </section>
  );
}
