import { TimeInput } from "../../components/common/TimeDisplay.jsx";
import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { weekdays } from "../../../../shared/calendar.js";
const fields = [
  ["shiftStart", "Shift start", "time"],
  ["shiftEnd", "Shift end", "time"],
  ["fullDayHours", "Full day minimum (hours)", "hours"],
  ["halfDayHours", "Half day minimum (hours)", "hours"],
  ["overtimeAfterHours", "Overtime starts after (hours)", "hours"],
  ["graceMinutes", "Late grace period (minutes)", "grace"],
];
const base = (r) => ({
  ...Object.fromEntries(fields.map(([key]) => [key, r[key]])),
  breakMinutes: 0,
  breakDeductionEnabled: r.breakDeductionEnabled ?? false,
  weekdayShifts: r.weekdayShifts || {},
  autoClockOutEnabled: r.autoClockOutEnabled ?? true,
  attendanceTimeZone: r.attendanceTimeZone || "Asia/Kolkata",
});
export function effectiveRules(rules, employee, date) {
  const selected =
    rules.employeeRules?.[employee?.id] ??
    rules.groupRules?.[employee?.department] ??
    rules;
  const day = date ? new Date(date + "T12:00:00Z").getUTCDay() : null;
  return {
    ...selected,
    ...(selected.weekdayShifts?.[day] ??
      rules.groupRules?.[employee?.department]?.weekdayShifts?.[day] ??
      rules.weekdayShifts?.[day]),
    breakDeductionEnabled: rules.breakDeductionEnabled ?? false,
  };
}
export default function TimingSettings({
  rules,
  employees,
  departments = [],
  onSave,
  saving,
}) {
  const [scope, setScope] = useState("workspace"),
    [target, setTarget] = useState(""),
    [draft, setDraft] = useState(base(rules));
  const groups = [
    ...new Set([...departments, ...employees.map((e) => e.department)]),
  ];
  const employee = employees.find((e) => String(e.id) === target);
  const overrides = scope === "group" ? rules.groupRules : rules.employeeRules;
  const own = scope !== "workspace" && overrides?.[target];
  const inherited =
    scope === "employee"
      ? (rules.groupRules?.[employee?.department] ?? rules)
      : rules;
  useEffect(() => {
    setDraft(base(own || inherited));
  }, [rules, scope, target]);
  const disabled = scope !== "workspace" && !target;
  function save(e) {
    e.preventDefault();
    let next;
    if (scope === "workspace") next = { ...rules, ...draft };
    else {
      const key = scope === "group" ? "groupRules" : "employeeRules";
      next = { ...rules, [key]: { ...rules[key], [target]: draft } };
    }
    onSave(next);
  }
  function reset() {
    const key = scope === "group" ? "groupRules" : "employeeRules";
    const next = { ...rules[key] };
    delete next[target];
    onSave({ ...rules, [key]: next });
  }
  return (
    <form onSubmit={save}>
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2>Custom & group timings</h2>
            <p>
              Employee timings take priority over group timings. Groups inherit
              workspace timings unless customized.
            </p>
          </div>
        </div>
        <div className="timing-picker form-grid">
          <label>
            Configure timings for
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setTarget("");
              }}
            >
              <option value="workspace">Whole workspace</option>
              <option value="group">Department / group</option>
              <option value="employee">Individual employee</option>
            </select>
          </label>
          {scope !== "workspace" && (
            <label>
              {scope === "group" ? "Group" : "Employee"}
              <select
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select {scope}</option>
                {scope === "group"
                  ? groups.map((g) => <option key={g}>{g}</option>)
                  : employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.department}
                      </option>
                    ))}
              </select>
            </label>
          )}
        </div>
        <div className="settings-note">
          {scope === "workspace"
            ? "Default timings for employees without a group or individual override."
            : own
              ? "Custom timings are active for this selection."
              : `Currently inherits ${scope === "employee" && rules.groupRules?.[employee?.department] ? "group" : "workspace"} timings. Saving creates a custom override.`}
        </div>
        <fieldset disabled={disabled || saving} className="timing-fields">
          {scope === "workspace" && (
            <div className="automation-settings">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.breakDeductionEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      breakDeductionEnabled: e.target.checked,
                    })
                  }
                />
                Deduct a 1-hour break
              </label>
              <p className="muted">
                Off by default. When enabled, worked hours = In-to-Out duration
                minus 1 hour (minimum zero). Status and overtime use the reduced
                hours.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.autoClockOutEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      autoClockOutEnabled: e.target.checked,
                    })
                  }
                />
                Automatic Out time at 8 PM
              </label>
              <p className="muted">
                If In time exists and Out time is missing at 8 PM, save 7:05 PM
                with a note. Overnight shifts and In times at or after 7:05 PM
                are excluded. Requires the server to run; missed checks catch up
                on reopening. A cleared automatic time is not added again.
              </p>
              <label>
                Attendance timezone
                <input
                  required
                  value={draft.attendanceTimeZone}
                  onChange={(e) =>
                    setDraft({ ...draft, attendanceTimeZone: e.target.value })
                  }
                  placeholder="Asia/Kolkata"
                />
              </label>
            </div>
          )}
          <div className="form-grid">
            {fields.map(([key, label, type]) => (
              <label key={key}>
                {label}
                {type === "time" ? (
                  <TimeInput
                    required
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    required
                    type={type === "time" ? "time" : "number"}
                    min={type === "hours" ? 0.25 : 0}
                    max={type === "hours" ? 24 : 180}
                    step={type === "hours" ? 0.25 : 1}
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [key]:
                          type === "time"
                            ? e.target.value
                            : Number(e.target.value),
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <details className="weekday-shift-settings">
            <summary>Day-specific shift times</summary>
            <p className="muted">
              Repeat each week. Full-day, half-day and overtime thresholds stay
              as configured above. Employee day overrides take priority over
              department and workspace day overrides.
            </p>
            {weekdays.map((day, index) => (
              <div className="weekday-shift-row" key={day}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.weekdayShifts[index])}
                    onChange={(e) => {
                      const weekdayShifts = { ...draft.weekdayShifts };
                      if (e.target.checked)
                        weekdayShifts[index] = {
                          shiftStart: draft.shiftStart,
                          shiftEnd: draft.shiftEnd,
                        };
                      else delete weekdayShifts[index];
                      setDraft({ ...draft, weekdayShifts });
                    }}
                  />
                  {day}
                </label>
                {draft.weekdayShifts[index] &&
                  ["shiftStart", "shiftEnd"].map((key) => (
                    <label key={key}>
                      {day} {key === "shiftStart" ? "start" : "end"}
                      <TimeInput
                        required
                        value={draft.weekdayShifts[index][key]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            weekdayShifts: {
                              ...draft.weekdayShifts,
                              [index]: {
                                ...draft.weekdayShifts[index],
                                [key]: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            ))}
          </details>
        </fieldset>
        <div className="settings-note">
          Saving recalculates all time-based attendance using each employee’s
          applicable rules. Manually chosen statuses stay unchanged. Status and
          overtime use the time between In time and Out time, minus one hour
          only when break deduction is enabled. A shift end before its start
          represents an overnight schedule.
        </div>
        <div className="form-footer">
          {own && (
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={reset}
            >
              Use inherited timings
            </button>
          )}
          <button className="primary" disabled={disabled || saving}>
            <Check size={16} />
            {saving ? "Saving…" : "Save timings"}
          </button>
        </div>
      </section>
    </form>
  );
}
