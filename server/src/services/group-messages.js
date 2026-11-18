import { createHash } from "node:crypto";
import { dayBounds, localMessageTime } from "../utils/whatsapp-parser.js";
import { groupMessageTimes } from "../../../shared/group-message-times.js";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const fail = (message) => Object.assign(new Error(message), { status: 409 });
export function createGroupMessages({
  config,
  query,
  transaction,
  request,
  ensure,
}) {
  let running = null;
  const source = (cfg) => ({ sessionId: cfg.sessionId, groupId: cfg.groupId });
  async function current(c, cfg) {
    const [rows] = await c.execute(
      "SELECT config FROM whatsapp_config WHERE id=1",
    );
    const latest = parse(rows[0].config);
    if (latest.sessionId !== cfg.sessionId || latest.groupId !== cfg.groupId)
      throw fail("Group changed. Refresh and try again.");
  }
  async function list({ date, offset = 0, history = false } = {}) {
    const cfg = await config();
    if (!cfg.groupId) throw fail("Select an attendance group.");
    const args = [cfg.sessionId, cfg.groupId];
    let where =
      "sessionId=? AND groupId=? AND clearedAt IS " +
      (history ? "NOT NULL" : "NULL");
    const timestamps = await query(
      "SELECT timestamp,COUNT(*) AS count FROM whatsapp_group_messages WHERE " +
        where +
        " GROUP BY timestamp",
      args,
    );
    const days = new Map();
    for (const row of timestamps) {
      const day = localMessageTime(
        Number(row.timestamp),
        cfg.timeZone || "UTC",
      ).date;
      days.set(day, (days.get(day) || 0) + Number(row.count));
    }
    if (date) {
      where += " AND timestamp>=? AND timestamp<?";
      args.push(...dayBounds(date, cfg.timeZone || "UTC"));
    }
    const rows = await query(
      "SELECT id,message FROM whatsapp_group_messages WHERE " +
        where +
        " ORDER BY timestamp DESC,id LIMIT 101 OFFSET ?",
      [...args, offset],
    );
    const messages = [];
    for (const row of rows.slice(0, 100)) {
      const m = parse(row.message);
      const [event] = await query(
        "SELECT state FROM whatsapp_events WHERE id=?",
        [row.id],
      );
      messages.push({
        ...m,
        ...groupMessageTimes(m.content || m.caption || ""),
        attendanceState: event?.state || null,
      });
    }
    const [scan] = await query(
      "SELECT state,scanned FROM whatsapp_group_scans WHERE id=?",
      [hash([cfg.sessionId, cfg.groupId])],
    );
    return {
      days: [...days]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, count]) => ({ date, count })),
      messages,
      hasMore: rows.length > 100,
      source: source(cfg),
      scan: scan || { state: "idle", scanned: 0 },
    };
  }
  async function scan({ start = false } = {}) {
    if (running) return running;
    running = scanPage(start);
    try {
      return await running;
    } finally {
      running = null;
    }
  }
  async function scanPage(start) {
    const cfg = await config();
    if (!cfg.groupId) throw fail("Select an attendance group.");
    const id = hash([cfg.sessionId, cfg.groupId]);
    const job = await transaction(async (c) => {
      await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      await current(c, cfg);
      await c.execute(
        "INSERT IGNORE INTO whatsapp_group_scans (id) VALUES (?)",
        [id],
      );
      const [rows] = await c.execute(
        "SELECT * FROM whatsapp_group_scans WHERE id=?",
        [id],
      );
      let row = rows[0];
      if (start || row.state === "idle") {
        await c.execute(
          "UPDATE whatsapp_group_scans SET version=version+1,pageCursor=NULL,state='scanning',scanned=0 WHERE id=?",
          [id],
        );
        row = {
          ...row,
          version: row.version + 1,
          pageCursor: null,
          state: "scanning",
          scanned: 0,
        };
      }
      return row;
    });
    if (!["scanning", "waiting"].includes(job.state)) return;
    await ensure();
    const data = await request("/chats/messages", {
      ...source(cfg),
      chatId: cfg.groupId,
      limit: 50,
      cursor: job.pageCursor,
      recoverHistory: true,
    });
    if (!Array.isArray(data.messages))
      throw fail("Invalid group message page.");
    if (
      !data.historyPending &&
      data.hasMore &&
      (!data.cursor || data.cursor === job.pageCursor)
    )
      throw fail("History scan stalled. Fetch again.");
    await transaction(async (c) => {
      await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      await current(c, cfg);
      const [jobs] = await c.execute(
        "SELECT version FROM whatsapp_group_scans WHERE id=?",
        [id],
      );
      if (jobs[0]?.version !== job.version) return;
      for (const m of data.messages) {
        if (
          !m.id ||
          m.chatId !== cfg.groupId ||
          !m.isGroup ||
          !Number.isSafeInteger(Number(m.timestamp))
        )
          continue;
        const message = {};
        for (const key of [
          "id",
          "chatId",
          "isGroup",
          "type",
          "content",
          "caption",
          "sender",
          "senderName",
          "timestamp",
          "isEdited",
        ])
          if (m[key] !== undefined) message[key] = m[key];
        // No attendance parser or pattern gate: retain every returned group message.
        await c.execute(
          "INSERT INTO whatsapp_group_messages (id,sessionId,groupId,timestamp,message) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp),message=VALUES(message)",
          [
            hash([cfg.sessionId, cfg.groupId, m.id]),
            cfg.sessionId,
            cfg.groupId,
            Number(m.timestamp),
            JSON.stringify(message),
          ],
        );
      }
      await c.execute(
        "UPDATE whatsapp_group_scans SET pageCursor=?,state=?,scanned=? WHERE id=?",
        [
          data.historyPending ? job.pageCursor : data.cursor || null,
          data.historyPending
            ? "waiting"
            : data.hasMore
              ? "scanning"
              : "complete",
          job.scanned +
            (data.historyPending
              ? 0
              : Number(data.scannedCount ?? data.messages.length)),
          id,
        ],
      );
    });
  }
  async function clear({ date, sessionId, groupId }) {
    const cfg = await config();
    if (cfg.sessionId !== sessionId || cfg.groupId !== groupId)
      throw fail("Group changed. Refresh and try again.");
    await transaction(async (c) => {
      await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      await current(c, cfg);
      const args = [sessionId, groupId];
      let filter = "sessionId=? AND groupId=? AND clearedAt IS NULL";
      if (date) {
        filter += " AND timestamp>=? AND timestamp<?";
        args.push(...dayBounds(date, cfg.timeZone || "UTC"));
      }
      await c.execute(
        "UPDATE whatsapp_group_messages SET clearedAt=NOW() WHERE " + filter,
        args,
      );
      await c.execute(
        "UPDATE whatsapp_group_scans SET version=version+1,state='cleared' WHERE id=?",
        [hash([sessionId, groupId])],
      );
    });
    return { ok: true };
  }
  async function saved(messageId, cfg) {
    const [row] = await query(
      "SELECT message FROM whatsapp_group_messages WHERE id=?",
      [hash([cfg.sessionId, cfg.groupId, messageId])],
    );
    return row ? parse(row.message) : null;
  }
  return { list, scan, clear, saved };
}
