import { parseTime } from "./time.js";
// Display hints only. Never used to decide which messages are fetched or approved.
export function groupMessageTimes(text) {
  const result = { inTime: null, outTime: null };
  const pattern =
    /\b(in|out)(?:\s*time)?\s*[:=–-]?\s*(\d{1,2}(?:[:.]\d{2})?(?:\s*[ap]\.?m\.?)?)(?!\d)/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    let value = match[2]
      .replace(/([ap])\.?m\.?/gi, "$1M")
      .replace(".", ":")
      .trim();
    if (/^\d{1,2}\s*[ap]m$/i.test(value))
      value = value.replace(/^(\d{1,2})/, "$1:00");
    const time = parseTime(value);
    if (time)
      result[match[1].toLowerCase() === "in" ? "inTime" : "outTime"] = time;
  }
  return result;
}
