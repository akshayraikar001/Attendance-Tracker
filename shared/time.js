// Wall-clock formatting only: no date or timezone conversion.
export function formatTime(value, format = "12h") {
  if (!value) return "—";
  const [hour, minute] = value.split(":");
  if (format === "24h") return `${hour}:${minute}`;
  const h = Number(hour);
  return `${h % 12 || 12}:${minute} ${h >= 12 ? "PM" : "AM"}`;
}
export function parseTime(value) {
  if (!value.trim()) return "";
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || (match[3] ? h < 1 || h > 12 : h > 23)) return null;
  if (match[3]) h = (h % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
