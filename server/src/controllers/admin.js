import { z } from "zod";
import { createHash } from "node:crypto";
import {
  calculate,
  holidayDateSchema,
  resolveRules,
} from "../services/rules.js";
import { dateRange, holidayForDate } from "../../../shared/calendar.js";
const parse = (x) => (typeof x === "string" ? JSON.parse(x) : x);
const kindSchema = z.enum(["departments", "roles"]);
const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });
const bulkSchema = z
  .object({
    employeeIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
    from: holidayDateSchema,
    to: holidayDateSchema,
    skipHolidays: z.boolean().default(true),
    overwrite: z.boolean().default(false),
    notes: z.string().max(2000).default(""),
    status: z
      .enum(["Present", "Absent", "Half day", "Attended"])
      .default("Absent"),
    entryMode: z.enum(["status", "time"]).default("status"),
    inTime: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .nullable(),
    ),
    outTime: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .nullable(),
    ),
    previewToken: z.string().optional(),
  })
  .refine(
    (v) => dateRange(v.from, v.to).length > 0,
    "Select a valid range of at most 366 days",
  )
  .refine(
    (v) => dateRange(v.from, v.to).length * v.employeeIds.length <= 10000,
    "Limit each bulk entry to 10,000 employee-days",
  )
  .superRefine((v, c) => {
    if (v.entryMode === "time" && !v.inTime && !v.outTime)
      c.addIssue({
        code: "custom",
        path: ["inTime"],
        message: "Enter an In time, an Out time, or both",
      });
  });
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function registerAdminRoutes({ app, wrap, transaction, audit, query }) {
  app.get(
    "/api/catalog",
    wrap(async (req, res) => {
      const entries = await query(
        "SELECT id,kind,name FROM catalog WHERE active=1 ORDER BY name",
      );
      const people = await query("SELECT department,role FROM employees");
      res.json({
        departments: entries
          .filter((e) => e.kind === "departments")
          .map((e) => ({
            ...e,
            count: people.filter((p) => p.department === e.name).length,
          })),
        roles: entries
          .filter((e) => e.kind === "roles")
          .map((e) => ({
            ...e,
            count: people.filter((p) => p.role === e.name).length,
          })),
      });
    }),
  );
  app.post(
    "/api/catalog/:kind",
    wrap(async (req, res) => {
      const kind = kindSchema.parse(req.params.kind);
      const { name } = nameSchema.parse(req.body);
      const id = await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [old] = await c.execute(
          "SELECT * FROM catalog WHERE kind=? AND name=? FOR UPDATE",
          [kind, name],
        );
        if (old[0]?.active) throw fail("That name already exists.", 409);
        const [r] = await c.execute(
          "INSERT INTO catalog (kind,name,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE active=1",
          [kind, name],
        );
        const id = old[0]?.id || r.insertId;
        await audit(c, "Catalog item added", kind, id, { name });
        return id;
      });
      res.status(201).json({ id, name, kind });
    }),
  );
  app.put(
    "/api/catalog/:kind/:id",
    wrap(async (req, res) => {
      const kind = kindSchema.parse(req.params.kind);
      const { name } = nameSchema.parse(req.body);
      await transaction(async (c) => {
        const [settingsRows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const settings = parse(settingsRows[0].rules);
        const [items] = await c.execute(
          "SELECT * FROM catalog WHERE id=? AND kind=? AND active=1 FOR UPDATE",
          [req.params.id, kind],
        );
        const old = items[0];
        if (!old) throw fail("Item not found", 404);
        const [duplicates] = await c.execute(
          "SELECT id FROM catalog WHERE kind=? AND name=? AND id<>?",
          [kind, name, old.id],
        );
        if (duplicates.length)
          throw fail("That name already exists. Choose a unique name.", 409);
        if (
          kind === "departments" &&
          name !== old.name &&
          settings.groupRules?.[name]
        )
          throw fail(
            "The new department name already has timing rules. Choose another name.",
            409,
          );
        await c.execute("UPDATE catalog SET name=? WHERE id=?", [name, old.id]);
        const column = kind === "departments" ? "department" : "role";
        const [people] = await c.execute(
          `SELECT id,name,${column} FROM employees WHERE ${column}=? FOR UPDATE`,
          [old.name],
        );
        await c.execute(`UPDATE employees SET ${column}=? WHERE ${column}=?`, [
          name,
          old.name,
        ]);
        if (
          kind === "departments" &&
          settings.groupRules?.[old.name] &&
          old.name !== name
        ) {
          settings.groupRules[name] = settings.groupRules[old.name];
          delete settings.groupRules[old.name];
          await c.execute("UPDATE settings SET rules=? WHERE id=1", [
            JSON.stringify(settings),
          ]);
        }
        await audit(c, "Catalog item renamed", kind, old.id, {
          before: old.name,
          after: name,
          affectedEmployees: people,
        });
      });
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/catalog/:kind/:id",
    wrap(async (req, res) => {
      const kind = kindSchema.parse(req.params.kind);
      await transaction(async (c) => {
        const [settingsRows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const settings = parse(settingsRows[0].rules);
        const [items] = await c.execute(
          "SELECT * FROM catalog WHERE id=? AND kind=? AND active=1 FOR UPDATE",
          [req.params.id, kind],
        );
        const old = items[0];
        if (!old) throw fail("Item not found", 404);
        const column = kind === "departments" ? "department" : "role";
        const [people] = await c.execute(
          `SELECT id FROM employees WHERE ${column}=?`,
          [old.name],
        );
        if (people.length)
          throw fail(
            "Move the assigned employees to another " +
              (kind === "departments" ? "department" : "role") +
              " first.",
          );
        await c.execute("UPDATE catalog SET active=0 WHERE id=?", [old.id]);
        if (kind === "departments" && settings.groupRules?.[old.name]) {
          delete settings.groupRules[old.name];
          await c.execute("UPDATE settings SET rules=? WHERE id=1", [
            JSON.stringify(settings),
          ]);
        }
        await audit(c, "Catalog item removed", kind, old.id, {
          name: old.name,
        });
      });
      res.json({ ok: true });
    }),
  );
  for (const operation of ["absence", "attendance", "reset"]) {
    const reset = operation === "reset";
    for (const preview of [true, false])
      app.post(
        `/api/attendance/bulk-${operation}` + (preview ? "/preview" : ""),
        wrap(async (req, res) => {
          const input = bulkSchema.parse(req.body);
          if (operation === "absence") input.status = "Absent";
          const result = await transaction(async (c) => {
            const [settingsRows] = await c.execute(
              "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
            );
            const settings = parse(settingsRows[0].rules);
            const marks = input.employeeIds.map(() => "?").join(",");
            const [people] = await c.execute(
              `SELECT * FROM employees WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,
              input.employeeIds,
            );
            if (
              people.length !== input.employeeIds.length ||
              (!reset && people.some((e) => e.status !== "Active"))
            )
              throw fail(
                "Select active employees only. Refresh and try again.",
              );
            const [holidays] = await c.execute(
              "SELECT date,name FROM holidays WHERE active=1 AND date BETWEEN ? AND ?",
              [input.from, input.to],
            );
            const [existing] = await c.execute(
              `SELECT * FROM attendance WHERE employeeId IN (${marks}) AND date BETWEEN ? AND ? ORDER BY employeeId,date FOR UPDATE`,
              [...input.employeeIds, input.from, input.to],
            );
            const byKey = new Map(
              existing.map((r) => [r.employeeId + ":" + r.date, r]),
            );
            const changes = [];
            const missingIn = [];
            let skippedHolidays = 0,
              skippedExisting = 0;
            for (const date of dateRange(input.from, input.to))
              for (const employee of people) {
                if (
                  !reset &&
                  input.skipHolidays &&
                  holidayForDate(date, holidays, settings.weeklyOffDays ?? [0])
                ) {
                  skippedHolidays++;
                  continue;
                }
                const old = byKey.get(employee.id + ":" + date);
                if (reset && !old) continue;
                if (!reset && old && !input.overwrite) {
                  const canFillMissingTime =
                    input.entryMode === "time" &&
                    ((input.inTime && !old.inTime) ||
                      (input.outTime && !old.outTime));
                  if (!canFillMissingTime) {
                    skippedExisting++;
                    continue;
                  }
                }
                if (reset) {
                  changes.push({ employee, date, old });
                  continue;
                }
                const mergeTime = (key) =>
                  input.entryMode !== "time"
                    ? old?.[key] || null
                    : input.overwrite
                      ? input[key] || old?.[key] || null
                      : old?.[key] || input[key] || null;
                const entry = {
                  mode: input.entryMode === "time" ? "time" : "manual",
                  inTime: mergeTime("inTime"),
                  outTime: mergeTime("outTime"),
                  overnight: Boolean(old?.overnight),
                  status: input.status,
                };
                if (
                  input.entryMode === "time" &&
                  entry.outTime &&
                  !entry.inTime
                ) {
                  missingIn.push(`${employee.name} (${date})`);
                  continue;
                }
                const rules = resolveRules(settings, employee, date);
                let calc;
                try {
                  calc = calculate(entry, rules);
                } catch (error) {
                  throw fail(`${employee.name} on ${date}: ${error.message}`);
                }
                changes.push({ employee, date, old, entry, rules, calc });
              }
            if (missingIn.length)
              throw fail(
                `Add In time before entering Out time: ${missingIn.slice(0, 10).join(", ")}${missingIn.length > 10 ? ` and ${missingIn.length - 10} more` : ""}.`,
              );
            const token = createHash("sha256")
              .update(
                JSON.stringify({
                  reset,
                  input: { ...input, previewToken: undefined },
                  settings,
                  people,
                  holidays,
                  existing,
                }),
              )
              .digest("hex");
            const summary = {
              create: changes.filter((r) => !r.old).length,
              replace: changes.filter((r) => r.old).length,
              skippedHolidays,
              skippedExisting,
              total: changes.length,
              previewToken: token,
              sample: changes.slice(0, 30).map((r) => ({
                name: r.employee.name,
                date: r.date,
                replaces: r.old?.status || null,
                inTime: r.entry?.inTime || null,
                outTime: r.entry?.outTime || null,
              })),
            };
            if (preview) return summary;
            if (input.previewToken !== token)
              throw fail(
                "Attendance or settings changed. Review the preview again before applying.",
                409,
              );
            for (const { employee, date, old, entry, rules, calc } of changes) {
              if (reset) {
                await c.execute(
                  "DELETE FROM attendance WHERE employeeId=? AND date=?",
                  [employee.id, date],
                );
                await audit(c, "Attendance reset", "attendance", employee.id, {
                  date,
                  before: old,
                  after: null,
                  actorId: req.user.id,
                });
                continue;
              }
              await c.execute(
                `INSERT INTO attendance (employeeId,date,mode,inTime,outTime,overnight,status,workedMinutes,lateMinutes,earlyMinutes,overtimeMinutes,notes,rules) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),inTime=VALUES(inTime),outTime=VALUES(outTime),overnight=VALUES(overnight),status=VALUES(status),workedMinutes=VALUES(workedMinutes),lateMinutes=VALUES(lateMinutes),earlyMinutes=VALUES(earlyMinutes),overtimeMinutes=VALUES(overtimeMinutes),notes=VALUES(notes),rules=VALUES(rules)`,
                [
                  employee.id,
                  date,
                  entry.mode,
                  entry.inTime,
                  entry.outTime,
                  entry.overnight,
                  calc.status,
                  calc.workedMinutes,
                  calc.lateMinutes,
                  calc.earlyMinutes,
                  calc.overtimeMinutes,
                  input.notes,
                  JSON.stringify(rules),
                ],
              );
              await audit(
                c,
                "Bulk attendance recorded",
                "attendance",
                employee.id,
                {
                  before: old || null,
                  after: {
                    ...old,
                    employeeId: employee.id,
                    date,
                    mode: "manual",
                    ...entry,
                    ...calc,
                    notes: input.notes,
                    rules,
                  },
                },
              );
            }
            return { ...summary, applied: true };
          });
          res.json(result);
        }),
      );
  }
}
