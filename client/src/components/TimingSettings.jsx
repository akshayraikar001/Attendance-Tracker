import { TimeInput } from "./TimeDisplay.jsx";
import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
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
});
export function effectiveRules(rules, employee) {
  return (
    rules.employeeRules?.[employee?.id] ??
    rules.groupRules?.[employee?.department] ??
    rules
  );
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
        </fieldset>
        <div className="settings-note">
          Saving recalculates all time-based attendance using each employee’s
          applicable rules. Manually chosen statuses stay unchanged. Status and
          overtime depend only on the full time between clock-in and clock-out,
          including breaks, regardless of arrival or departure time. Clock-out
          before shift start represents an overnight schedule.
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
