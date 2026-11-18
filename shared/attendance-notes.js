export function attendanceNotes(notes) {
  return String(notes || "")
    .replace(
      /Approved WhatsApp leave request [a-f0-9]{64}/gi,
      "Leave approved via WhatsApp",
    )
    .replace(
      /Auto Out time:[^\r\n]*?no\s+Out time received by[^\r\n]*/gi,
      "!! Auto Out time Added",
    )
    .replace(/Imported from WhatsApp/gi, "Auto from WA");
}
