import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  shiftMonth,
  shiftDateRange,
} from "../../../../shared/calendar.js";
export default function DateNavigator({
  value,
  onChange,
  label = "Date",
  type = "date",
  required = false,
  disabled = false,
}) {
  const move = (amount) =>
    onChange(
      type === "month" ? shiftMonth(value, amount) : addDays(value, amount),
    );
  return (
    <div className="date-navigator">
      <button
        type="button"
        className="button"
        aria-label={"Previous " + label.toLowerCase()}
        disabled={disabled || !value}
        onClick={() => move(-1)}
      >
        <ChevronLeft size={17} />
      </button>
      <label>
        {label}
        <input
          type={type}
          value={value}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="button"
        aria-label={"Next " + label.toLowerCase()}
        disabled={disabled || !value}
        onClick={() => move(1)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
export function RangeNavigator({ from, to, onChange, disabled = false }) {
  const invalid = !from || !to || from > to;
  return (
    <div className="range-arrows">
      <button
        type="button"
        className="button"
        aria-label="Previous date range"
        disabled={disabled || invalid}
        onClick={() => onChange(shiftDateRange(from, to, -1))}
      >
        <ChevronLeft size={17} />
        Previous range
      </button>
      <button
        type="button"
        className="button"
        aria-label="Next date range"
        disabled={disabled || invalid}
        onClick={() => onChange(shiftDateRange(from, to, 1))}
      >
        Next range
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
