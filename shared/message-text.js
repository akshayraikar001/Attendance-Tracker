// Mentions address someone; they never identify the attendance sender.
// Keep the original stored message intact and remove only explicit @tokens.
export function withoutMentions(text) {
  return String(text || "")
    .replace(
      /(^|\s)@(?:\d{6,20}(?::\d+)?@(?:s\.whatsapp\.net|c\.us|lid)|[\p{L}\p{N}_][\p{L}\p{N}_.-]*)[,;:]?/gu,
      "$1",
    )
    .replace(/[ \t]+/g, " ")
    .trim();
}
