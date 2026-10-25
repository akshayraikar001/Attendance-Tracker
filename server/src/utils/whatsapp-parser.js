import { withoutMentions } from "../../../shared/message-text.js";
import { parseTime } from "../../../shared/time.js";
export function localMessageTime(timestamp, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(timestamp * 1000))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
export function senderIdentity(message) {
  // Only author fields can identify an employee; never use a group address,
  // a quoted author, or a bare numeric LID as a phone number.
  const candidates = [
    message.sender,
    message.key?.participant,
    message.participant,
    message.key?.participantAlt,
    message.participantAlt,
  ];
  for (const value of candidates) {
    const match = String(value || "").match(
      /^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us)$/,
    );
    if (match) return "phone:" + match[1];
  }
  for (const value of candidates) {
    const match = String(value || "").match(/^(\d+)(?::\d+)?@lid$/);
    if (match) return "lid:" + match[1];
  }
  return null;
}
export function parseAttendanceMessage(text, timestamp, timeZone) {
  text = withoutMentions(text);
  if (!/^(?:(?:clock|check)[ -]?)?(?:in|out)(?:\s*time)?\b/i.test(text.trim()))
    return null;
  const match = text
    .trim()
    .match(
      /^(?:(?:clock|check)[ -]?)?(in|out)(?:\s*time)?\s*[:=-]?\s*(.*?)\s*$/i,
    );
  const base = localMessageTime(timestamp, timeZone);
  if (!match) return { reason: "Unrecognized attendance message" };
  // Normalize the complete clock value only; keep unrelated text for review.
  const explicit = match[2]
    .replace(/^(\d{1,2})(\s*(?:am|pm)?)$/i, "$1:00$2")
    .replace(/^(\d{1,2})\s*[.:]\s*(\d{2})(\s*(?:am|pm)?)$/i, "$1:$2$3");
  if (explicit && !/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(explicit))
    return {
      reason: "Use IN / OUT, or a time such as IN 10:50 or OUT 6:55.",
    };
  let time = explicit ? parseTime(explicit) : base.time;
  if (!time) return { reason: "Invalid time; review this message." };
  if (explicit && !/[ap]m$/i.test(explicit)) {
    const [hour, minute] = explicit.split(":").map(Number);
    if (hour >= 1 && hour <= 8)
      time = `${String(hour + 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const hour = Number(time.slice(0, 2));
  if (
    explicit &&
    !/[ap]m$/i.test(explicit) &&
    (hour < 9 || hour > 20 || (hour === 20 && time.slice(3) !== "00"))
  )
    return { reason: "Time must be between 09:00 AM and 08:00 PM." };
  return { action: match[1].toLowerCase(), date: base.date, time };
}
