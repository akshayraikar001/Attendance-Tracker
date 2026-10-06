import { saveEmployeePhone } from "./employee-phone.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { calculate, resolveRules } from "./rules.js";
import { chateryRequest, ensureChatery } from "./chatery.js";
import { parseAttendanceMessage, senderIdentity } from "./whatsapp-parser.js";
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export const configSchema = z
  .object({
    enabled: z.boolean(),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    groupId: z.string().max(160),
    groupName: z.string().max(200).default(""),
    timeZone: z.string().max(100).default(""),
    autoApprove: z.boolean().default(false),
    autoOverwrite: z.boolean().default(false),
    messagesPerSync: z.number().int().min(1).max(2000).default(200),
    syncIntervalMinutes: z.number().int().min(1).max(1440).default(5),
  })
  .superRefine((c, ctx) => {
    if (c.enabled && (!c.groupId.endsWith("@g.us") || !c.timeZone))
      ctx.addIssue({
        code: "custom",
        message: "Select a WhatsApp group and timezone before enabling.",
      });
    if (c.timeZone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: c.timeZone });
      } catch {
        ctx.addIssue({ code: "custom", message: "Choose a valid timezone." });
      }
  });
export function createWhatsAppService({
  query,
  transaction,
  audit,
  request = chateryRequest,
  now = Date.now,
}) {
  let running = false;
  let lastAttempt = null;
  const status = { lastSync: null, error: null };
  async function config() {
    const [row] = await query("SELECT config FROM whatsapp_config WHERE id=1");
    const stored = parse(row.config);
    return { ...stored, ...configSchema.parse(stored) };
  }
  async function ingest(
    message,
    sessionId,
    retry = false,
    overwrite = false,
    expectedRevision = null,
  ) {
    if (
      !message ||
      !message.isGroup ||
      message.type !== "text" ||
      typeof message.content !== "string" ||
      !message.id ||
      message.content.length > 2000 ||
      !Number.isSafeInteger(Number(message.timestamp))
    )
      return;
    const id = hash([sessionId, message.chatId, message.id]);
    return transaction(async (c) => {
      await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      const [configs] = await c.execute(
        "SELECT config FROM whatsapp_config WHERE id=1",
      );
      const cfg = parse(configs[0].config);
      if (
        (expectedRevision !== null &&
          (cfg.revision || 0) !== expectedRevision) ||
        !cfg.enabled ||
        cfg.sessionId !== sessionId ||
        cfg.groupId !== message.chatId ||
        Number(message.timestamp) < cfg.since ||
        Number(message.timestamp) > Date.now() / 1000 + 86400
      )
        return;
      const parsed = parseAttendanceMessage(
        message.content,
        Number(message.timestamp),
        cfg.timeZone,
      );
      if (!parsed) return;
      const [events] = await c.execute(
        "SELECT * FROM whatsapp_events WHERE id=?",
        [id],
      );
      if (events.length && (!retry || events[0].state !== "review")) return;
      const identity = senderIdentity(message) || "unresolved";
      if (!events.length)
        await c.execute(
          "INSERT INTO whatsapp_events (id,sessionId,groupId,messageId,senderId,senderName,text,timestamp,state,reason) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            sessionId,
            message.chatId,
            String(message.id).slice(0, 160),
            identity,
            String(message.senderName || "").slice(0, 200),
            message.content,
            Number(message.timestamp),
            "review",
            "Awaiting processing",
          ],
        );
      const finish = async (state, reason, employeeId = null, date = null) => {
        await c.execute(
          "UPDATE whatsapp_events SET state=?,reason=?,employeeId=?,date=? WHERE id=?",
          [state, reason, employeeId, date, id],
        );
        return { state, reason };
      };
      if (parsed.reason) return finish("review", parsed.reason);
      const [linked] = await c.execute(
        identity.startsWith("phone:")
          ? "SELECT DISTINCT e.* FROM employees e LEFT JOIN whatsapp_links l ON l.employeeId=e.id WHERE e.status='Active' AND (e.phone=? OR l.identity=?)"
          : "SELECT e.* FROM whatsapp_links l JOIN employees e ON e.id=l.employeeId WHERE l.identity=? AND e.status='Active'",
        identity.startsWith("phone:")
          ? ["+" + identity.slice(6), identity]
          : [identity],
      );
      if (!linked.length)
        return finish(
          "review",
          "Link this WhatsApp sender to an active employee.",
        );
      const employee = linked[0];
      if (cfg.autoApprove === false && !retry)
        return finish(
          "review",
          "Awaiting approval. Enable auto-approve to apply matched messages automatically.",
          employee.id,
          parsed.date,
        );
      let date = parsed.date,
        overnight = false;
      let [rows] = await c.execute(
        "SELECT * FROM attendance WHERE employeeId=? AND date=? FOR UPDATE",
        [employee.id, date],
      );
      if (!rows.length && parsed.action === "out") {
        const previous = new Date(date + "T12:00:00Z");
        previous.setUTCDate(previous.getUTCDate() - 1);
        const prevDate = previous.toISOString().slice(0, 10);
        const [prior] = await c.execute(
          "SELECT * FROM attendance WHERE employeeId=? AND date=? AND mode='time' AND outTime IS NULL FOR UPDATE",
          [employee.id, prevDate],
        );
        if (prior.length) {
          rows = prior;
          date = prevDate;
          overnight = true;
        }
      }
      const old = rows[0];
      if (old) {
        const [owned] = await c.execute(
          "SELECT snapshotHash FROM whatsapp_days WHERE employeeId=? AND date=?",
          [employee.id, date],
        );
        if (
          (!owned.length || owned[0].snapshotHash !== hash(old)) &&
          !overwrite
        )
          return finish(
            "review",
            "Existing attendance was entered or changed manually; review it in Attendance.",
            employee.id,
            date,
          );
        const existing = parsed.action === "in" ? old.inTime : old.outTime;
        if (existing && !overwrite)
          return finish(
            existing === parsed.time ? "ignored" : "review",
            existing === parsed.time
              ? "This time is already recorded."
              : "A different time is already recorded; review it in Attendance.",
            employee.id,
            date,
          );
      }
      if (parsed.action === "out" && !old?.inTime)
        return finish(
          "review",
          "Clock-out arrived without a clock-in. Import or enter clock-in first.",
          employee.id,
          date,
        );
      const entry = {
        employeeId: employee.id,
        date,
        mode: "time",
        inTime: parsed.action === "in" ? parsed.time : old.inTime,
        outTime: parsed.action === "out" ? parsed.time : old?.outTime || null,
        overnight,
        notes: old?.notes || "Imported from WhatsApp",
      };
      const [settings] = await c.execute(
        "SELECT rules FROM settings WHERE id=1",
      );
      const rules = resolveRules(parse(settings[0].rules), employee);
      let result;
      try {
        result = calculate(entry, rules);
      } catch (error) {
        return finish("review", error.message, employee.id, date);
      }
      await c.execute(
        `INSERT INTO attendance (employeeId,date,mode,inTime,outTime,overnight,status,workedMinutes,lateMinutes,earlyMinutes,overtimeMinutes,notes,rules) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),inTime=VALUES(inTime),outTime=VALUES(outTime),overnight=VALUES(overnight),status=VALUES(status),workedMinutes=VALUES(workedMinutes),lateMinutes=VALUES(lateMinutes),earlyMinutes=VALUES(earlyMinutes),overtimeMinutes=VALUES(overtimeMinutes),notes=VALUES(notes),rules=VALUES(rules)`,
        [
          employee.id,
          date,
          "time",
          entry.inTime,
          entry.outTime,
          entry.overnight,
          result.status,
          result.workedMinutes,
          result.lateMinutes,
          result.earlyMinutes,
          result.overtimeMinutes,
          entry.notes,
          JSON.stringify(rules),
        ],
      );
      const [after] = await c.execute(
        "SELECT * FROM attendance WHERE employeeId=? AND date=?",
        [employee.id, date],
      );
      await c.execute(
        "INSERT INTO whatsapp_days (employeeId,date,snapshotHash) VALUES (?,?,?) ON DUPLICATE KEY UPDATE snapshotHash=VALUES(snapshotHash)",
        [employee.id, date, hash(after[0])],
      );
      await audit(
        c,
        "WhatsApp attendance recorded",
        "attendance",
        employee.id,
        {
          messageId: message.id,
          groupId: message.chatId,
          before: old || null,
          after: entry,
        },
      );
      return finish(
        "applied",
        `Clock-${parsed.action} recorded.`,
        employee.id,
        date,
      );
    });
  }
  async function poll({ automatic = false } = {}) {
    if (running) return;
    running = true;
    try {
      const cfg = await config();
      if (!cfg.enabled) return;
      if (
        automatic &&
        lastAttempt !== null &&
        now() - lastAttempt < cfg.syncIntervalMinutes * 60000
      )
        return;
      lastAttempt = now();
      if (request === chateryRequest) await ensureChatery();
      const revision = cfg.revision || 0;
      // Queue pages durably before applying them oldest-first. Chatery pages
      // newest-first, so applying a page immediately could import OUT before IN.
      const fullScan =
        !cfg.lastHistoryScan || now() / 1000 - cfg.lastHistoryScan >= 86400;
      const progress = cfg.syncProgress || {
        phase: "fetch",
        cursor: null,
        scanned: 0,
        startedAt: Math.floor(now() / 1000),
        fullScan,
        cutoff: fullScan
          ? cfg.since || 0
          : Math.max(cfg.since || 0, (cfg.checkedThrough || 0) - 86400),
      };
      // Settings updates use the same lock: stale requests cannot advance or
      // discard the new source's queue. Page + cursor are committed together.
      async function update(fn) {
        return transaction(async (c) => {
          await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
          const [rows] = await c.execute(
            "SELECT config FROM whatsapp_config WHERE id=1",
          );
          const latest = parse(rows[0].config);
          if (
            !latest.enabled ||
            latest.sessionId !== cfg.sessionId ||
            latest.groupId !== cfg.groupId ||
            (latest.revision || 0) !== revision
          )
            return false;
          await fn(c, latest);
          await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
            JSON.stringify(latest),
          ]);
          return true;
        });
      }
      let fetched = 0;
      const cursors = new Set([progress.cursor]);
      while (progress.phase === "fetch" && fetched < cfg.messagesPerSync) {
        const limit = Math.min(100, cfg.messagesPerSync - fetched);
        const data = await request("/chats/messages", {
          sessionId: cfg.sessionId,
          chatId: cfg.groupId,
          limit,
          cursor: progress.cursor,
        });
        if (!Array.isArray(data.messages) || data.messages.length > limit)
          throw new Error("Chatery returned an invalid message list.");
        const complete =
          !data.hasMore ||
          data.messages.some((m) => Number(m.timestamp) < progress.cutoff);
        if (
          !complete &&
          (!data.messages.length || !data.cursor || cursors.has(data.cursor))
        )
          throw new Error(
            "Chatery message pagination stalled. Saved sync progress is preserved; try syncing again.",
          );
        const next = {
          ...progress,
          scanned: progress.scanned + data.messages.length,
          cursor: complete ? null : data.cursor,
          phase: complete ? "apply" : "fetch",
        };
        const saved = await update(async (c, latest) => {
          for (const m of data.messages) {
            if (
              !m.id ||
              m.chatId !== cfg.groupId ||
              !m.isGroup ||
              m.type !== "text" ||
              typeof m.content !== "string" ||
              m.content.length > 2000 ||
              !Number.isSafeInteger(Number(m.timestamp)) ||
              Number(m.timestamp) < progress.cutoff ||
              Number(m.timestamp) > now() / 1000 + 300
            )
              continue;
            if (
              !parseAttendanceMessage(
                m.content,
                Number(m.timestamp),
                cfg.timeZone,
              )
            )
              continue;
            const id = hash([cfg.sessionId, m.chatId, m.id]);
            await c.execute(
              "INSERT IGNORE INTO whatsapp_sync_queue (id,timestamp,message) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM whatsapp_events WHERE id=? AND (state<>'review' OR ?=0))",
              [
                id,
                Number(m.timestamp),
                JSON.stringify(m),
                id,
                cfg.autoApprove ? 1 : 0,
              ],
            );
          }
          latest.syncProgress = next;
        });
        if (!saved) return;
        Object.assign(progress, next);
        fetched += data.messages.length;
        cursors.add(data.cursor);
      }
      if (progress.phase === "apply") {
        const pending = await query(
          "SELECT * FROM whatsapp_sync_queue ORDER BY timestamp,id LIMIT ?",
          [cfg.messagesPerSync],
        );
        for (const row of pending) {
          await ingest(
            parse(row.message),
            cfg.sessionId,
            cfg.autoApprove,
            cfg.autoOverwrite,
            revision,
          );
          if (
            !(await update(async (c) => {
              await c.execute("DELETE FROM whatsapp_sync_queue WHERE id=?", [
                row.id,
              ]);
            }))
          )
            return;
        }
        if (
          !(await update(async (c, latest) => {
            const [remaining] = await c.execute(
              "SELECT COUNT(*) AS total FROM whatsapp_sync_queue",
            );
            if (Number(remaining[0].total) === 0) {
              latest.syncProgress = null;
              latest.checkedThrough = progress.startedAt;
              if (progress.fullScan)
                latest.lastHistoryScan = progress.startedAt;
            }
          }))
        )
          return;
      }
      status.lastSync = new Date(now()).toISOString();
      status.error = null;
    } catch (error) {
      status.error = error.message;
    } finally {
      running = false;
    }
  }
  return { config, ingest, poll, status };
}
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
      if (data.enabled) {
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
        const sameSource =
          old.groupId === data.groupId &&
          old.sessionId === data.sessionId &&
          old.timeZone === data.timeZone;
        const preserveProgress =
          sameSource &&
          (old.autoApprove ?? false) === data.autoApprove &&
          (old.autoOverwrite ?? false) === data.autoOverwrite;
        if (!preserveProgress)
          await c.execute("DELETE FROM whatsapp_sync_queue");
        // Resuming the same group catches messages posted while paused. Changing source starts now.
        const since =
          old.since &&
          old.groupId === data.groupId &&
          old.sessionId === data.sessionId
            ? old.since
            : data.enabled
              ? Math.floor(Date.now() / 1000)
              : 0;
        await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
          JSON.stringify({
            ...data,
            revision: Math.max(Date.now(), (old.revision || 0) + 1),
            since,
            syncProgress: preserveProgress ? old.syncProgress || null : null,
            lastHistoryScan: preserveProgress ? old.lastHistoryScan || 0 : 0,
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
