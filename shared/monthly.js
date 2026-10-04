import { monthDates, holidayForDate } from "./calendar.js";
export const reportStatuses = [
  "Present",
  "Absent",
  "Half day",
  "Attended",
  "In progress",
  "Holiday",
  "Unmarked",
];
export function monthlyData({
  employees,
  records,
  month,
  holidays = [],
  weeklyOffDays = [0],
  department = "All groups",
}) {
  const dates = monthDates(month);
  const relevant = records.filter((r) => r.date.startsWith(month + "-"));
  const byKey = new Map(relevant.map((r) => [r.employeeId + ":" + r.date, r]));
  const days = dates.map((date) => ({
    date,
    holiday: holidayForDate(date, holidays, weeklyOffDays),
    weekday: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }),
  }));
  const people = employees
    .filter(
      (e) =>
        (e.status === "Active" ||
          relevant.some((r) => r.employeeId === e.id)) &&
        (department === "All groups" || department === e.department),
    )
    .map((employee) => {
      const entries = days.map(({ date, holiday }) => {
        const entry = byKey.get(employee.id + ":" + date);
        return {
          ...entry,
          date,
          employeeId: employee.id,
          status: entry?.status ?? (holiday ? "Holiday" : "Unmarked"),
          workedMinutes: entry?.workedMinutes ?? null,
        };
      });
      const counts = Object.fromEntries(
        reportStatuses.map((status) => [
          status,
          entries.filter((r) => r.status === status).length,
        ]),
      );
      return {
        ...employee,
        entries,
        counts,
        totalMinutes: entries.reduce((n, r) => n + (r.workedMinutes ?? 0), 0),
      };
    });
  const totals = Object.fromEntries(
    reportStatuses.map((status) => [
      status,
      people.reduce((n, e) => n + e.counts[status], 0),
    ]),
  );
  return { days, people, totals };
}
