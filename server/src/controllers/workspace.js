import { attendanceNotes } from "../../../shared/attendance-notes.js";
import { saveEmployeePhone } from "../services/employee-phone.js";
import { recalculateAttendance } from "../services/recalculate.js";
import {
  holidayDateSchema,
  holidaySchema,
  employeeSchema,
  entrySchema,
  settingsSchema,
  resolveRules,
  calculate,
} from "../services/rules.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
export function registerWorkspaceRoutes({
  app,
  wrap,
  query,
  transaction,
  audit,
}) {
  async function ensureCatalog(c, e) {
    for (const [kind, name] of [
      ["departments", e.department],
      ["roles", e.role],
    ])
      await c.execute(
        "INSERT INTO catalog (kind,name,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE active=1",
        [kind, name],
      );
  }
  app.get(
    "/api/health",
    wrap(async (req, res) => {
      await query("SELECT 1");
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/holidays",
    wrap(async (req, res) => {
      res.json(
        await query(
          "SELECT id,date,name FROM holidays WHERE active=1 ORDER BY date",
        ),
      );
    }),
  );
  app.put(
    "/api/holidays/:date",
    wrap(async (req, res) => {
      const date = holidayDateSchema.parse(req.params.date);
      const holiday = holidaySchema.parse(req.body);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [old] = await c.execute(
          "SELECT * FROM holidays WHERE date=? FOR UPDATE",
          [date],
        );
        const [result] = await c.execute(
          "INSERT INTO holidays (date,name,active) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),active=VALUES(active)",
          [date, holiday.name, holiday.active],
        );
        await audit(
          c,
          holiday.active ? "Holiday saved" : "Holiday removed",
          "holiday",
          old[0]?.id || result.insertId,
          {
            before: old[0] || null,
            after: { date, ...holiday },
          },
        );
      });
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/employees",
    wrap(async (req, res) =>
      res.json(await query("SELECT * FROM employees ORDER BY name")),
    ),
  );
  app.post(
    "/api/employees",
    wrap(async (req, res) => {
      const e = employeeSchema.parse(req.body);
      const id = await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        await ensureCatalog(c, e);
        const [r] = await c.execute(
          "INSERT INTO employees (name,email,department,role,status) VALUES (?,?,?,?,?)",
          [e.name, e.email, e.department, e.role, e.status],
        );
        e.phone = await saveEmployeePhone(c, r.insertId, e.phone ?? null);
        await audit(c, "Employee added", "employee", r.insertId, e);
        return r.insertId;
      });
      res.status(201).json({ id, ...e });
    }),
  );
  app.put(
    "/api/employees/:id",
    wrap(async (req, res) => {
      const e = employeeSchema.parse(req.body);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        await ensureCatalog(c, e);
        const [old] = await c.execute(
          "SELECT * FROM employees WHERE id=? FOR UPDATE",
          [req.params.id],
        );
        if (!old.length)
          throw Object.assign(new Error("Employee not found"), { status: 404 });
        await c.execute(
          "UPDATE employees SET name=?,email=?,department=?,role=?,status=? WHERE id=?",
          [e.name, e.email, e.department, e.role, e.status, req.params.id],
        );
        if (e.phone !== undefined)
          await saveEmployeePhone(c, Number(req.params.id), e.phone);
        await audit(c, "Employee updated", "employee", Number(req.params.id), {
          before: old[0],
          after: e,
        });
      });
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/settings",
    wrap(async (req, res) => {
      const [s] = await query("SELECT rules FROM settings WHERE id=1");
      const rules = parse(s.rules);
      if (!rules.attendanceTimeZone) {
        const [config] = await query(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        rules.attendanceTimeZone =
          parse(config.config).timeZone || "Asia/Kolkata";
      }
      res.json(rules);
    }),
  );
  app.put(
    "/api/settings",
    wrap(async (req, res) => {
      const rules = settingsSchema.parse(req.body);
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const stored = parse(rows[0].rules);
        // The activation date is owned by the scheduler, not a client request.
        if (stored.autoClockOutSince)
          rules.autoClockOutSince = stored.autoClockOutSince;
        else delete rules.autoClockOutSince;
        await c.execute("UPDATE settings SET rules=? WHERE id=1", [
          JSON.stringify(rules),
        ]);
        const recalculated = await recalculateAttendance(c, rules);
        await audit(c, "Attendance rules updated", "settings", 1, {
          before: parse(rows[0].rules),
          after: rules,
          recalculated,
        });
      });
      res.json(rules);
    }),
  );
  app.get(
    "/api/attendance",
    wrap(async (req, res) => {
      const { from = "2000-01-01", to = "2100-01-01" } = req.query;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        return res.status(400).json({ error: "Invalid date range" });
      res.json(
        (
          await query(
            "SELECT a.*,e.name,e.department,e.email FROM attendance a JOIN employees e ON e.id=a.employeeId WHERE a.date BETWEEN ? AND ? ORDER BY a.date DESC,e.name",
            [from, to],
          )
        ).map((row) => ({ ...row, notes: attendanceNotes(row.notes) })),
      );
    }),
  );
  app.post(
    "/api/attendance",
    wrap(async (req, res) => {
      const e = entrySchema.parse(req.body);
      let calc, rules;
      await transaction(async (c) => {
        const [settingsRows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const settings = parse(settingsRows[0].rules);
        const [employees] = await c.execute(
          "SELECT id,status,department FROM employees WHERE id=? FOR UPDATE",
          [e.employeeId],
        );
        if (!employees.length || employees[0].status !== "Active")
          throw Object.assign(new Error("Select an active employee"), {
            status: 400,
          });
        rules = resolveRules(settings, employees[0], e.date);
        try {
          calc = calculate(e, rules);
        } catch (error) {
          throw Object.assign(error, { status: 400 });
        }
        const [old] = await c.execute(
          "SELECT * FROM attendance WHERE employeeId=? AND date=? FOR UPDATE",
          [e.employeeId, e.date],
        );
        await c.execute(
          `INSERT INTO attendance (employeeId,date,mode,inTime,outTime,overnight,status,workedMinutes,lateMinutes,earlyMinutes,overtimeMinutes,notes,rules) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),inTime=VALUES(inTime),outTime=VALUES(outTime),overnight=VALUES(overnight),status=VALUES(status),workedMinutes=VALUES(workedMinutes),lateMinutes=VALUES(lateMinutes),earlyMinutes=VALUES(earlyMinutes),overtimeMinutes=VALUES(overtimeMinutes),notes=VALUES(notes),rules=VALUES(rules)`,
          [
            e.employeeId,
            e.date,
            e.mode,
            e.mode === "time" ? e.inTime : null,
            e.mode === "time" ? e.outTime : null,
            e.mode === "time" ? e.overnight : false,
            calc.status,
            calc.workedMinutes,
            calc.lateMinutes,
            calc.earlyMinutes,
            calc.overtimeMinutes,
            e.notes,
            JSON.stringify(rules),
          ],
        );
        await audit(
          c,
          old.length ? "Attendance updated" : "Attendance recorded",
          "attendance",
          e.employeeId,
          { before: old[0] || null, after: { ...e, ...calc, rules } },
        );
      });
      res.json({ ok: true, ...calc });
    }),
  );
  app.delete(
    "/api/attendance/:employeeId/:date",
    wrap(async (req, res) => {
      const employeeId = Number(req.params.employeeId);
      const date = req.params.date;
      if (
        !Number.isInteger(employeeId) ||
        employeeId < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      )
        return res.status(400).json({ error: "Invalid attendance record." });
      await transaction(async (c) => {
        const [old] = await c.execute(
          "SELECT * FROM attendance WHERE employeeId=? AND date=? FOR UPDATE",
          [employeeId, date],
        );
        if (old.length) {
          await c.execute(
            "DELETE FROM attendance WHERE employeeId=? AND date=?",
            [employeeId, date],
          );
          await audit(c, "Attendance times cleared", "attendance", employeeId, {
            date,
            before: old[0],
          });
        }
      });
      res.json({ ok: true, cleared: true });
    }),
  );
  app.get(
    "/api/audit",
    wrap(async (req, res) =>
      res.json(await query("SELECT * FROM audit ORDER BY id DESC LIMIT 500")),
    ),
  );
}
