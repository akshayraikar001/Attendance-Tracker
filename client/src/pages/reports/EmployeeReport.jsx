import React, { useState } from "react";
import DateNavigator, {
  RangeNavigator,
} from "../../components/common/DateNavigator.jsx";
import { dateRange, holidayForDate } from "../../../../shared/calendar.js";
import { useTimeFormatter } from "../../components/common/TimeDisplay.jsx";
import { downloadAttendanceWorkbook } from "../../utils/exportWorkbook.js";
const hours = (n) => (n == null ? "—" : `${Math.floor(n / 60)}h ${n % 60}m`);
export default function EmployeeReport({
  employees,
  records,
  rules,
  holidays,
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [id, setId] = useState(""),
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const clock = useTimeFormatter(),
    person = employees.find((e) => String(e.id) === id),
    dates = dateRange(from, to);
  const byDate = new Map(
    records.filter((r) => String(r.employeeId) === id).map((r) => [r.date, r]),
  );
  const rows = person
    ? dates.map((date) => ({
        ...person,
        ...byDate.get(date),
        date,
        employeeId: person.id,
        status:
          byDate.get(date)?.status ||
          (holidayForDate(date, holidays, rules.weeklyOffDays ?? [0])
            ? "Holiday"
            : "Unmarked"),
      }))
    : [];
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadAttendanceWorkbook(rows, {
        filename: `employee-${person.id}-${from}-${to}.xlsx`,
      });
    } catch {
      setError("Could not export report. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card employee-report">
      <div className="card-heading">
        <div>
          <h2>Employee report</h2>
          <p>
            Individual attendance, hours, punctuality, and notes for your
            selected period.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button"
            disabled={!person || !dates.length || busy}
            onClick={download}
          >
            Export Excel
          </button>
          <button
            className="button"
            disabled={!person || !dates.length}
            onClick={() => window.print()}
          >
            Print
          </button>
        </div>
      </div>
      <div className="table-toolbar report-controls">
        <label>
          Select employee
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.status === "Inactive" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <DateNavigator
          label="Employee report from"
          value={from}
          onChange={setFrom}
        />
        <DateNavigator label="Employee report to" value={to} onChange={setTo} />
        <RangeNavigator
          from={from}
          to={to}
          onChange={(r) => {
            setFrom(r.from);
            setTo(r.to);
          }}
        />
      </div>
      {!dates.length && (
        <p className="bulk-message error-text">
          Select a valid date range of up to 366 days.
        </p>
      )}
      {error && (
        <p className="bulk-message error-text" role="alert">
          {error}
        </p>
      )}
      {person ? (
        <>
          <div className="employee-report-profile">
            <h3>{person.name}</h3>
            <p>
              {person.department} · {person.role} · {person.status}
            </p>
            <p>{person.email || "No email provided"}</p>
            <strong>
              {from} to {to}
            </strong>
          </div>
          <div className="employee-report-stats">
            {[
              "Present",
              "Absent",
              "Half day",
              "Attended",
              "In progress",
              "Holiday",
              "Unmarked",
            ].map((s) => (
              <div key={s}>
                <b className={"badge " + s.toLowerCase().replace(" ", "-")}>
                  {s}
                </b>
                <strong>{rows.filter((r) => r.status === s).length}</strong>
              </div>
            ))}
          </div>
          <div className="employee-report-totals">
            <span>
              Total hours <b>{hours(sum("workedMinutes"))}</b>
            </span>
            <span>
              Overtime <b>{hours(sum("overtimeMinutes"))}</b>
            </span>
            <span>
              Late <b>{sum("lateMinutes")}m</b>
            </span>
            <span>
              Early departure <b>{sum("earlyMinutes")}m</b>
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Date",
                    "Status",
                    "In time",
                    "Out time",
                    "Hours",
                    "Overtime",
                    "Late",
                    "Early departure",
                    "Method",
                    "Notes",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>
                      <span
                        className={
                          "badge " + r.status.toLowerCase().replace(" ", "-")
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td>{clock(r.inTime)}</td>
                    <td>
                      {clock(r.outTime)}
                      {r.overnight ? " (+1 day)" : ""}
                    </td>
                    <td>{hours(r.workedMinutes)}</td>
                    <td>{hours(r.overtimeMinutes)}</td>
                    <td>{r.lateMinutes == null ? "—" : r.lateMinutes + "m"}</td>
                    <td>
                      {r.earlyMinutes == null ? "—" : r.earlyMinutes + "m"}
                    </td>
                    <td>{r.mode || "—"}</td>
                    <td className="report-notes">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-footer">
            Manual entries have no measured hours. Unmarked days are not counted
            as absences. Breaks remain included.
          </p>
        </>
      ) : (
        <p className="empty">
          Select an employee to see their detailed report.
        </p>
      )}
    </section>
  );
}
