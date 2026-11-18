import { z } from "zod";
import { attendanceNotes } from "../../../shared/attendance-notes.js";
import { holidayDateSchema } from "../services/rules.js";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v + "Z")) &&
      new Date(v + "Z").toISOString().slice(0, 16) === v,
    "Enter a valid date and time.",
  );
export const timeAwaySchema = z
  .object({
    employeeId: z.coerce.number().int().positive(),
    date: holidayDateSchema,
    departedAt: timestamp,
    returnedAt: timestamp.nullable().default(null),
    reason: z.string().trim().max(500).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.departedAt.slice(0, 10) !== v.date)
      ctx.addIssue({
        code: "custom",
        message: "Departure must be on the selected attendance date.",
      });
    if (v.returnedAt && v.returnedAt <= v.departedAt)
      ctx.addIssue({
        code: "custom",
        message: "Return must be after departure.",
      });
  });
export function registerEmployeeAccess({
  app,
  wrap,
  query,
  transaction,
  audit,
}) {
  app.get(
    "/api/me/profile",
    wrap(async (req, res) => {
      const [employee] = await query(
        "SELECT id,name,department,role,status,locationTrackingEnabled FROM employees WHERE id=?",
        [req.user.employeeId],
      );
      const [settings] = await query("SELECT rules FROM settings WHERE id=1");
      const rules =
        typeof settings.rules === "string"
          ? JSON.parse(settings.rules)
          : settings.rules;
      res.json({
        employee,
        holidays: await query("SELECT date,name FROM holidays WHERE active=1"),
        weeklyOffDays: rules.weeklyOffDays ?? [0],
        timeFormat: rules.timeFormat,
      });
    }),
  );
  app.get(
    "/api/me/attendance",
    wrap(async (req, res) =>
      res.json(
        (
          await query(
            "SELECT a.*,e.name,e.department FROM attendance a JOIN employees e ON e.id=a.employeeId WHERE a.employeeId=? ORDER BY date DESC",
            [req.user.employeeId],
          )
        ).map((r) => ({ ...r, notes: attendanceNotes(r.notes) })),
      ),
    ),
  );
  app.get(
    "/api/me/time-away",
    wrap(async (req, res) => {
      const date =
        req.query.date === undefined
          ? null
          : holidayDateSchema.parse(req.query.date);
      res.json(
        await query(
          "SELECT id,date,departedAt,returnedAt,reason FROM time_away WHERE employeeId=?" +
            (date ? " AND date=?" : "") +
            " ORDER BY departedAt DESC,id DESC",
          date ? [req.user.employeeId, date] : [req.user.employeeId],
        ),
      );
    }),
  );
  app.use("/api/time-away", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get(
    "/api/time-away",
    wrap(async (req, res) => {
      const date =
        req.query.date === undefined
          ? null
          : holidayDateSchema.parse(req.query.date);
      res.json(
        await query(
          "SELECT t.*,e.name FROM time_away t JOIN employees e ON e.id=t.employeeId" +
            (date ? " WHERE t.date=?" : "") +
            " ORDER BY t.departedAt DESC,t.id DESC",
          date ? [date] : [],
        ),
      );
    }),
  );
  async function save(req, res) {
    const data = timeAwaySchema.parse(req.body);
    const id = req.params.id
      ? z.coerce.number().int().positive().parse(req.params.id)
      : null;
    const result = await transaction(async (c) => {
      // Serialize intervals for each employee, including concurrent starts/returns.
      const [employees] = await c.execute(
        "SELECT id FROM employees WHERE id=? FOR UPDATE",
        [data.employeeId],
      );
      if (!employees.length) throw fail("Employee not found.", 404);
      let old;
      if (id) {
        const [rows] = await c.execute(
          "SELECT * FROM time_away WHERE id=? FOR UPDATE",
          [id],
        );
        old = rows[0];
        if (!old) throw fail("Time away not found.", 404);
        if (old.employeeId !== data.employeeId)
          throw fail("Employee cannot be changed.");
      }
      const start = data.departedAt.replace("T", " ") + ":00",
        end = data.returnedAt?.replace("T", " ") + ":00";
      const [overlap] = await c.execute(
        "SELECT id FROM time_away WHERE employeeId=? AND id<>? AND departedAt < ? AND (returnedAt IS NULL OR returnedAt > ?) LIMIT 1",
        [
          data.employeeId,
          id || 0,
          data.returnedAt ? end : "9999-12-31 23:59:59",
          start,
        ],
      );
      if (overlap.length)
        throw fail(
          "This overlaps another time-away interval. Record its return first.",
        );
      let savedId = id;
      if (id)
        await c.execute(
          "UPDATE time_away SET date=?,departedAt=?,returnedAt=?,reason=? WHERE id=?",
          [data.date, start, data.returnedAt ? end : null, data.reason, id],
        );
      else {
        const [r] = await c.execute(
          "INSERT INTO time_away (employeeId,date,departedAt,returnedAt,reason,createdBy) VALUES (?,?,?,?,?,?)",
          [
            data.employeeId,
            data.date,
            start,
            data.returnedAt ? end : null,
            data.reason,
            req.user.id,
          ],
        );
        savedId = r.insertId;
      }
      await audit(c, "Time away saved", "time_away", savedId, {
        actorId: req.user.id,
        before: old || null,
        after: data,
      });
      return savedId;
    });
    res.status(id ? 200 : 201).json({ id: result });
  }
  app.post("/api/time-away", wrap(save));
  app.put("/api/time-away/:id", wrap(save));
}
