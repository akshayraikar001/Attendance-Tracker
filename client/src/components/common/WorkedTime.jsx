import React from "react";
const hours = (n) => (n == null ? "—" : `${Math.floor(n / 60)}h ${n % 60}m`);
export default function WorkedTime({ entry }) {
  let rules = entry.rules;
  if (typeof rules === "string") {
    try {
      rules = JSON.parse(rules);
    } catch {
      rules = {};
    }
  }
  let gross = null;
  if (entry.inTime && entry.outTime) {
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    gross =
      minutes(entry.outTime) -
      minutes(entry.inTime) +
      (entry.overnight ? 1440 : 0);
  }
  return (
    <>
      {hours(entry.workedMinutes)}
      {rules?.breakDeductionEnabled &&
        entry.workedMinutes != null &&
        gross != null && (
          <small className="break-explanation">
            {hours(gross)} − 1h break{gross < 60 ? " (minimum 0h)" : ""}
          </small>
        )}
    </>
  );
}
