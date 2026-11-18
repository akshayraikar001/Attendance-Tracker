import { createGroupMessages } from "./group-messages.js";
import { collectLeaveRequest } from "./leave.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { calculate, resolveRules } from "./rules.js";
import { chateryRequest, ensureChatery } from "../integrations/chatery.js";
import {
  dayBounds,
  localMessageTime,
  parseAttendanceMessage,
  senderIdentity,
} from "../utils/whatsapp-parser.js";
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const sourceKey = (cfg) => hash([cfg.sessionId, cfg.groupId]);
const earliest = (...values) => {
  const valid = values
    .map(Number)
    .filter((v) => Number.isSafeInteger(v) && v > 0);
  return valid.length ? Math.min(...valid) : 0;
};
// Keep each device/group's original import boundary. Cursors cannot be reused
// after switching because their queued pages belong to the previous source.
export async function rememberSource(c, old, target, now = Date.now()) {
  const groupHistory = { ...old.groupHistory };
  if (old.groupId) {
    const key = sourceKey(old);
    groupHistory[key] = {
      since: earliest(groupHistory[key]?.since, old.since),
    };
  }
  if (!target.groupId) return { groupHistory, since: 0 };
  const key = sourceKey(target);
  // Recover older installations whose group switch already moved the cutoff.
  // Existing message history is evidence of the earlier import boundary.
  const [history] = await c.execute(
    `SELECT MIN(timestamp) AS firstMessage FROM (
      SELECT timestamp FROM whatsapp_events WHERE sessionId=? AND groupId=?
      UNION ALL
      SELECT timestamp FROM leave_requests WHERE sessionId=? AND groupId=?
    ) AS messages`,
    [target.sessionId, target.groupId, target.sessionId, target.groupId],
  );
  const since =
    earliest(groupHistory[key]?.since, history[0].firstMessage) ||
    (target.enabled || target.leaveEnabled ? Math.floor(now / 1000) : 0);
  groupHistory[key] = { since };
  return { groupHistory, since };
}
export const configSchema = z
  .object({
    enabled: z.boolean(),
    leaveEnabled: z.boolean().default(false),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    groupId: z.string().max(160),
    groupName: z.string().max(200).default(""),
    timeZone: z.string().max(100).default(""),
    allowEditedMessages: z.boolean().default(false),
    autoApprove: z.boolean().default(false),
    autoOverwrite: z.boolean().default(false),
    messagesPerSync: z.number().int().min(1).max(2000).default(200),
    syncIntervalMinutes: z.number().int().min(1).max(1440).default(5),
  })
  .superRefine((c, ctx) => {
    if (
      (c.enabled || c.leaveEnabled) &&
      (!c.groupId.endsWith("@g.us") || !c.timeZone)
    )
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
  let resetGeneration = 0;
  let lastAttempt = null;
  const status = { lastSync: null, error: null, syncing: false };
  async function config() {
    const [row] = await query("SELECT config FROM whatsapp_config WHERE id=1");
    let stored = parse(row.config);
    if (stored.groupHistoryVersion !== 1) {
      stored = await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const current = parse(rows[0].config);
        if (current.groupHistoryVersion === 1) return current;
        const history = await rememberSource(c, current, current, now());
        const repaired =
          history.since > 0 && history.since < (current.since || 0);
        const next = { ...current, ...history, groupHistoryVersion: 1 };
        if (repaired) {
          next.syncProgress = null;
          next.lastHistoryScan = 0;
          next.checkedThrough = 0;
          next.revision = Math.max(now(), (current.revision || 0) + 1);
        }
        await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
          JSON.stringify(next),
        ]);
        return next;
      });
    }
    return { ...stored, ...configSchema.parse(stored) };
  }
  async function ingest(
    message,
    sessionId,
    retry = false,
    overwrite = false,
    expectedRevision = null,
    manualApproval = false,
    correction = null,
    reviewOnly = false,
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
        (!cfg.enabled && !reviewOnly) ||
        cfg.sessionId !== sessionId ||
        cfg.groupId !== message.chatId ||
        (!reviewOnly &&
          !manualApproval &&
          Number(message.timestamp) < cfg.since) ||
        Number(message.timestamp) > Date.now() / 1000 + 86400
      )
        return;
      const [events] = await c.execute(
        "SELECT * FROM whatsapp_events WHERE id=?",
        [id],
      );
      const previous = events[0];
      if (manualApproval && previous && previous.text !== message.content)
        throw fail("Message changed. Refresh and review again.", 409);
      if (correction && correction.expectedText !== message.content)
        throw fail("Message changed. Refresh and review again.", 409);
      const changed = Boolean(previous && previous.text !== message.content);
      const isEdited = Boolean(
        previous?.isEdited || message.isEdited || changed,
      );
      const parsed =
        correction ||
        parseAttendanceMessage(
          message.content,
          Number(previous?.timestamp || message.timestamp),
          cfg.timeZone,
        );
      if (!parsed && !previous && !isEdited && !reviewOnly) return;
      if (changed) {
        await c.execute(
          "UPDATE whatsapp_events SET previousText=text,text=?,isEdited=1,correction=NULL,state='review',clearedAt=NULL WHERE id=?",
          [message.content, id],
        );
      }
      if (reviewOnly && previous) {
        await c.execute(
          "UPDATE whatsapp_events SET clearedAt=NULL,manualOnly=1 WHERE id=?",
          [id],
        );
        if (!changed) return { state: previous.state, reason: previous.reason };
      }
      const identity = senderIdentity(message) || "unresolved";
      const recoveringSender =
        events[0]?.senderId === "unresolved" && identity !== "unresolved";
      if (
        events.length &&
        !changed &&
        ((!retry && !recoveringSender) || events[0].state !== "review")
      )
        return;
      if (events.length && identity !== "unresolved")
        await c.execute(
          "UPDATE whatsapp_events SET senderId=?,senderName=? WHERE id=?",
          [
            identity,
            String(message.senderName || events[0].senderName || "").slice(
              0,
              200,
            ),
            id,
          ],
        );
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
      if (reviewOnly) {
        await c.execute(
          "UPDATE whatsapp_events SET manualOnly=1,isEdited=? WHERE id=?",
          [isEdited ? 1 : 0, id],
        );
        return finish(
          "review",
          "Selected for review.",
          previous?.employeeId || null,
          parsed?.date || null,
        );
      }
      if (previous?.manualOnly && !manualApproval)
        return finish(
          "review",
          "Manual approval required.",
          previous.employeeId,
          previous.date,
        );
      if (previous?.correction && !manualApproval && !changed)
        return finish(
          "review",
          "Corrected entry: approval required.",
          previous.employeeId,
          previous.date,
        );
      if (isEdited) {
        await c.execute("UPDATE whatsapp_events SET isEdited=1 WHERE id=?", [
          id,
        ]);
        if (!manualApproval || !cfg.allowEditedMessages)
          return finish(
            "review",
            cfg.allowEditedMessages
              ? "Edited message: approval required."
              : "Edited messages disabled.",
            previous?.employeeId || null,
            previous?.date || parsed?.date || null,
          );
      }
      if (!parsed) return finish("review", "Unrecognized attendance message.");
      if (identity === "unresolved" && !correction)
        return finish(
          "review",
          "WhatsApp did not provide the sender identity. Retry to fetch the sender again.",
        );
      if (parsed.reason) return finish("review", parsed.reason);
      const [linked] = correction
        ? await c.execute(
            "SELECT * FROM employees WHERE id=? AND status='Active'",
            [correction.employeeId],
          )
        : await c.execute(
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
        return finish("review", "Awaiting approval.", employee.id, parsed.date);
      if (correction)
        await c.execute("UPDATE whatsapp_events SET correction=? WHERE id=?", [
          JSON.stringify(correction),
          id,
        ]);
      let date = parsed.date,
        overnight = false;
      let [rows] = await c.execute(
        "SELECT * FROM attendance WHERE employeeId=? AND date=? FOR UPDATE",
        [employee.id, date],
      );
      if (!correction && !rows.length && parsed.action === "out") {
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
      const today = localMessageTime(
        Math.floor(now() / 1000),
        cfg.timeZone,
      ).date;
      const yesterday = new Date(today + "T12:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      // Automatic sync retries reviews too; only the explicit approval route
      // may bypass the date window. Use the resolved attendance date for OUT.
      if (
        !manualApproval &&
        (date < yesterday.toISOString().slice(0, 10) || date > today)
      )
        return finish(
          "review",
          "Automatic approval only applies to today and yesterday. Approve this date manually.",
          employee.id,
          date,
        );
      const old = rows[0];
      let automaticAbsence = false;
      if (
        old?.mode === "manual" &&
        old.status === "Absent" &&
        !old.inTime &&
        !old.outTime &&
        parsed.action === "in"
      ) {
        const [generated] = await c.execute(
          "SELECT snapshotHash FROM auto_absences WHERE employeeId=? AND date=?",
          [employee.id, date],
        );
        automaticAbsence = generated[0]?.snapshotHash === hash(old);
      }
      if (old) {
        const [owned] = await c.execute(
          "SELECT snapshotHash FROM whatsapp_days WHERE employeeId=? AND date=?",
          [employee.id, date],
        );
        if (
          (!owned.length || owned[0].snapshotHash !== hash(old)) &&
          !overwrite &&
          !automaticAbsence
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
        notes: automaticAbsence
          ? "Auto from WA; absence replaced."
          : old?.notes || "Auto from WA",
      };
      const [settings] = await c.execute(
        "SELECT rules FROM settings WHERE id=1",
      );
      const rules = resolveRules(parse(settings[0].rules), employee, date);
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
  async function retryEvent(
    id,
    overwrite = false,
    correction = null,
    expectedText = null,
  ) {
    const [row] = await query("SELECT * FROM whatsapp_events WHERE id=?", [id]);
    if (!row) throw fail("Message not found.", 404);
    if (expectedText !== null && row.text !== expectedText)
      throw fail("Message changed. Refresh and review again.", 409);
    const cfg = await config();
    if (
      !cfg.enabled ||
      cfg.sessionId !== row.sessionId ||
      cfg.groupId !== row.groupId
    )
      return {
        state: row.state,
        reason: "Enable this group to retry its messages.",
      };
    if (row.state !== "review") return { state: row.state, reason: row.reason };
    let message;
    if (row.senderId === "unresolved" && !correction) {
      // Retry must refresh the original message, not manufacture a LID from
      // the literal string 'unresolved'. Bound network work and detect loops.
      if (request === chateryRequest) await ensureChatery();
      let cursor = null;
      const cursors = new Set();
      for (let page = 0; page < 20; page++) {
        const data = await request("/chats/messages", {
          sessionId: row.sessionId,
          chatId: row.groupId,
          limit: 100,
          cursor,
        });
        if (!Array.isArray(data.messages))
          throw fail("Chatery returned an invalid message list.", 502);
        message = data.messages.find(
          (m) => m.id === row.messageId && m.chatId === row.groupId,
        );
        if (message || !data.hasMore) break;
        if (!data.cursor || cursors.has(data.cursor))
          throw fail(
            "Chatery message pagination stalled. Try syncing again.",
            502,
          );
        cursor = data.cursor;
        cursors.add(cursor);
      }
      if (!message || !senderIdentity(message))
        return {
          state: "review",
          reason:
            "The sender is still unavailable from WhatsApp. Sync history and retry; no employee has been assigned.",
        };
    } else {
      const [kind, identity] = row.senderId.split(":");
      message = {
        id: row.messageId,
        chatId: row.groupId,
        isGroup: true,
        type: "text",
        content: row.text,
        timestamp: Number(row.timestamp),
        sender: identity + (kind === "phone" ? "@s.whatsapp.net" : "@lid"),
        senderName: row.senderName,
      };
    }
    return (
      (await ingest(
        message,
        row.sessionId,
        true,
        overwrite,
        cfg.revision || 0,
        true,
        correction,
      )) || {
        state: row.state,
        reason: "Message is not ready to approve. Refresh and retry.",
      }
    );
  }
  async function clearStuckSync() {
    await transaction(async (c) => {
      await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      const [rows] = await c.execute(
        "SELECT config FROM whatsapp_config WHERE id=1",
      );
      const cfg = parse(rows[0].config);
      cfg.revision = Math.max(now(), (cfg.revision || 0) + 1);
      cfg.syncProgress = null;
      // Keep queued messages and checkpoints. Wait for an explicit Sync, then
      // scan cached messages from the newest page without requesting phone history.
      cfg.resumeFromCache = true;
      await c.execute("UPDATE whatsapp_config SET config=? WHERE id=1", [
        JSON.stringify(cfg),
      ]);
    });
    resetGeneration += 1;
    status.error = null;
    lastAttempt = null;
  }
  async function poll({ automatic = false } = {}) {
    if (running) return;
    running = true;
    const generation = resetGeneration;
    status.syncing = true;
    try {
      const cfg = await config();
      if (!cfg.enabled && !cfg.leaveEnabled) return;
      if (automatic && cfg.resumeFromCache) return;
      if (
        automatic &&
        lastAttempt !== null &&
        now() - lastAttempt <
          (cfg.syncProgress?.waitingForHistory
            ? 15000
            : status.error
              ? 60000
              : cfg.syncProgress
                ? 15000
                : cfg.syncIntervalMinutes * 60000)
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
        recoverHistory: cfg.resumeFromCache ? false : !automatic,
        cutoff: fullScan
          ? cfg.since || 0
          : Math.max(cfg.since || 0, (cfg.checkedThrough || 0) - 86400),
      };
      const today = localMessageTime(
        Math.floor(now() / 1000),
        cfg.timeZone,
      ).date;
      const yesterday = new Date(today + "T12:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const oldestAutomaticDate = yesterday.toISOString().slice(0, 10);
      // Reconnection can deliver yesterday's messages after today's checkpoint
      // advances. Always scan the whole local yesterday, not only 24 hours back.
      // Also widen saved fetch progress from older versions; keep date selections
      // and the group's original import boundary intact.
      if (!progress.dates && progress.phase === "fetch") {
        progress.cutoff = Math.max(
          cfg.since || 0,
          Math.min(
            progress.cutoff,
            dayBounds(oldestAutomaticDate, cfg.timeZone)[0],
          ),
        );
      }
      // Revisit the earlier IN even when the OUT was imported on a previous
      // scan. Keep the wider cutoff in persisted progress across page limits.
      if (cfg.enabled && !progress.dates && progress.phase === "fetch") {
        const waiting = await query(
          `SELECT MIN(timestamp) AS earliest FROM whatsapp_events
           WHERE sessionId=? AND groupId=? AND state='review' AND reason=?
             AND date>=? AND date<=?`,
          [
            cfg.sessionId,
            cfg.groupId,
            "Clock-out arrived without a clock-in. Import or enter clock-in first.",
            oldestAutomaticDate,
            today,
          ],
        );
        if (waiting[0]?.earliest)
          progress.cutoff = Math.max(
            cfg.since || 0,
            Math.min(progress.cutoff, Number(waiting[0].earliest) - 2 * 86400),
          );
      }
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
            (!latest.enabled && !latest.leaveEnabled) ||
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
      if (cfg.resumeFromCache) {
        progress.recoverHistory = false;
        if (
          !(await update(async (_c, latest) => {
            latest.resumeFromCache = false;
            latest.syncProgress = progress;
          }))
        )
          return;
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
          recoverHistory: progress.recoverHistory ?? !automatic,
        });
        if (!Array.isArray(data.messages) || data.messages.length > limit)
          throw new Error("Chatery returned an invalid message list.");
        if (data.historyPending) {
          // Keep the exact cursor and manual recovery intent so the background
          // worker resumes this request after the phone responds.
          progress.waitingForHistory = true;
          progress.recoverHistory = true;
          if (
            !(await update(async (_c, latest) => {
              latest.syncProgress = progress;
            }))
          )
            return;
          throw new Error(
            "WhatsApp history recovery is pending. It will retry automatically; the scan has not advanced.",
          );
        }
        progress.waitingForHistory = false;
        const scannedCount = data.scannedCount ?? data.messages.length;
        if (
          !Number.isSafeInteger(scannedCount) ||
          scannedCount < data.messages.length ||
          scannedCount > limit
        )
          throw new Error("Chatery returned an invalid message count.");
        // Decide the boundary before discarding older messages on this page.
        // Looking behind recent OUTs also covers an overnight IN; normal
        // employee matching, deduplication and approval still happen in ingest.
        if (cfg.enabled && !progress.dates) {
          for (const message of data.messages) {
            if (
              message.chatId !== cfg.groupId ||
              !message.isGroup ||
              message.type !== "text" ||
              typeof message.content !== "string" ||
              message.content.length > 2000 ||
              !Number.isSafeInteger(Number(message.timestamp)) ||
              Number(message.timestamp) > now() / 1000 + 300
            )
              continue;
            const parsed = parseAttendanceMessage(
              message.content,
              Number(message.timestamp),
              cfg.timeZone,
            );
            if (
              parsed?.action === "out" &&
              !parsed.reason &&
              parsed.date >= oldestAutomaticDate &&
              parsed.date <= today
            )
              progress.cutoff = Math.max(
                cfg.since || 0,
                Math.min(
                  progress.cutoff,
                  Number(message.timestamp) - 2 * 86400,
                ),
              );
          }
        }
        const complete =
          !data.hasMore ||
          data.messages.some((m) => Number(m.timestamp) < progress.cutoff);
        if (
          !complete &&
          (!scannedCount || !data.cursor || cursors.has(data.cursor))
        )
          throw new Error(
            "Chatery message pagination stalled. Saved sync progress is preserved; try syncing again.",
          );
        const next = {
          ...progress,
          scanned: progress.scanned + scannedCount,
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
              progress.dates &&
              !progress.dates.includes(
                localMessageTime(Number(m.timestamp), cfg.timeZone).date,
              )
            )
              continue;
            await collectLeaveRequest(c, m, cfg);
            const id = hash([cfg.sessionId, m.chatId, m.id]);
            const [known] = await c.execute(
              "SELECT text FROM whatsapp_events WHERE id=?",
              [id],
            );
            if (
              !known.length &&
              !m.isEdited &&
              !parseAttendanceMessage(
                m.content,
                Number(m.timestamp),
                cfg.timeZone,
              )
            )
              continue;
            await c.execute(
              "INSERT IGNORE INTO whatsapp_sync_queue (id,timestamp,message) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM whatsapp_events WHERE id=? AND BINARY text=BINARY ? AND (state<>'review' OR (?=0 AND senderId<>'unresolved')))",
              [
                id,
                Number(m.timestamp),
                JSON.stringify(m),
                id,
                m.content,
                cfg.autoApprove ? 1 : 0,
              ],
            );
          }
          latest.syncProgress = next;
        });
        if (!saved) return;
        Object.assign(progress, next);
        fetched += scannedCount;
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
        // A delayed IN can arrive in a later scan than its OUT. Retry only
        // missing-IN reviews once a clock-in exists, even if the provider no
        // longer returns the OUT in the overlapping history window.
        if (cfg.enabled && cfg.autoApprove) {
          const waiting = await query(
            `SELECT e.* FROM whatsapp_events e
             WHERE e.sessionId=? AND e.groupId=? AND e.state='review'
               AND e.reason=? AND EXISTS (
                 SELECT 1 FROM attendance a WHERE a.employeeId=e.employeeId
                   AND a.inTime IS NOT NULL AND (a.date=e.date OR
                     (a.date=DATE_SUB(e.date, INTERVAL 1 DAY) AND a.outTime IS NULL))
               ) ORDER BY e.timestamp,e.id LIMIT ?`,
            [
              cfg.sessionId,
              cfg.groupId,
              "Clock-out arrived without a clock-in. Import or enter clock-in first.",
              cfg.messagesPerSync,
            ],
          );
          for (const event of waiting) {
            if (
              progress.dates &&
              !progress.dates.includes(
                localMessageTime(Number(event.timestamp), cfg.timeZone).date,
              )
            )
              continue;
            const [kind, identity] = event.senderId.split(":");
            await ingest(
              {
                id: event.messageId,
                chatId: event.groupId,
                isGroup: true,
                type: "text",
                content: event.text,
                timestamp: Number(event.timestamp),
                sender:
                  identity + (kind === "phone" ? "@s.whatsapp.net" : "@lid"),
                senderName: event.senderName,
              },
              cfg.sessionId,
              true,
              cfg.autoOverwrite,
              revision,
            );
          }
        }
        if (
          !(await update(async (c, latest) => {
            const [remaining] = await c.execute(
              "SELECT COUNT(*) AS total FROM whatsapp_sync_queue",
            );
            if (Number(remaining[0].total) === 0) {
              latest.syncProgress = null;
              if (!progress.dates) latest.checkedThrough = progress.startedAt;
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
      if (generation === resetGeneration) status.error = error.message;
    } finally {
      running = false;
      status.syncing = false;
    }
  }
  const groupInbox = createGroupMessages({
    config,
    query,
    transaction,
    request,
    ensure: async () => {
      if (request === chateryRequest) await ensureChatery();
    },
  });
  async function groupMessages(input = {}) {
    return groupInbox.list(input);
  }
  async function scanGroupMessages(input = {}) {
    await groupInbox.scan(input);
    return groupInbox.list(input);
  }
  async function clearGroupMessages(input) {
    return groupInbox.clear(input);
  }
  async function selectGroupMessage({ messageId, sessionId, groupId }) {
    const cfg = await config();
    if (cfg.sessionId !== sessionId || cfg.groupId !== groupId)
      throw fail("Group changed. Refresh and try again.", 409);
    // Prefer the current connector message; retained scan history supports review
    // when the connector has since evicted the message.
    let message = await groupInbox.saved(messageId, cfg);
    if (request === chateryRequest) await ensureChatery();
    try {
      const latest = await request("/chats/group-messages", {
        sessionId,
        chatId: groupId,
        messageId,
      });
      message = latest.message || message;
    } catch (error) {
      if (!message) throw error;
    }
    if (
      !message ||
      message.id !== messageId ||
      message.chatId !== groupId ||
      !message.isGroup
    )
      throw fail("Message unavailable. Refresh the group messages.", 404);
    const result = await ingest(
      {
        ...message,
        type: "text",
        content:
          typeof message.content === "string"
            ? message.content
            : message.caption || "[" + message.type + "]",
      },
      sessionId,
      true,
      false,
      cfg.revision || 0,
      false,
      null,
      true,
    );
    if (!result)
      throw fail("Message could not be selected. Refresh and try again.", 409);
    const [event] = await query("SELECT * FROM whatsapp_events WHERE id=?", [
      hash([sessionId, groupId, messageId]),
    ]);
    return event;
  }
  return {
    config,
    ingest,
    poll,
    retryEvent,
    clearStuckSync,
    groupMessages,
    scanGroupMessages,
    clearGroupMessages,
    selectGroupMessage,
    status,
  };
}
