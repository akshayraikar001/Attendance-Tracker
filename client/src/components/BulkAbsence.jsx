import React, { useState } from "react";
import DateNavigator, { RangeNavigator } from "./DateNavigator.jsx";
export default function BulkAbsence({
  employees,
  date,
  api,
  onApplied,
  onClose,
}) {
  const [from, setFrom] = useState(date),
    [to, setTo] = useState(date),
    [selected, setSelected] = useState([]),
    [group, setGroup] = useState("All groups"),
    [skipHolidays, setSkipHolidays] = useState(true),
    [overwrite, setOverwrite] = useState(false),
    [notes, setNotes] = useState(""),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const active = employees.filter((e) => e.status === "Active");
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
  };
  async function review(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setPreview(await api("/attendance/bulk-absence/preview", payload));
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
      const r = await api("/attendance/bulk-absence", {
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
            <h2 id="bulk-title">Mark bulk absence</h2>
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
              Replace existing attendance with Absent
            </label>
            {overwrite && (
              <p className="error-text">
                Replacing removes existing in/out times and measured hours for
                the selected entries. The previous values remain in the activity
                log.
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
          </fieldset>
          {error && (
            <p className="bulk-message error-text" role="alert">
              {error}
            </p>
          )}
          {result && (
            <p className="bulk-message" role="status">
              Saved {result.total} absence entries. Skipped{" "}
              {result.skippedExisting} existing entries and{" "}
              {result.skippedHolidays} holiday employee-days.
            </p>
          )}
          {preview && (
            <div className="bulk-preview">
              <h3>Review before applying</h3>
              <p>
                <strong>{preview.create} new</strong> ·{" "}
                <strong>{preview.replace} replacements</strong> ·{" "}
                {preview.skippedExisting} existing entries skipped ·{" "}
                {preview.skippedHolidays} holiday employee-days skipped
              </p>
              <div className="bulk-preview-list">
                {preview.sample.map((r) => (
                  <div key={r.name + r.date}>
                    <span>{r.name}</span>
                    <span>{r.date}</span>
                    <span>
                      {r.replaces ? "Replace " + r.replaces : "New absence"}
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
                Apply {preview.total} absences
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
