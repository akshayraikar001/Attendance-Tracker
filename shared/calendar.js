export const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function addDays(date, amount) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      86400000,
  );
}
export function dateRange(from, to) {
  const count = daysBetween(from, to);
  if (!Number.isFinite(count) || count < 0 || count > 365) return [];
  return Array.from({ length: count + 1 }, (_, i) => addDays(from, i));
}
export function holidayForDate(date, holidays = [], weeklyOffDays = [0]) {
  const custom = holidays.find(
    (h) => h.date === date && h.active !== false && h.active !== 0,
  );
  if (custom) return custom;
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return weeklyOffDays.includes(day)
    ? { date, name: weekdays[day] + " weekly holiday", weekly: true }
    : null;
}
export function shiftMonth(month, amount) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + amount, 1, 12))
    .toISOString()
    .slice(0, 7);
}
export function monthDates(month) {
  return dateRange(month + "-01", addDays(shiftMonth(month, 1) + "-01", -1));
}
export function shiftDateRange(from, to, direction) {
  const amount = (daysBetween(from, to) + 1) * direction;
  return { from: addDays(from, amount), to: addDays(to, amount) };
}
