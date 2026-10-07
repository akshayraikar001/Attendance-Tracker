import React, { useState } from "react";
import DateNavigator from "../../components/common/DateNavigator.jsx";
import { formatTime } from "../../../../shared/time.js";
import { attendanceNotes } from "../../../../shared/attendance-notes.js";

const labels = {
  inTime: "In time",
  outTime: "Out time",
  status: "Status",
  notes: "Notes",
  workedMinutes: "Worked minutes",
  lateMinutes: "Late minutes",
  earlyMinutes: "Early minutes",
  overtimeMinutes: "Overtime minutes",
  shiftStart: "Shift start",
  shiftEnd: "Shift end",
  fullDayHours: "Full-day hours",
  halfDayHours: "Half-day hours",
  graceMinutes: "Late grace minutes",
  overtimeAfterHours: "Overtime after hours",
  breakDeductionEnabled: "Break deduction",
  name: "Name",
  department: "Department",
  role: "Role",
  active: "Active",
  enabled: "Enabled",
  leaveEnabled: "Leave approval",
  autoApprove: "Auto approval",
  autoOverwrite: "Auto overwrite",
  messagesPerSync: "Messages per sync",
  syncIntervalMinutes: "Sync interval (minutes)",
  groupName: "WhatsApp group",
  timeZone: "Timezone",
  autoClockOutEnabled: "Automatic Out time",
};
export function describeActivity(event, employees, format = "12h") {
  let d = event.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }
  const before = d.before && typeof d.before === "object" ? d.before : {};
  const after = d.after && typeof d.after === "object" ? d.after : {};
  const employee = ["attendance", "employee"].includes(event.entity)
    ? employees.find((e) => e.id === event.entityId)
    : null;
  const person = employee?.name || before.name || after.name || d.name || "";
  const date =
    d.date ||
    after.date ||
    before.date ||
    (d.from ? `${d.from} – ${d.to || d.from}` : "");
  const display = (key, value) =>
    value == null || value === ""
      ? "—"
      : typeof value === "boolean"
        ? value
          ? "On"
          : "Off"
        : key.toLowerCase().includes("time") &&
            /^\d{2}:\d{2}$/.test(String(value))
          ? formatTime(value, format)
          : attendanceNotes(String(value));
  const changes = [];
  if (typeof d.before === "string" && typeof d.after === "string")
    changes.push(`Name: ${d.before} → ${d.after}`);
  for (const [key, label] of Object.entries(labels)) {
    if (before[key] !== after[key] && (key in before || key in after))
      changes.push(
        `${label}: ${display(key, before[key])} → ${display(key, after[key])}`,
      );
    else if (key in d && typeof d[key] !== "object")
      changes.push(`${label}: ${display(key, d[key])}`);
  }
  for (const key of [
    "weekdayShifts",
    "groupRules",
    "employeeRules",
    "weeklyOffDays",
  ])
    if (
      JSON.stringify(before[key]) !== JSON.stringify(after[key]) &&
      (key in before || key in after)
    )
      changes.push(
        {
          weekdayShifts: "Weekday shifts",
          groupRules: "Department timings",
          employeeRules: "Individual timings",
          weeklyOffDays: "Weekly holidays",
        }[key] + " updated",
      );
  if (d.recalculated != null)
    changes.push(`${d.recalculated} attendance entries recalculated`);
  if (d.reason) changes.push(attendanceNotes(d.reason));
  if (!changes.length)
    changes.push(event.action + (d.from ? ` · ${d.from} to ${d.to}` : ""));
  return { person, date, changes };
}
export default function ActivityLog({
  events,
  employees,
  timeFormat,
  onRefresh,
}) {
  const [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [action, setAction] = useState("All actions"),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const rows = events
    .map((event) => ({
      ...event,
      ...describeActivity(event, employees, timeFormat),
    }))
    .filter((e) => {
      const date = String(e.createdAt).slice(0, 10);
      return (
        (!from || date >= from) &&
        (!to || date <= to) &&
        (action === "All actions" || e.action === action) &&
        `${e.person} ${e.action} ${e.date} ${e.changes.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    });
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  return (
    <section className="card activity-log">
      <div className="card-heading">
        <div>
          <h2>Activity log</h2>
          <p>Latest 500 events. Filter by event date, employee or change.</p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRefresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Refreshing…" : "Refresh activity"}
        </button>
      </div>
      <div className="report-controls">
        <label>
          Search activity
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Employee, action or note"
          />
        </label>
        <label>
          Action
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
          >
            <option>All actions</option>
            {[...new Set(events.map((e) => e.action))].sort().map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <DateNavigator
          label="Activity from"
          value={from}
          onChange={(v) => {
            setFrom(v);
            setPage(0);
          }}
        />
        <DateNavigator
          label="Activity to"
          value={to}
          onChange={(v) => {
            setTo(v);
            setPage(0);
          }}
        />
      </div>
      <div className="audit-list">
        {rows.slice(current * 25, current * 25 + 25).map((e) => (
          <details key={e.id}>
            <summary>
              <strong>{e.action}</strong>
              <span>
                {e.person || e.entity} {e.date && `· ${e.date}`}
              </span>
              <time>
                {String(e.createdAt).replace("T", " ").slice(0, 19)} UTC
              </time>
              <span className="activity-summary">
                {e.changes
                  .slice(0, 2)
                  .map((text) =>
                    text.length > 160 ? text.slice(0, 157) + "…" : text,
                  )
                  .join(" · ")}
                {e.changes.length > 2 ? " · more…" : ""}
              </span>
            </summary>
            <ul>
              {e.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          </details>
        ))}
        {!rows.length && <p className="empty">No matching activity.</p>}
      </div>
      <div className="form-footer">
        <span>
          {rows.length} events · Page {current + 1}
        </span>
        <button
          className="button"
          disabled={!current}
          onClick={() => setPage(current - 1)}
        >
          Previous events
        </button>
        <button
          className="button"
          disabled={(current + 1) * 25 >= rows.length}
          onClick={() => setPage(current + 1)}
        >
          Next events
        </button>
      </div>
    </section>
  );
}
