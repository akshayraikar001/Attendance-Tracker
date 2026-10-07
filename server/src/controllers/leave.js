import { z } from "zod";
import { leaveDates } from "../utils/leave-parser.js";
import { resolveRules } from "../services/rules.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function registerLeave({
  app,
  wrap,
  query,
  transaction,
  audit,
  whatsapp,
}) {
  app.use("/api/leave", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get(
    "/api/leave",
    wrap(async (req, res) => {
      const cfg = await whatsapp.config();
      const filter = z
        .enum(["pending", "approved", "rejected", "all"])
        .default("pending")
        .parse(req.query.state);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .default(0)
        .parse(req.query.offset);
      const clause = filter === "all" ? "" : " AND r.state=?";
      const args = [
        cfg.sessionId,
        cfg.groupId,
        ...(filter === "all" ? [] : [filter]),
      ];
      const [count] = await query(
        "SELECT COUNT(*) AS total FROM leave_requests r WHERE r.sessionId=? AND r.groupId=?" +
          clause,
        args,
      );
      const rows = await query(
        "SELECT r.*,e.name AS employeeName FROM leave_requests r LEFT JOIN employees e ON e.id=r.employeeId WHERE r.sessionId=? AND r.groupId=?" +
          clause +
          " ORDER BY r.timestamp DESC,r.id LIMIT 100 OFFSET ?",
        [...args, offset],
      );
      res.json({
        enabled: cfg.leaveEnabled === true,
        groupName: cfg.groupName,
        timeZone: cfg.timeZone,
        messagesPerSync: cfg.messagesPerSync,
        syncIntervalMinutes: cfg.syncIntervalMinutes,
        syncProgress: cfg.syncProgress || null,
        requests: rows,
        total: Number(count.total),
        hasMore: offset + rows.length < Number(count.total),
        ...whatsapp.status,
      });
    }),
  );
  app.put(
    "/api/leave/config",
    wrap(async (req, res) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const cfg = parse(rows[0].config);
        if (enabled && (!cfg.groupId?.endsWith("@g.us") || !cfg.timeZone))
          throw fail(
            "Select a shared WhatsApp group and timezone in WhatsApp settings first.",
          );
        if (enabled) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: cfg.timeZone });
          } catch {
            throw fail("Select a valid timezone in WhatsApp settings.");
          }
        }
        if ((cfg.leaveEnabled === true) !== enabled) {
          cfg.leaveEnabled = enabled;
          cfg.revision = Math.max(Date.now(), (cfg.revision || 0) + 1);
          // Revisit eligible history when enabling, including messages sent offline.
          // Existing attendance queue/events remain intact and retain deduplication.
          if (enabled) {
            cfg.syncProgress = null;
            cfg.lastHistoryScan = 0;
          }
          await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
            JSON.stringify(cfg),
          ]);
          await audit(c, "Leave collection settings changed", "whatsapp", 1, {
            enabled,
            actorId: req.user.id,
          });
        }
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/leave/sync",
    wrap(async (req, res) => {
      if (!(await whatsapp.config()).leaveEnabled)
        throw fail("Enable Leave Approval first.");
      await whatsapp.poll();
      res.json(whatsapp.status);
    }),
  );
  const decision = z.object({
    employeeId: z.number().int().positive(),
    kind: z.enum(["Absent", "Half day"]),
    from: z.string(),
    to: z.string(),
    overwrite: z.boolean().default(false),
  });
  app.post(
    "/api/leave/:id/approve",
    wrap(async (req, res) => {
      const id = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.params.id);
      const data = decision.parse(req.body);
      let dates;
      try {
        dates = leaveDates(data.from, data.to);
      } catch (e) {
        throw fail(e.message);
      }
      await transaction(async (c) => {
        const [settings] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const [configs] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const cfg = parse(configs[0].config);
        if (!cfg.leaveEnabled) throw fail("Enable Leave Approval first.");
        const [requests] = await c.execute(
          "SELECT * FROM leave_requests WHERE id=? FOR UPDATE",
          [id],
        );
        const request = requests[0];
        if (
          !request ||
          request.groupId !== cfg.groupId ||
          request.sessionId !== cfg.sessionId
        )
          throw fail("Request not found in the selected group.", 404);
        if (request.state !== "pending")
          throw fail("This request has already been decided.", 409);
        const [employees] = await c.execute(
          "SELECT * FROM employees WHERE id=? AND status='Active' FOR UPDATE",
          [data.employeeId],
        );
        if (!employees.length) throw fail("Choose an active employee.");
        const [existing] = await c.execute(
          "SELECT * FROM attendance WHERE employeeId=? AND date BETWEEN ? AND ? FOR UPDATE",
          [data.employeeId, data.from, data.to],
        );
        if (existing.length && !data.overwrite)
          throw fail(
            `Existing attendance on ${existing.map((r) => r.date).join(", ")}. Review it and explicitly allow replacement to approve.`,
            409,
          );
        for (const date of dates) {
          const rules = resolveRules(
            parse(settings[0].rules),
            employees[0],
            date,
          );
          await c.execute(
            `INSERT INTO attendance (employeeId,date,mode,inTime,outTime,overnight,status,workedMinutes,lateMinutes,earlyMinutes,overtimeMinutes,notes,rules) VALUES (?,?,'manual',NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?) ON DUPLICATE KEY UPDATE mode='manual',inTime=NULL,outTime=NULL,overnight=0,status=VALUES(status),workedMinutes=NULL,lateMinutes=NULL,earlyMinutes=NULL,overtimeMinutes=NULL,notes=VALUES(notes),rules=VALUES(rules)`,
            [
              data.employeeId,
              date,
              data.kind,
              data.kind === "Half day"
                ? "Half day approved via WhatsApp"
                : "Leave approved via WhatsApp",
              JSON.stringify(rules),
            ],
          );
        }
        await c.execute(
          "UPDATE leave_requests SET employeeId=?,kind=?,fromDate=?,toDate=?,state='approved',decidedBy=?,decidedAt=NOW() WHERE id=?",
          [data.employeeId, data.kind, data.from, data.to, req.user.id, id],
        );
        await audit(c, "WhatsApp leave approved", "employee", data.employeeId, {
          requestId: id,
          actorId: req.user.id,
          from: data.from,
          to: data.to,
          status: data.kind,
          overwrite: data.overwrite,
          before: existing,
        });
      });
      res.json({ ok: true, days: dates.length });
    }),
  );
  app.post(
    "/api/leave/:id/reject",
    wrap(async (req, res) => {
      const id = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.params.id);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [configs] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const cfg = parse(configs[0].config);
        if (!cfg.leaveEnabled) throw fail("Enable Leave Approval first.");
        const [result] = await c.execute(
          "UPDATE leave_requests SET state='rejected',decidedBy=?,decidedAt=NOW() WHERE id=? AND state='pending' AND sessionId=? AND groupId=?",
          [req.user.id, id, cfg.sessionId, cfg.groupId],
        );
        if (!result.affectedRows) throw fail("Pending request not found.", 409);
        await audit(c, "WhatsApp leave rejected", "whatsapp", 1, {
          requestId: id,
          actorId: req.user.id,
        });
      });
      res.json({ ok: true });
    }),
  );
}
