import React, { useState, useEffect } from "react";
import TimingSettings from "./TimingSettings.jsx";
import DateNavigator from "../../components/common/DateNavigator.jsx";
import { weekdays } from "../../../../shared/calendar.js";
function CatalogEditor({ kind, items, api, onReload }) {
  const [draft, setDraft] = useState(""),
    [edit, setEdit] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function mutate(url, data, method) {
    setBusy(true);
    setError("");
    try {
      await api(url, data, method);
      await onReload();
      setDraft("");
      setEdit(null);
      setMessage("Changes saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card catalog-editor">
      <div className="card-heading">
        <div>
          <h2>
            {kind === "departments" ? "Departments & groups" : "Employee roles"}
          </h2>
        </div>
      </div>
      <form
        className="catalog-add"
        onSubmit={(e) => {
          e.preventDefault();
          mutate("/catalog/" + kind, { name: draft }, "POST");
        }}
      >
        <label>
          New {kind === "departments" ? "department" : "role"}
          <input
            required
            maxLength={80}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !draft.trim()}>
          Add
        </button>
      </form>
      {error && (
        <p className="bulk-message error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="bulk-message" role="status">
          {message}
        </p>
      )}
      <div className="catalog-list">
        {items.map((item) => (
          <div className="catalog-row" key={item.id}>
            {edit?.id === item.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  mutate(
                    `/catalog/${kind}/${item.id}`,
                    { name: edit.name },
                    "PUT",
                  );
                }}
              >
                <input
                  aria-label="New name"
                  required
                  maxLength={80}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
                <button className="primary" disabled={busy}>
                  Save name
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setEdit(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.count} assigned employees</small>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setEdit(item);
                    setMessage("");
                  }}
                >
                  Rename
                </button>
                <button
                  className="button"
                  disabled={busy || item.count > 0}
                  title={
                    item.count
                      ? "Move employees before removing this item"
                      : "Remove empty item"
                  }
                  onClick={() =>
                    mutate(`/catalog/${kind}/${item.id}`, {}, "DELETE")
                  }
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
        {!items.length && <p className="empty">No items yet.</p>}
      </div>
    </section>
  );
}
function CalendarSettings({ rules, holidays, onSave, api, onReload, saving }) {
  const [days, setDays] = useState(rules.weeklyOffDays ?? [0]),
    [date, setDate] = useState(new Date().toLocaleDateString("en-CA")),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setDays(rules.weeklyOffDays ?? [0]), [rules]);
  useEffect(
    () => setName(holidays.find((h) => h.date === date)?.name || ""),
    [date, holidays],
  );
  async function saveHoliday(active = true) {
    setBusy(true);
    setError("");
    try {
      await api("/holidays/" + date, { name, active }, "PUT");
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card calendar-settings">
      <div className="card-heading">
        <div>
          <h2>Weekly holidays</h2>
        </div>
      </div>
      <form
        className="settings-inner"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...rules, weeklyOffDays: days });
        }}
      >
        <div className="weekday-options">
          {weekdays.map((day, i) => (
            <label className="checkbox" key={day}>
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) =>
                  setDays(
                    e.target.checked
                      ? [...days, i]
                      : days.filter((d) => d !== i),
                  )
                }
              />
              {day}
            </label>
          ))}
        </div>
        <button className="primary" disabled={saving}>
          Save weekly holidays
        </button>
      </form>
      <div className="card-heading">
        <div>
          <h2>Named holidays</h2>
        </div>
      </div>
      <form
        className="settings-inner"
        onSubmit={(e) => {
          e.preventDefault();
          saveHoliday();
        }}
      >
        <DateNavigator
          label="Holiday date"
          value={date}
          onChange={setDate}
          required
        />
        <label>
          Holiday name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="heading-actions">
          <button className="primary" disabled={busy}>
            Save holiday
          </button>
          {holidays.some((h) => h.date === date) && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => saveHoliday(false)}
            >
              Remove holiday
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </form>
      <div className="catalog-list">
        {holidays.map((h) => (
          <div className="catalog-row" key={h.date}>
            <strong>{h.name}</strong>
            <span>{h.date}</span>
            <button className="button" onClick={() => setDate(h.date)}>
              Edit
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
export default function WorkspaceSettings({
  rules,
  employees,
  catalog,
  holidays,
  api,
  onReload,
  onSave,
  saving,
}) {
  const [tab, setTab] = useState("Timings");
  return (
    <>
      <section className="card time-format-settings">
        <h2>Time display</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            role="switch"
            aria-label="Use AM/PM time format"
            checked={(rules.timeFormat ?? "12h") === "12h"}
            disabled={saving}
            onChange={(e) =>
              onSave({ ...rules, timeFormat: e.target.checked ? "12h" : "24h" })
            }
          />
          Use AM/PM (12-hour time)
        </label>
      </section>
      <section className="card time-format-settings">
        <h2>Report settings</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            role="switch"
            checked={rules.showDailyWorkingAverage ?? true}
            disabled={saving}
            onChange={(e) =>
              onSave({ ...rules, showDailyWorkingAverage: e.target.checked })
            }
          />
          Show daily working average in reports and Excel
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={
              rules.printDailyWorkingAverage ??
              rules.showDailyWorkingAverage ??
              true
            }
            disabled={saving}
            onChange={(e) =>
              onSave({ ...rules, printDailyWorkingAverage: e.target.checked })
            }
          />
          Show daily working average in print
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rules.averageIncludeHalfDays ?? false}
            disabled={saving}
            onChange={(e) =>
              onSave({
                ...rules,
                averageIncludeHalfDays: e.target.checked,
                averageIncludeHalfDayOvertime: e.target.checked
                  ? false
                  : (rules.averageIncludeHalfDayOvertime ?? false),
              })
            }
          />
          Consider half-day Out times in daily working average
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rules.averageIncludeHalfDayOvertime ?? false}
            disabled={saving}
            onChange={(e) =>
              onSave({
                ...rules,
                averageIncludeHalfDayOvertime: e.target.checked,
                averageIncludeHalfDays: e.target.checked
                  ? false
                  : (rules.averageIncludeHalfDays ?? false),
              })
            }
          />
          Include half-day overtime in daily working average
        </label>
        <p className="muted">
          Adds only hours above the half-day minimum to Present-day hours, then
          divides by measured Present days. For example, 6 hours worked with a
          4.5-hour half-day minimum adds 1.5 hours. Choose either all half-day
          hours or only half-day overtime. With no measured Present days, the
          average stays blank.
        </p>
      </section>
      <div className="tabs">
        {["Timings", "Departments", "Roles", "Holidays"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Timings" ? (
        <TimingSettings
          rules={rules}
          employees={employees}
          departments={catalog.departments.map((d) => d.name)}
          onSave={onSave}
          saving={saving}
        />
      ) : tab === "Holidays" ? (
        <CalendarSettings
          rules={rules}
          holidays={holidays}
          onSave={onSave}
          api={api}
          onReload={onReload}
          saving={saving}
        />
      ) : (
        <CatalogEditor
          key={tab}
          kind={tab.toLowerCase()}
          items={catalog[tab.toLowerCase()]}
          api={api}
          onReload={onReload}
        />
      )}
    </>
  );
}
