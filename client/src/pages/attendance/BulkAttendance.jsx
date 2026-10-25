import React, { useState } from "react";
import DateNavigator, {
  RangeNavigator,
} from "../../components/common/DateNavigator.jsx";
export default function BulkAttendance({
  employees,
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
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const active = employees.filter((e) => reset || e.status === "Active");
  const endpoint = `/attendance/bulk-${reset ? "reset" : "attendance"}`;
  const visible = active.filter(
    (e) => group === "All groups" || e.department === group,
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
  };
  async function review(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
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
                required
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
            <p className="muted">
              Up to 366 days. No changes are made until you review and apply.
            </p>
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
                className="button"
                onClick={() => update(setSelected, [])}
              >
                Clear selection
              </button>
            </div>
            <p>{selected.length} selected</p>
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
                    <small>{e.department}</small>
                  </span>
                </label>
              ))}
            </div>
            {!reset && (
              <>
                <label>
                  Attendance status
                  <select
                    value={status}
                    onChange={(e) => update(setStatus, e.target.value)}
                  >
                    {["Present", "Absent", "Half day", "Attended"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </label>
                <p className="muted">
                  Records a direct status and keeps any saved In/Out times and
                  measured hours. No times are invented for unmarked days.
                </p>
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
                    Changes the selected status while keeping saved In/Out times
                    and measured hours. Use attendance editing to clear times
                    explicitly.
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
                  Saved {result.total} {status} entries. Skipped{" "}
                  {result.skippedExisting} existing entries and{" "}
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
                          : "Mark " + status}
                    </span>
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
