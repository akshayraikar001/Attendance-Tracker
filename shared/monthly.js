import { holidayAdjustedRecords } from "./calendar.js";
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
function halfDayThreshold(
  record,
  employee,
  employeeRules,
  groupRules,
  fallback,
) {
  let snapshot = record.rules;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      snapshot = null;
    }
  }
  for (const hours of [
    snapshot?.halfDayHours,
    employeeRules[employee.id]?.halfDayHours,
    groupRules[employee.department]?.halfDayHours,
    fallback,
    4,
  ]) {
    if (typeof hours === "number" && Number.isFinite(hours) && hours > 0)
      return Math.round(hours * 60);
  }
}
export function monthlyData({
  employees,
  records,
  month,
  holidays = [],
  weeklyOffDays = [0],
  department = "All groups",
  showDailyWorkingAverage = true,
  averageIncludeHalfDays = false,
  averageIncludeHalfDayOvertime = false,
  halfDayHours = 4,
  employeeRules = {},
  groupRules = {},
}) {
  records = holidayAdjustedRecords(records, holidays, weeklyOffDays);
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
      const totalMinutes = entries.reduce(
        (n, r) => n + (r.workedMinutes ?? 0),
        0,
      );
      const averageEntries = entries.filter(
        (r) =>
          (r.status === "Present" ||
            (averageIncludeHalfDays &&
              !averageIncludeHalfDayOvertime &&
              r.status === "Half day")) &&
          r.workedMinutes != null,
      );
      const workingDays = averageEntries.length;
      const averageTotal = averageEntries.reduce(
        (n, r) => n + r.workedMinutes,
        0,
      );
      const halfDayExtra = averageIncludeHalfDayOvertime
        ? entries.reduce(
            (sum, r) =>
              sum +
              (r.status === "Half day" && r.workedMinutes != null
                ? Math.max(
                    0,
                    r.workedMinutes -
                      halfDayThreshold(
                        r,
                        employee,
                        employeeRules,
                        groupRules,
                        halfDayHours,
                      ),
                  )
                : 0),
            0,
          )
        : 0;
      return {
        ...employee,
        entries,
        counts,
        totalMinutes,
        averageMinutes: workingDays
          ? (averageTotal + halfDayExtra) / workingDays
          : null,
      };
    });
  const totals = Object.fromEntries(
    reportStatuses.map((status) => [
      status,
      people.reduce((n, e) => n + e.counts[status], 0),
    ]),
  );
  return {
    days,
    people,
    totals,
    showDailyWorkingAverage,
    averageIncludeHalfDays,
    averageIncludeHalfDayOvertime,
  };
}
