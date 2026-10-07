import { createHash } from "node:crypto";
import { parseLeaveMessage } from "../utils/leave-parser.js";
import { senderIdentity } from "../utils/whatsapp-parser.js";
// Called inside the existing fetch transaction; collecting never writes attendance.
export async function collectLeaveRequest(c, message, cfg) {
  if (!cfg.leaveEnabled) return;
  const parsed = parseLeaveMessage(
    message.content,
    Number(message.timestamp),
    cfg.timeZone,
  );
  if (!parsed) return;
  const identity = senderIdentity(message) || "unresolved";
  const [matches] = await c.execute(
    identity.startsWith("phone:")
      ? "SELECT DISTINCT e.id FROM employees e LEFT JOIN whatsapp_links l ON l.employeeId=e.id WHERE e.status='Active' AND (e.phone=? OR l.identity=?)"
      : "SELECT e.id FROM employees e JOIN whatsapp_links l ON l.employeeId=e.id WHERE e.status='Active' AND l.identity=?",
    identity.startsWith("phone:")
      ? ["+" + identity.slice(6), identity]
      : [identity],
  );
  const id = createHash("sha256")
    .update(JSON.stringify([cfg.sessionId, message.chatId, message.id]))
    .digest("hex");
  await c.execute(
    `INSERT IGNORE INTO leave_requests (id,sessionId,groupId,messageId,senderId,senderName,text,timestamp,employeeId,kind,fromDate,toDate,reason,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
    [
      id,
      cfg.sessionId,
      message.chatId,
      String(message.id).slice(0, 160),
      identity,
      String(message.senderName || "").slice(0, 200),
      message.content,
      Number(message.timestamp),
      matches.length === 1 ? matches[0].id : null,
      parsed.kind,
      parsed.from,
      parsed.to,
      parsed.reason,
    ],
  );
}
