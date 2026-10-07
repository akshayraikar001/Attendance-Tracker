import { normalizePhone } from "../../../shared/phone.js";
import { z } from "zod";
export const defaults = {
  fullDayHours: 8,
  halfDayHours: 4,
  shiftStart: "09:00",
  shiftEnd: "18:00",
  graceMinutes: 15,
  overtimeAfterHours: 8,
  breakMinutes: 0,
};
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ruleSchema = z
  .object({
    fullDayHours: z.number().positive().max(24),
    halfDayHours: z.number().positive().max(24),
    shiftStart: time,
    shiftEnd: time,
    graceMinutes: z.number().int().min(0).max(180),
    breakDeductionEnabled: z.boolean().optional(),
    weekdayShifts: z
      .record(
        z.string().regex(/^[0-6]$/),
        z.object({ shiftStart: time, shiftEnd: time }),
      )
      .default({}),
    overtimeAfterHours: z.number().positive().max(24),
    // Accept legacy settings but normalize away all break deductions.
    breakMinutes: z
      .number()
      .int()
      .min(0)
      .max(480)
      .optional()
      .transform(() => 0),
  })
  .refine(
    (r) => r.halfDayHours < r.fullDayHours,
    "Half day must be shorter than full day",
  )
  .refine(
    (r) => r.overtimeAfterHours >= r.fullDayHours,
    "Overtime threshold must be at least full-day hours",
  );
export const settingsSchema = ruleSchema.and(
  z.object({
    timeFormat: z.enum(["12h", "24h"]).default("12h"),
    autoClockOutEnabled: z.boolean().default(true),
    autoClockOutSince: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    attendanceTimeZone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone")
      .optional(),
    weeklyOffDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .default([0])
      .transform((days) => [...new Set(days)]),
    groupRules: z
      .record(z.string().trim().min(1).max(80), ruleSchema)
      .default({}),
    employeeRules: z
      .record(z.string().regex(/^[1-9]\d*$/), ruleSchema)
      .default({}),
  }),
);
export function resolveRules(settings, employee, date) {
  const selected =
    settings.employeeRules?.[employee.id] ??
    settings.groupRules?.[employee.department] ??
    settings;
  const weekday = date ? new Date(date + "T12:00:00Z").getUTCDay() : null;
  const shift =
    selected.weekdayShifts?.[weekday] ??
    settings.groupRules?.[employee.department]?.weekdayShifts?.[weekday] ??
    settings.weekdayShifts?.[weekday];
  return ruleSchema.parse({
    ...selected,
    ...shift,
    breakDeductionEnabled: settings.breakDeductionEnabled ?? false,
  });
}
export const employeeSchema = z.object({
  phone: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      try {
        return normalizePhone(value);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: error.message });
        return z.NEVER;
      }
    }),
  name: z.string().trim().min(2).max(100),
  email: z.preprocess(
    (value) =>
      value == null || (typeof value === "string" && !value.trim())
        ? null
        : value,
    z.string().trim().email().max(160).nullable(),
  ),
  department: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) =>
      /^(engineering|engineers?|developers)$/i.test(value)
        ? "Development"
        : value,
    ),
  role: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) =>
      /^(engineering|engineers?)$/i.test(value) ? "Developer" : value,
    ),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});
export const entrySchema = z
  .object({
    employeeId: z.number().int().positive(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (d) =>
          !Number.isNaN(Date.parse(d)) &&
          new Date(d).toISOString().slice(0, 10) === d,
        "Invalid date",
      ),
    mode: z.enum(["time", "manual"]),
    inTime: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      time.nullable(),
    ),
    outTime: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      time.nullable(),
    ),
    overnight: z.boolean().default(false),
    status: z.enum(["Present", "Absent", "Half day", "Attended"]).optional(),
    notes: z.string().max(2000).default(""),
  })
  .superRefine((r, c) => {
    if (r.mode === "time" && !r.inTime)
      c.addIssue({
        code: "custom",
        message: "Clock-in time is required",
      });
    if (r.mode === "manual" && !r.status)
      c.addIssue({ code: "custom", message: "Select attendance status" });
  });
export const minutes = (t) =>
  t.split(":").reduce((h, m) => Number(h) * 60 + Number(m));
export function calculate(entry, rules) {
  if (entry.mode === "manual")
    return {
      status: entry.status,
      workedMinutes: null,
      lateMinutes: null,
      earlyMinutes: null,
      overtimeMinutes: null,
    };
  if (!entry.outTime) {
    const start = minutes(entry.inTime);
    const shiftStart = minutes(rules.shiftStart);
    return {
      status: "In progress",
      workedMinutes: null,
      lateMinutes:
        start > shiftStart + rules.graceMinutes ? start - shiftStart : 0,
      earlyMinutes: null,
      overtimeMinutes: null,
    };
  }
  const start = minutes(entry.inTime),
    end = minutes(entry.outTime) + (entry.overnight ? 1440 : 0);
  if (end <= start || end - start > 1440)
    throw new Error(
      "Out time must follow in time; enable overnight for a shift crossing midnight.",
    );
  const workedMinutes = Math.max(
    0,
    end - start - (rules.breakDeductionEnabled ? 60 : 0),
  );
  const shiftStart = minutes(rules.shiftStart);
  let shiftEnd = minutes(rules.shiftEnd);
  if (shiftEnd <= shiftStart) shiftEnd += 1440;
  // Classification and overtime depend on elapsed hours, never shift position.
  const overtime = Math.max(
    0,
    workedMinutes - Math.round(rules.overtimeAfterHours * 60),
  );
  return {
    status:
      workedMinutes >= Math.round(rules.fullDayHours * 60)
        ? "Present"
        : workedMinutes >= Math.round(rules.halfDayHours * 60)
          ? "Half day"
          : workedMinutes > 1
            ? "Attended"
            : "Absent",
    workedMinutes,
    lateMinutes:
      start > shiftStart + rules.graceMinutes ? start - shiftStart : 0,
    earlyMinutes: Math.max(0, shiftEnd - end),
    overtimeMinutes: overtime,
  };
}

// A holiday is a workspace-wide calendar date, independent of recorded work.
export const holidayDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) =>
      d >= "1000-01-01" &&
      d <= "9999-12-31" &&
      !Number.isNaN(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d,
    "Select a valid holiday date",
  );
export const holidaySchema = z.object({
  name: z.string().trim().min(1, "Holiday name is required").max(100),
  active: z.boolean().default(true),
});
