import { useTimeFormatter } from "../../components/common/TimeDisplay.jsx";
import { holidayForDate } from "../../../../shared/calendar.js";
import DateNavigator from "../../components/common/DateNavigator.jsx";
import React, { useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Clock, Ellipsis } from "lucide-react";

const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hours = (minutes) =>
  minutes == null ? "—" : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

const statuses = [
  ["Present", "P"],
  ["Half day", "½"],
  ["Attended", "AT"],
  ["Absent", "A"],
  ["In progress", "IP"],
  ["Holiday", "H"],
  ["Unmarked", "—"],
];
const tone = (status) => "cal-" + status.toLowerCase().replaceAll(" ", "-");

export default function AttendanceCalendar({
  employees,
  records,
  holidays,
  weeklyOffDays = [0],
  date,
  setDate,
  onEdit,
  onHolidaySave,
  canManageHolidays = true,
  individual = false,
}) {
  const clock = useTimeFormatter();
  const [reportOpen, setReportOpen] = useState(false);
  const [month, setMonth] = useState(date.slice(0, 7));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewDate, setPreviewDate] = useState(null);
  const closePreview = useRef(null);
  useEffect(() => {
    if (!previewDate) return;
    const prior = document.activeElement;
    closePreview.current?.focus();
    const close = (e) => {
      if (e.key === "Escape") setPreviewDate(null);
      if (e.key === "Tab") {
        e.preventDefault();
        closePreview.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      prior?.focus();
    };
  }, [previewDate]);
  const holiday = holidayForDate(date, holidays, weeklyOffDays);
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  useEffect(() => {
    setName(holiday?.name || "");
    setError("");
  }, [date, holiday?.name]);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const count = new Date(year, monthNumber, 0).getDate();
  const recordsByDate = new Map();
  for (const record of records) {
    if (!recordsByDate.has(record.date)) recordsByDate.set(record.date, []);
    recordsByDate.get(record.date).push(record);
  }
  const activeEmployees = employees.filter((e) => e.status === "Active");
  const previewEntries = recordsByDate.get(previewDate) || [];
  const previewHoliday =
    previewDate && holidayForDate(previewDate, holidays, weeklyOffDays);
  const previewPeople = employees
    .filter(
      (e) =>
        e.status === "Active" ||
        previewEntries.some((r) => r.employeeId === e.id),
    )
    .map((e) => ({
      ...e,
      attendanceStatus:
        previewEntries.find((r) => r.employeeId === e.id)?.status ||
        (previewHoliday ? "Holiday" : "Unmarked"),
    }));
  const dayRecords = recordsByDate.get(date) || [];
  const rows = employees
    .filter(
      (e) =>
        e.status === "Active" || dayRecords.some((r) => r.employeeId === e.id),
    )
    .map((e) => ({
      ...e,
      entry: dayRecords.find((r) => r.employeeId === e.id),
    }));
  const summary = [
    "Present",
    "Half day",
    "Attended",
    "Absent",
    "In progress",
    holiday ? "Holiday" : "Unmarked",
  ].map((status) => [
    status,
    rows.filter(
      (e) => (e.entry?.status || (holiday ? "Holiday" : "Unmarked")) === status,
    ).length,
  ]);
  function moveMonth(offset) {
    const next = localDate(new Date(year, monthNumber - 1 + offset, 1));
    setMonth(next.slice(0, 7));
    setDate(next);
  }
  async function saveHoliday(active) {
    setBusy(true);
    setError("");
    try {
      await onHolidaySave(date, { name: active ? name : holiday.name, active });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="calendar-workspace">
      {previewDate && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewDate(null);
          }}
        >
          <section
            className="modal calendar-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-preview-title"
          >
            <div className="modal-header">
              <h2 id="calendar-preview-title">Attendance · {previewDate}</h2>
              <button
                ref={closePreview}
                className="button"
                onClick={() => setPreviewDate(null)}
              >
                Close preview
              </button>
            </div>
            {individual ? (
              <div className="settings-inner">
                <h3>{employees[0]?.name}</h3>
                <p
                  className={`calendar-status-badge ${tone(previewEntries[0]?.status || (previewHoliday ? "Holiday" : "Unmarked"))}`}
                >
                  {previewEntries[0]?.status ||
                    (previewHoliday ? "Holiday" : "Unmarked")}
                </p>
                <p>
                  In {clock(previewEntries[0]?.inTime)} · Out{" "}
                  {clock(previewEntries[0]?.outTime)}
                  {previewEntries[0]?.overnight ? " (+1 day)" : ""}
                </p>
                <p>
                  Recorded hours · {hours(previewEntries[0]?.workedMinutes)}
                </p>
                {previewHoliday && <p>Holiday · {previewHoliday.name}</p>}
              </div>
            ) : (
              <>
                <div className="day-summary">
                  {statuses.map(([status, abbr]) => (
                    <span
                      key={status}
                      className={`calendar-summary-tile ${tone(status)}`}
                      title={status}
                    >
                      <strong>
                        {abbr}{" "}
                        {
                          previewPeople.filter(
                            (p) => p.attendanceStatus === status,
                          ).length
                        }
                      </strong>
                      <span>{status}</span>
                    </span>
                  ))}
                </div>
                <h3>Absent employees</h3>
                {previewPeople.some((p) => p.attendanceStatus === "Absent") ? (
                  <ul>
                    {previewPeople
                      .filter((p) => p.attendanceStatus === "Absent")
                      .map((p) => (
                        <li key={p.id}>
                          {p.name}{" "}
                          <small className="muted">{p.department}</small>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted">No employees marked Absent.</p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <section
        className="card attendance-calendar"
        aria-label="Attendance calendar"
      >
        <div className="card-heading">
          <h2>
            {first.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <div className="heading-actions">
            <button
              className="button"
              disabled={busy}
              aria-label="Previous month"
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                const now = localDate(new Date());
                setMonth(now.slice(0, 7));
                setDate(now);
              }}
            >
              Today
            </button>
            <button
              className="button"
              disabled={busy}
              aria-label="Next month"
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="calendar-legend" aria-label="Attendance colour legend">
          {statuses.map(([status, abbreviation]) => (
            <span key={status} className={tone(status)}>
              <i aria-hidden="true" />
              {abbreviation} · {status}
            </span>
          ))}
        </div>
        <div className="calendar-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span className="weekday" key={d}>
              {d}
            </span>
          ))}
          {Array.from({ length: (first.getDay() + 6) % 7 }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const key = `${month}-${String(i + 1).padStart(2, "0")}`;
            const h = holidayForDate(key, holidays, weeklyOffDays);
            const entries = recordsByDate.get(key) || [];
            const entry = individual ? entries[0] : null;
            const individualStatus =
              entry?.status || (h ? "Holiday" : "Unmarked");
            const absent = entries
              .filter((r) => r.status === "Absent")
              .map(
                (r) =>
                  employees.find((e) => e.id === r.employeeId)?.name || r.name,
              )
              .filter(Boolean);
            const missing = activeEmployees.filter(
              (e) => !entries.some((r) => r.employeeId === e.id),
            ).length;
            const counts = statuses
              .map(([status, abbreviation]) => ({
                status,
                abbreviation,
                count:
                  entries.filter((r) => r.status === status).length +
                  ((h ? "Holiday" : "Unmarked") === status ? missing : 0),
              }))
              .filter((s) => s.count > 0);
            const worked = entries.filter((r) => r.workedMinutes != null);
            const totalMinutes = worked.reduce(
              (n, r) => n + r.workedMinutes,
              0,
            );
            const description = individual
              ? `${employees[0]?.name || "Employee"}: ${individualStatus}. In ${clock(entry?.inTime)}, Out ${clock(entry?.outTime)}${entry?.overnight ? " (+1 day)" : ""}. ${hours(entry?.workedMinutes)} recorded hours.`
              : `${worked.length ? hours(totalMinutes) + " recorded hours. " : "No measured hours. "}${counts.map((s) => `${s.count} ${s.status}`).join(", ")}`;
            return (
              <div className="calendar-cell" key={key}>
                <button
                  disabled={busy}
                  aria-label={`View ${key}${h ? `, ${h.name}` : ""}`}
                  aria-pressed={date === key}
                  aria-current={
                    key === localDate(new Date()) ? "date" : undefined
                  }
                  aria-describedby={`calendar-details-${key}`}
                  title={description}
                  className={`calendar-day ${date === key ? "selected" : ""} ${h?.weekly ? "is-weekly-holiday" : h ? "is-holiday" : ""}`}
                  onClick={() => setDate(key)}
                >
                  <strong className="calendar-date-number">{i + 1}</strong>
                  {h && (
                    <span className="holiday-name" title={h.name}>
                      {h.name}
                    </span>
                  )}
                  <span className="calendar-day-hours">
                    {worked.length ? hours(totalMinutes) : "—"}
                    <span className="calendar-hours-label"> hours</span>
                  </span>
                  <span className="calendar-status-strip" aria-hidden="true">
                    {counts.map((s) => (
                      <span
                        key={s.status}
                        className={tone(s.status)}
                        style={{ flexGrow: s.count }}
                      />
                    ))}
                  </span>
                  {individual ? (
                    <>
                      <span
                        className={`calendar-individual-status ${tone(individualStatus)}`}
                      >
                        {individualStatus}
                      </span>
                      <span className="calendar-individual-times">
                        <span>In {clock(entry?.inTime)}</span>
                        <span>
                          Out {clock(entry?.outTime)}
                          {entry?.overnight ? " (+1 day)" : ""}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="calendar-day-counts" aria-hidden="true">
                        {counts
                          .filter((s) => s.status !== "Unmarked")
                          .map((s) => (
                            <span key={s.status} className={tone(s.status)}>
                              {s.abbreviation} {s.count}
                            </span>
                          ))}
                      </span>
                      <small className="calendar-recorded">
                        {entries.length} recorded
                      </small>
                      {!!absent.length && (
                        <span
                          className="calendar-absentees"
                          title={absent.join(", ")}
                        >
                          Absent: {absent.slice(0, 2).join(", ")}
                          {absent.length > 2 ? ` +${absent.length - 2}` : ""}
                        </span>
                      )}
                    </>
                  )}
                  <span
                    className="calendar-sr-only"
                    id={`calendar-details-${key}`}
                  >
                    {description}
                  </span>
                </button>
                <button
                  className="calendar-preview-trigger"
                  aria-label={`Preview attendance for ${key}`}
                  onClick={() => setPreviewDate(key)}
                >
                  <Ellipsis size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <section
        className="card calendar-day-report"
        aria-label="Selected day report"
      >
        <div className="card-heading">
          <div>
            <h2>Day report · {date}</h2>
            <p>
              {holiday ? `Holiday · ${holiday.name}` : "Working day"} ·{" "}
              {individual ? employees[0]?.name : `${rows.length} employees`}
            </p>
          </div>
          <button
            className="button"
            aria-expanded={reportOpen}
            aria-controls="calendar-day-report-content"
            onClick={() => setReportOpen((open) => !open)}
          >
            {reportOpen ? "Collapse day report" : "Expand day report"}
          </button>
        </div>
        <div id="calendar-day-report-content" hidden={!reportOpen}>
          <div className="settings-inner">
            <DateNavigator
              label="Selected day"
              value={date}
              onChange={(v) => v && setDate(v)}
            />
          </div>
          <div className="day-summary">
            {summary.map(([status, count]) => (
              <span
                key={status}
                className={`calendar-summary-tile ${tone(status)}`}
              >
                <strong>{count}</strong>
                <span>{status}</span>
              </span>
            ))}
            <span className="calendar-summary-tile calendar-total-hours">
              <strong>
                <Clock size={16} aria-hidden="true" />{" "}
                {hours(
                  dayRecords.reduce((n, r) => n + (r.workedMinutes || 0), 0),
                )}
              </strong>
              <span>Recorded hours</span>
            </span>
          </div>
          {canManageHolidays && (
            <form
              className="holiday-editor"
              onSubmit={(e) => {
                e.preventDefault();
                saveHoliday(true);
              }}
            >
              <label htmlFor="holiday-name">
                {holiday ? "Edit holiday" : "Mark this day as a holiday"}
              </label>
              <div className="heading-actions">
                <input
                  id="holiday-name"
                  placeholder="Holiday name"
                  required
                  maxLength={100}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy ? "Saving…" : holiday ? "Save holiday" : "Add holiday"}
                </button>
                {holiday && !holiday.weekly && (
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => saveHoliday(false)}
                  >
                    Remove holiday
                  </button>
                )}
              </div>
              <p>
                Applies to all employees. Recorded attendance and hours are
                preserved.
              </p>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
          <div className="table-scroll">
            <table className="calendar-people-table" role="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>In / Out</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry, ...e }) => (
                  <tr key={e.id}>
                    <td
                      data-label="Employee"
                      className="calendar-employee-name"
                    >
                      {e.name}
                      <small className="calendar-department">
                        {e.department}
                      </small>
                    </td>
                    <td data-label="In / Out">
                      {clock(entry?.inTime)} / {clock(entry?.outTime)}
                      {entry?.overnight ? " (+1 day)" : ""}
                    </td>
                    <td data-label="Hours">
                      <span
                        className={`calendar-hours-badge ${tone(entry?.status || (holiday ? "Holiday" : "Unmarked"))}`}
                      >
                        {hours(entry?.workedMinutes)}
                      </span>
                    </td>
                    <td data-label="Status">
                      <span
                        className={`calendar-status-badge ${tone(entry?.status || (holiday ? "Holiday" : "Unmarked"))}`}
                      >
                        {entry?.status || (holiday ? "Holiday" : "Unmarked")}
                      </span>
                    </td>
                    <td data-label="Action" className="calendar-edit-cell">
                      {onEdit && (
                        <button
                          className="button"
                          disabled={e.status !== "Active"}
                          aria-label={`Edit attendance for ${e.name}`}
                          onClick={() => onEdit({ employeeId: e.id, date })}
                        >
                          {entry ? "Edit" : "Record"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="empty">
                Add employees to start recording attendance.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
