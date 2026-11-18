import { dayBounds, localMessageTime } from "../utils/whatsapp-parser.js";
import { z } from "zod";
import { saveEmployeePhone } from "../services/employee-phone.js";
import { chateryRequest, ensureChatery } from "../integrations/chatery.js";
import {
  configSchema,
  createWhatsAppService,
  rememberSource,
} from "../services/whatsapp.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Invalid date",
  );
const selectionSchema = z.object({
  dates: z.array(dateSchema).min(1).max(366).optional(),
  all: z.boolean().optional(),
});
function dayFilter(dates, zone) {
  if (!dates?.length) return { sql: "", args: [] };
  return {
    sql:
      " AND (" +
      dates.map(() => "(timestamp>=? AND timestamp<?)").join(" OR ") +
      ")",
    args: dates.flatMap((date) => dayBounds(date, zone)),
  };
}
export function registerWhatsApp({ app, wrap, query, transaction, audit }) {
  const service = createWhatsAppService({ query, transaction, audit });
  app.use("/api/whatsapp", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get(
    "/api/whatsapp/status",
    wrap(async (req, res) => {
      const [row] = await query(
        "SELECT config FROM whatsapp_config WHERE id=1",
      );
      const cfg = parse(row.config);
      try {
        const connection = await chateryRequest(
          `/sessions/${encodeURIComponent(cfg.sessionId)}/status`,
          null,
          { missingOK: true },
        );
        res.json({
          connected: Boolean(connection?.isConnected),
          available: true,
        });
      } catch {
        res.json({ connected: false, available: false });
      }
    }),
  );
  app.get(
    "/api/whatsapp",
    wrap(async (req, res) => {
      const cfg = await service.config();
      service.poll({ automatic: true }).catch(() => {});
      let connection = { status: "offline", isConnected: false },
        qrCode = null,
        connectionError = null;
      try {
        const state = await chateryRequest(
          `/sessions/${encodeURIComponent(cfg.sessionId)}/status`,
          null,
          { missingOK: true },
        );
        if (state)
          connection = {
            status: state.status,
            isConnected: state.isConnected,
            phoneNumber: state.phoneNumber,
          };
        else connection.status = "not linked";
        if (state && !state.isConnected) {
          const qr = await chateryRequest(
            `/sessions/${encodeURIComponent(cfg.sessionId)}/qr`,
            null,
            { missingOK: true },
          );
          qrCode = qr?.qrCode || null;
        }
      } catch (e) {
        connectionError = e.message;
      }
      const events = await query(
        `SELECT * FROM whatsapp_events WHERE sessionId=? AND groupId=? AND clearedAt IS ${req.query.history === "archived" ? "NOT NULL" : "NULL"} ORDER BY timestamp DESC LIMIT 100`,
        [cfg.sessionId, cfg.groupId],
      );
      const timestamps = await query(
        `SELECT timestamp,COUNT(*) AS count FROM whatsapp_events WHERE sessionId=? AND groupId=? AND clearedAt IS ${req.query.history === "archived" ? "NOT NULL" : "NULL"} GROUP BY timestamp`,
        [cfg.sessionId, cfg.groupId],
      );
      const days = new Map();
      for (const row of timestamps) {
        const date = localMessageTime(
          Number(row.timestamp),
          cfg.timeZone || "UTC",
        ).date;
        days.set(date, (days.get(date) || 0) + Number(row.count));
      }
      res.json({
        days: [...days]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, count]) => ({ date, count })),
        syncing: Boolean(cfg.syncProgress || service.status.syncing),
        config: cfg,
        connection,
        qrCode,
        connectionError,
        ...service.status,
        events,
        links: await query(
          "SELECT l.*,e.name FROM whatsapp_links l JOIN employees e ON e.id=l.employeeId",
        ),
      });
    }),
  );
  app.get(
    "/api/whatsapp/messages",
    wrap(async (req, res) => {
      const date = dateSchema.parse(req.query.date);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(req.query.offset || 0);
      const cfg = await service.config();
      const filter = dayFilter([date], cfg.timeZone || "UTC");
      const rows = await query(
        `SELECT * FROM whatsapp_events WHERE sessionId=? AND groupId=? AND clearedAt IS ${req.query.history === "archived" ? "NOT NULL" : "NULL"}${filter.sql} ORDER BY timestamp DESC,id LIMIT 101 OFFSET ?`,
        [cfg.sessionId, cfg.groupId, ...filter.args, offset],
      );
      res.json({ events: rows.slice(0, 100), hasMore: rows.length > 100 });
    }),
  );
  app.get(
    "/api/whatsapp/group-messages",
    wrap(async (req, res) => {
      const input = z
        .object({
          date: dateSchema.optional(),
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          history: z
            .enum(["archived"])
            .optional()
            .transform((v) => v === "archived"),
        })
        .parse(req.query);
      res.json(await service.groupMessages(input));
    }),
  );
  app.post(
    "/api/whatsapp/group-messages/scan",
    wrap(async (req, res) => {
      const input = z
        .object({
          date: dateSchema.optional(),
          start: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await service.scanGroupMessages(input));
    }),
  );
  app.delete(
    "/api/whatsapp/group-messages",
    wrap(async (req, res) => {
      const input = z
        .object({
          date: dateSchema.optional(),
          sessionId: z.string().min(1).max(80),
          groupId: z.string().min(1).max(160),
        })
        .parse(req.body);
      res.json(await service.clearGroupMessages(input));
    }),
  );
  app.post(
    "/api/whatsapp/group-messages/select",
    wrap(async (req, res) => {
      const input = z
        .object({
          messageId: z.string().min(1).max(160),
          sessionId: z.string().min(1).max(200),
          groupId: z.string().min(1).max(200),
        })
        .parse(req.body);
      res.json(await service.selectGroupMessage(input));
    }),
  );
  app.post(
    "/api/whatsapp/connect",
    wrap(async (req, res) => {
      const cfg = await service.config();
      await ensureChatery();
      const state = await chateryRequest(
        `/sessions/${encodeURIComponent(cfg.sessionId)}/status`,
        null,
        { missingOK: true },
      );
      if (!state?.isConnected)
        await chateryRequest(
          `/sessions/${encodeURIComponent(cfg.sessionId)}/connect`,
          {},
        );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/whatsapp/disconnect",
    wrap(async (req, res) => {
      const cfg = await service.config();
      await chateryRequest(
        `/sessions/${encodeURIComponent(cfg.sessionId)}`,
        undefined,
        { method: "DELETE" },
      );
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const next = {
          ...parse(rows[0].config),
          enabled: false,
          leaveEnabled: false,
          revision: Date.now(),
        };
        await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
          JSON.stringify(next),
        ]);
      });
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/whatsapp/events",
    wrap(async (req, res) => {
      const selection = selectionSchema.parse(req.body || {});
      if (service.status.syncing)
        throw fail(
          "The previous request is finishing. Try Sync again in a few seconds.",
          409,
        );
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1 FOR UPDATE",
        );
        const cfg = parse(rows[0].config);
        const filter = dayFilter(selection.dates, cfg.timeZone || "UTC");
        await c.execute(
          "UPDATE whatsapp_events SET clearedAt=UTC_TIMESTAMP() WHERE sessionId=? AND groupId=? AND clearedAt IS NULL" +
            filter.sql,
          [cfg.sessionId, cfg.groupId, ...filter.args],
        );
      });
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/whatsapp/groups",
    wrap(async (req, res) => {
      const cfg = await service.config();
      res.json(
        (await chateryRequest("/groups", { sessionId: cfg.sessionId })).groups,
      );
    }),
  );
  app.put(
    "/api/whatsapp/config",
    wrap(async (req, res) => {
      const data = configSchema.parse(req.body);
      if (data.enabled || data.leaveEnabled) {
        const groups = (
          await chateryRequest("/groups", { sessionId: data.sessionId })
        ).groups;
        if (!groups.some((g) => g.id === data.groupId))
          throw fail("The linked phone is not in this group.");
      }
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const old = parse(rows[0].config);
        const history = await rememberSource(c, old, data);
        const sameSource =
          old.groupId === data.groupId &&
          old.sessionId === data.sessionId &&
          old.timeZone === data.timeZone;
        const resumeAttendance = data.enabled && !old.enabled;
        const preserveProgress =
          sameSource &&
          history.since === old.since &&
          (old.autoApprove ?? false) === data.autoApprove &&
          (old.autoOverwrite ?? false) === data.autoOverwrite;
        if (!preserveProgress)
          await c.execute("DELETE FROM whatsapp_sync_queue");
        await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
          JSON.stringify({
            ...data,
            ...history,
            groupHistoryVersion: 1,
            revision: Math.max(Date.now(), (old.revision || 0) + 1),
            syncProgress:
              preserveProgress && !resumeAttendance
                ? old.syncProgress || null
                : null,
            lastHistoryScan:
              preserveProgress && !resumeAttendance
                ? old.lastHistoryScan || 0
                : 0,
            checkedThrough:
              old.groupId === data.groupId && old.sessionId === data.sessionId
                ? old.checkedThrough || 0
                : 0,
          }),
        ]);
        await audit(c, "WhatsApp import settings changed", "whatsapp", 1, {
          actorId: req.user.id,
          ...data,
        });
      });
      res.json({ config: await service.config() });
    }),
  );
  app.post(
    "/api/whatsapp/links",
    wrap(async (req, res) => {
      const data = z
        .object({
          identity: z.string().regex(/^(phone:\d{6,20}|lid:\d{1,30})$/),
          employeeId: z.number().int().positive(),
        })
        .parse(req.body);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT id FROM employees WHERE id=? AND status='Active'",
          [data.employeeId],
        );
        if (!rows.length) throw fail("Select an active employee.");
        if (data.identity.startsWith("phone:")) {
          // Legacy linking UI still updates the employee's single canonical number.
          if (data.identity.slice(6).length <= 10)
            throw fail(
              "Include the country code when saving an employee phone number.",
            );
          await saveEmployeePhone(
            c,
            data.employeeId,
            "+" + data.identity.slice(6),
          );
        } else {
          await c.execute(
            "INSERT INTO whatsapp_links (identity,employeeId) VALUES (?,?) ON DUPLICATE KEY UPDATE employeeId=VALUES(employeeId)",
            [data.identity, data.employeeId],
          );
        }
        await audit(c, "WhatsApp sender linked", "employee", data.employeeId, {
          actorId: req.user.id,
          identity: data.identity,
        });
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/whatsapp/retry",
    wrap(async (req, res) => {
      const { id, overwrite = false } = z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          overwrite: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await service.retryEvent(id, overwrite));
    }),
  );
  app.post(
    "/api/whatsapp/approve",
    wrap(async (req, res) => {
      const {
        id,
        overwrite = true,
        correction,
        expectedText,
      } = z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          overwrite: z.boolean().optional(),
          expectedText: z.string().max(2000).optional(),
          correction: z
            .object({
              expectedText: z.string().max(2000),
              employeeId: z.number().int().positive(),
              date: dateSchema,
              action: z.enum(["in", "out"]),
              time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            })
            .optional(),
        })
        .parse(req.body);
      res.json(
        await service.retryEvent(id, overwrite, correction, expectedText),
      );
    }),
  );
  app.post(
    "/api/whatsapp/sync/clear",
    wrap(async (_req, res) => {
      await service.clearStuckSync();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/whatsapp/sync",
    wrap(async (req, res) => {
      const selection = selectionSchema.parse(req.body || {});
      if (service.status.syncing)
        throw fail(
          "The previous request is finishing. Try Sync again in a few seconds.",
          409,
        );
      if (selection.all || selection.dates) {
        await transaction(async (c) => {
          await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
          const [rows] = await c.execute(
            "SELECT config FROM whatsapp_config WHERE id=1",
          );
          const cfg = parse(rows[0].config);
          if (cfg.syncProgress || service.status.syncing)
            throw fail(
              "A sync is already running. Finish it before starting another selection.",
              409,
            );
          if (!cfg.enabled && !cfg.leaveEnabled)
            throw fail("Enable importing before syncing.");
          const dates = selection.dates
            ? [...new Set(selection.dates)].sort()
            : null;
          cfg.revision = Math.max(Date.now(), (cfg.revision || 0) + 1);
          cfg.syncProgress = {
            phase: "fetch",
            cursor: null,
            scanned: 0,
            startedAt: Math.floor(Date.now() / 1000),
            fullScan: !dates,
            recoverHistory: !cfg.resumeFromCache,
            dates,
            cutoff: dates
              ? Math.max(cfg.since || 0, dayBounds(dates[0], cfg.timeZone)[0])
              : cfg.since || 0,
          };
          await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
            JSON.stringify(cfg),
          ]);
        });
      }
      await service.poll();
      res.json({
        ...service.status,
        progress: (await service.config()).syncProgress,
      });
    }),
  );
  return service;
}
