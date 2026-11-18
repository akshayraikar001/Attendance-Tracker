import React, { useEffect, useState } from "react";
import api from "../../services/api.js";
import DateNavigator from "../../components/common/DateNavigator.jsx";
import { today } from "../../utils/display.js";
const minutesAway = (row) =>
  row.returnedAt
    ? Math.round(
        (Date.parse(row.returnedAt.replace(" ", "T") + "Z") -
          Date.parse(row.departedAt.replace(" ", "T") + "Z")) /
          60000,
      )
    : 0;
const duration = (minutes) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const fieldTime = (value) => value?.replace(" ", "T").slice(0, 16) || "";
export default function TimeAway({ employees = [], readOnly = false }) {
  const [rows, setRows] = useState([]),
    [date, setDate] = useState(today),
    [employee, setEmployee] = useState(""),
    [edit, setEdit] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setError("");
    if (!date) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api(
      (readOnly ? "/me/time-away" : "/time-away") +
        "?date=" +
        encodeURIComponent(date),
    )
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, date, revision]);
  const visible = rows.filter(
    (row) => !employee || readOnly || row.employeeId === Number(employee),
  );
  const changeDate = (value) => {
    setDate(value);
    setEdit(null);
    setMessage("");
  };
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    data.returnedAt = data.returnedAt || null;
    data.date = data.departedAt.slice(0, 10);
    try {
      await api(
        "/time-away" + (edit.id ? "/" + edit.id : ""),
        data,
        edit.id ? "PUT" : "POST",
      );
      setEdit(null);
      setDate(data.date);
      setRevision((n) => n + 1);
      setMessage("Time away saved. Attendance hours are unchanged.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card user-editor time-away-module">
      <div className="card-heading">
        <div>
          <h2>Time away</h2>
        </div>
        {!readOnly && (
          <button
            className="primary"
            disabled={busy || !date}
            onClick={() => {
              setMessage("");
              setEdit({ employeeId: employee, departedAt: date + "T09:00" });
            }}
          >
            Record time away
          </button>
        )}
      </div>
      <div className="time-away-controls">
        <DateNavigator
          value={date}
          onChange={changeDate}
          label="Day"
          disabled={busy}
          required
        />
        <button
          className="button"
          disabled={busy}
          onClick={() => changeDate(today())}
        >
          Today
        </button>
        {!readOnly && (
          <label>
            Employee filter
            <select
              value={employee}
              disabled={busy}
              onChange={(e) => {
                setEmployee(e.target.value);
                setEdit(null);
              }}
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="button"
          disabled={busy || loading || !date}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!date && <p role="alert">Choose a day to view time away.</p>}
      {edit && (
        <form key={edit.id || "new"} onSubmit={save}>
          <fieldset disabled={busy} className="time-away-fields">
            <div className="form-grid">
              <label>
                Employee
                <select
                  name="employeeId"
                  required
                  defaultValue={edit.employeeId || ""}
                >
                  {!edit.id && <option value="">Select employee</option>}
                  {employees
                    .filter((e) => !edit.id || e.id === edit.employeeId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Departure
                <input
                  type="datetime-local"
                  name="departedAt"
                  required
                  min={date + "T00:00"}
                  max={date + "T23:59"}
                  defaultValue={fieldTime(edit.departedAt)}
                />
              </label>
              <label>
                Return (leave blank while away)
                <input
                  type="datetime-local"
                  name="returnedAt"
                  defaultValue={fieldTime(edit.returnedAt)}
                />
              </label>
              <label>
                Reason / note
                <input
                  name="reason"
                  maxLength={500}
                  defaultValue={edit.reason || ""}
                />
              </label>
            </div>
            <div className="form-footer">
              <button
                type="button"
                className="button"
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
              <button className="primary">
                {busy ? "Saving…" : "Save interval"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {loading ? (
        <p role="status">Loading time away…</p>
      ) : (
        date && (
          <>
            <p className="time-away-summary">
              {visible.length} intervals · Completed time away:{" "}
              <strong>
                {duration(
                  visible.reduce((total, row) => total + minutesAway(row), 0),
                )}
              </strong>{" "}
              · {visible.filter((r) => !r.returnedAt).length} awaiting return
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {!readOnly && <th>Employee</th>}
                    <th>Departure</th>
                    <th>Return</th>
                    <th>Duration</th>
                    <th>Reason / note</th>
                    {!readOnly && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      {!readOnly && <td>{r.name}</td>}
                      <td>{r.departedAt}</td>
                      <td>{r.returnedAt || "Awaiting return"}</td>
                      <td>
                        {r.returnedAt ? duration(minutesAway(r)) : "Ongoing"}
                      </td>
                      <td className="time-away-note">{r.reason || "—"}</td>
                      {!readOnly && (
                        <td>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => {
                              setEdit(r);
                              setMessage("");
                            }}
                          >
                            {r.returnedAt ? "Edit" : "Record return"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && !error && (
                <p className="empty">No time away recorded for this day.</p>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
