import React, { useState } from "react";
import { holidayForDate } from "../../../../shared/calendar.js";
import DateNavigator, {
  RangeNavigator,
} from "../../components/common/DateNavigator.jsx";
export default function BulkAttendance({
  employees,
  records = [],
  holidays = [],
  rules = {},
  date,
  api,
  onApplied,
  onClose,
  reset = false,
}) {
  const [from, setFrom] = useState(date),
    [to, setTo] = useState(date),
    [selected, setSelected] = useState([]),
    [group, setGroup] = useState("All groups"),
    [skipHolidays, setSkipHolidays] = useState(true),
    [overwrite, setOverwrite] = useState(false),
    [notes, setNotes] = useState(""),
    [status, setStatus] = useState("Absent"),
    [entryMode, setEntryMode] = useState("status"),
    [inTime, setInTime] = useState(""),
    [outTime, setOutTime] = useState(""),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const active = employees.filter((e) => reset || e.status === "Active");
  const endpoint = `/attendance/bulk-${reset ? "reset" : "attendance"}`;
  const visible = active.filter(
    (e) => group === "All groups" || e.department === group,
  );
  const fromRecords = new Map(
    records.filter((r) => r.date === from).map((r) => [r.employeeId, r]),
  );
  const fromHoliday = holidayForDate(
    from,
    holidays,
    rules.weeklyOffDays ?? [0],
  );
  const groups = [...new Set(active.map((e) => e.department))];
  const update = (setter, value) => {
    setter(value);
    setPreview(null);
    setResult(null);
    setError("");
  };
  const payload = {
    employeeIds: selected,
    from,
    to,
    skipHolidays,
    overwrite,
    notes,
    status,
    entryMode,
    inTime: entryMode === "time" ? inTime : null,
    outTime: entryMode === "time" ? outTime : null,
  };
  async function review(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setPreview(null);
    try {
      setPreview(await api(endpoint + "/preview", payload));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await api(endpoint, {
        ...payload,
        previewToken: preview.previewToken,
      });
      setResult(r);
      setPreview(null);
      await onApplied(r);
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal bulk-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">ONE DAY OR A DATE RANGE</span>
            <h2 id="bulk-title">
              {reset ? "Reset attendance" : "Bulk attendance"}
            </h2>
          </div>
        </div>
        <form onSubmit={review}>
          <fieldset className="bulk-fields" disabled={busy}>
            <div className="bulk-dates">
              <DateNavigator
                label="From"
                value={from}
                onChange={(v) => update(setFrom, v)}
              />
              <DateNavigator
                label="To"
                value={to}
                onChange={(v) => update(setTo, v)}
                required
              />
            </div>
            <RangeNavigator
              from={from}
              to={to}
              onChange={(r) => {
                update(setFrom, r.from);
                setTo(r.to);
              }}
            />

            {reset && (
              <p className="muted">
                Clears saved In time, Out time, status and notes for the
                selected employees and dates, including holidays. Each date
                returns to its normal Unmarked or Holiday status. Employee
                details stay saved.
              </p>
            )}
            <div className="bulk-selection-header">
              <label>
                Department
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option>All groups</option>
                  {groups.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button"
                onClick={() =>
                  update(setSelected, [
                    ...new Set([...selected, ...visible.map((e) => e.id)]),
                  ])
                }
              >
                Select displayed
              </button>
              <button
                type="button"
                className="bulk-clear-selection"
                aria-label="Clear selected employees"
                title="Clear selection"
                onClick={() => update(setSelected, [])}
              >
                ×
              </button>
            </div>
            <label className="checkbox bulk-select-all">
              <input
                type="checkbox"
                checked={active.length > 0 && selected.length === active.length}
                onChange={(e) =>
                  update(
                    setSelected,
                    e.target.checked
                      ? active.map((employee) => employee.id)
                      : [],
                  )
                }
              />
              Select all employees
            </label>
            <p>
              {selected.length} selected · Attendance on {from || "From date"}
            </p>
            <div className="bulk-employees">
              {visible.map((e) => (
                <label className="checkbox" key={e.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(e.id)}
                    onChange={(event) =>
                      update(
                        setSelected,
                        event.target.checked
                          ? [...selected, e.id]
                          : selected.filter((id) => id !== e.id),
                      )
                    }
                  />
                  <span>
                    {e.name}
                    <small
                      className={
                        "badge " +
                        (
                          fromRecords.get(e.id)?.status ??
                          (fromHoliday ? "Holiday" : "Unmarked")
                        )
                          .toLowerCase()
                          .replace(" ", "-")
                      }
                    >
                      {fromRecords.get(e.id)?.status ??
                        (fromHoliday ? "Holiday" : "Unmarked")}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            {!reset && (
              <>
                <label>
                  Bulk entry type
                  <select
                    value={entryMode}
                    onChange={(e) => update(setEntryMode, e.target.value)}
                  >
                    <option value="status">Attendance status</option>
                    <option value="time">In / out time</option>
                  </select>
                </label>
                {entryMode === "time" ? (
                  <div className="bulk-dates">
                    <label>
                      In time
                      <input
                        type="time"
                        value={inTime}
                        onChange={(e) => update(setInTime, e.target.value)}
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={() => update(setInTime, "")}
                      >
                        Clear
                      </button>
                    </label>
                    <label>
                      Out time
                      <input
                        type="time"
                        value={outTime}
                        onChange={(e) => update(setOutTime, e.target.value)}
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={() => update(setOutTime, "")}
                      >
                        Clear
                      </button>
                    </label>
                    <p className="muted">
                      These times are applied to every selected employee-day.
                      Enter either time or both; leave a field blank when it is
                      not available.
                    </p>
                  </div>
                ) : (
                  <label>
                    Attendance status
                    <select
                      className={`attendance-status-select ${status.toLowerCase().replace(" ", "-")}`}
                      value={status}
                      onChange={(e) => update(setStatus, e.target.value)}
                    >
                      {["Present", "Absent", "Half day", "Attended"].map(
                        (value) => (
                          <option
                            className={value.toLowerCase().replace(" ", "-")}
                            key={value}
                          >
                            {value}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={skipHolidays}
                    onChange={(e) => update(setSkipHolidays, e.target.checked)}
                  />
                  Skip weekly holidays and named holidays
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => update(setOverwrite, e.target.checked)}
                  />
                  Replace existing attendance with {status}
                </label>
                {overwrite && (
                  <p className="error-text">
                    Changes the selected entry while replacing saved values for
                    the selected employee-days.
                  </p>
                )}
                {entryMode === "time" && !overwrite && (
                  <p className="muted">
                    Existing employee-days are updated when the supplied In or
                    Out side is missing; already-filled times are skipped.
                  </p>
                )}
                <label>
                  Notes (optional)
                  <textarea
                    maxLength={2000}
                    value={notes}
                    onChange={(e) => update(setNotes, e.target.value)}
                  />
                </label>
              </>
            )}
          </fieldset>
          {error && (
            <p className="bulk-message error-text" role="alert">
              {error}
            </p>
          )}
          {result && (
            <p className="bulk-message" role="status">
              {reset ? (
                `Reset ${result.total} attendance entries.`
              ) : (
                <>
                  Saved {result.total}{" "}
                  {entryMode === "time"
                    ? `time entries (${inTime}–${outTime || "open"})`
                    : `${status} entries`}
                  . Skipped {result.skippedExisting} existing entries and{" "}
                  {result.skippedHolidays} holiday employee-days.
                </>
              )}
            </p>
          )}
          {preview && (
            <div className="bulk-preview">
              <h3>Review before applying</h3>
              <p>
                {reset ? (
                  <strong>{preview.total} saved entries will be cleared</strong>
                ) : (
                  <>
                    <strong>{preview.create} new</strong> ·{" "}
                    <strong>{preview.replace} replacements</strong> ·{" "}
                    {preview.skippedExisting} existing entries skipped ·{" "}
                    {preview.skippedHolidays} holiday employee-days skipped
                  </>
                )}
              </p>
              <div className="bulk-preview-list">
                {preview.sample.map((r) => (
                  <div key={r.name + r.date}>
                    <span>{r.name}</span>
                    <span>{r.date}</span>
                    <span>
                      {reset
                        ? "Clear " + r.replaces
                        : r.replaces
                          ? "Replace " + r.replaces
                          : entryMode === "time"
                            ? `Record ${inTime}–${outTime || "open"}`
                            : "Mark " + status}
                    </span>
                    {entryMode === "time" && (
                      <span>
                        In {r.inTime || "—"} · Out {r.outTime || "—"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {preview.total > preview.sample.length && (
                <small>
                  Showing the first {preview.sample.length} of {preview.total}{" "}
                  changes.
                </small>
              )}
            </div>
          )}
          <div className="form-footer">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button"
              disabled={busy || !selected.length || !from || !to || from > to}
            >
              {busy ? "Working…" : "Preview changes"}
            </button>
            {preview && (
              <button
                type="button"
                className="primary"
                disabled={busy || !preview.total}
                onClick={apply}
              >
                {reset
                  ? `Reset ${preview.total} entries`
                  : `Apply ${preview.total} entries`}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
