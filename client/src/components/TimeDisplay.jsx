import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
        if (parsed !== null) setDraft(parsed ? formatTime(parsed, format) : "");
      }}
    />
  );
}
