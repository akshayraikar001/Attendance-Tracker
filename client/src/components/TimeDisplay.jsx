import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
} from "react";
import { Clock } from "lucide-react";
import { formatTime, parseTime } from "../../../shared/time.js";
export const TimeFormatContext = createContext("12h");
export function useTimeFormatter() {
  const format = useContext(TimeFormatContext);
  return (value) => formatTime(value, format);
}
export function TimeInput({ value = "", onChange, ...props }) {
  const format = useContext(TimeFormatContext);
  const [draft, setDraft] = useState(value ? formatTime(value, format) : "");
  const emitted = useRef(value);
  const input = useRef(null);
  const container = useRef(null);
  const trigger = useRef(null);
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("09:00");
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const hour = Number(selection.slice(0, 2));
  const minute = selection.slice(3, 5);
  function selectHour(h) {
    setSelection(
      `${String((Number(h) % 12) + (hour >= 12 ? 12 : 0)).padStart(2, "0")}:${minute}`,
    );
  }
  function applyTime() {
    emitted.current = selection;
    setDraft(formatTime(selection, format));
    input.current?.setCustomValidity("");
    onChange({ target: { value: selection } });
    close();
  }
  useEffect(() => {
    if (value !== emitted.current || document.activeElement !== input.current) {
      setDraft(value ? formatTime(value, format) : "");
      input.current?.setCustomValidity("");
    }
    emitted.current = value;
  }, [value, format]);
  if (format === "24h")
    return <input {...props} type="time" value={value} onChange={onChange} />;
  return (
    <span
      className="clock-input"
      ref={container}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        {...props}
        ref={input}
        type="text"
        placeholder="9:00 AM"
        value={draft}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const parsed = parseTime(text);
          e.target.setCustomValidity(
            parsed === null ? "Enter a time such as 9:30 AM or 5:15 PM." : "",
          );
          if (parsed !== null) {
            emitted.current = parsed;
            onChange({ target: { value: parsed } });
          }
        }}
        onBlur={() => {
          const parsed = parseTime(draft);
          if (parsed !== null)
            setDraft(parsed ? formatTime(parsed, format) : "");
        }}
      />
      <button
        ref={trigger}
        type="button"
        className="clock-input-trigger"
        aria-label="Choose time"
        title="Choose time"
        aria-expanded={open}
        aria-controls={pickerId}
        disabled={props.disabled || props.readOnly}
        onClick={(event) => {
          event.preventDefault();
          setSelection(parseTime(draft) || value || "09:00");
          setOpen(!open);
        }}
      >
        <Clock size={18} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={pickerId}
          className="clock-input-picker"
          role="group"
          aria-label="Time picker"
        >
          <span className="clock-input-selectors">
            <select
              aria-label="Hour"
              value={hour % 12 || 12}
              onChange={(event) => selectHour(event.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
            <span aria-hidden="true">:</span>
            <select
              aria-label="Minute"
              value={minute}
              onChange={(event) =>
                setSelection(`${selection.slice(0, 2)}:${event.target.value}`)
              }
            >
              {Array.from({ length: 60 }, (_, i) => {
                const m = String(i).padStart(2, "0");
                return (
                  <option key={m} value={m}>
                    {m}
                  </option>
                );
              })}
            </select>
            <select
              aria-label="AM or PM"
              value={hour >= 12 ? "PM" : "AM"}
              onChange={(event) =>
                setSelection(
                  `${String((hour % 12) + (event.target.value === "PM" ? 12 : 0)).padStart(2, "0")}:${minute}`,
                )
              }
            >
              <option>AM</option>
              <option>PM</option>
            </select>
          </span>
          <span className="clock-input-actions">
            <button
              type="button"
              className="button"
              onClick={(event) => {
                event.preventDefault();
                close();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={(event) => {
                event.preventDefault();
                applyTime();
              }}
            >
              Set time
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
