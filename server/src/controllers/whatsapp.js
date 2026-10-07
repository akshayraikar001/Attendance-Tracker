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
export function registerWhatsApp({ app, wrap, query, transaction, audit }) {
  const service = createWhatsAppService({ query, transaction, audit });
  app.use("/api/whatsapp", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
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
        "SELECT * FROM whatsapp_events WHERE groupId=? ORDER BY timestamp DESC LIMIT 100",
        [cfg.groupId],
      );
      res.json({
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
      const cfg = await service.config();
      await query("DELETE FROM whatsapp_events WHERE groupId=?", [cfg.groupId]);
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
      const [row] = await query("SELECT * FROM whatsapp_events WHERE id=?", [
        id,
      ]);
      if (!row) throw fail("Message not found.", 404);
      const sender = row.senderId.startsWith("phone:")
        ? row.senderId.slice(6) + "@s.whatsapp.net"
        : row.senderId.slice(4) + "@lid";
      const result = await service.ingest(
        {
          id: row.messageId,
          chatId: row.groupId,
          isGroup: true,
          type: "text",
          content: row.text,
          timestamp: row.timestamp,
          sender,
          senderName: row.senderName,
        },
        row.sessionId,
        true,
        overwrite,
      );
      res.json(
        result || {
          state: row.state,
          reason: "Enable this group to retry its messages.",
        },
      );
    }),
  );
  app.post(
    "/api/whatsapp/approve",
    wrap(async (req, res) => {
      const { id, overwrite = true } = z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          overwrite: z.boolean().optional(),
        })
        .parse(req.body);
      const [row] = await query("SELECT * FROM whatsapp_events WHERE id=?", [
        id,
      ]);
      if (!row) throw fail("Message not found.", 404);
      const sender = row.senderId.startsWith("phone:")
        ? row.senderId.slice(6) + "@s.whatsapp.net"
        : row.senderId.slice(4) + "@lid";
      const result = await service.ingest(
        {
          id: row.messageId,
          chatId: row.groupId,
          isGroup: true,
          type: "text",
          content: row.text,
          timestamp: row.timestamp,
          sender,
          senderName: row.senderName,
        },
        row.sessionId,
        true,
        overwrite,
      );
      res.json(
        result || {
          state: row.state,
          reason: "Message is not ready to approve.",
        },
      );
    }),
  );
  app.post(
    "/api/whatsapp/sync",
    wrap(async (req, res) => {
      await service.poll();
      res.json(service.status);
    }),
  );
  return service;
}
