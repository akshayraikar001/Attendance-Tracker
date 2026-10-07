export function attendanceNotes(notes) {
  return String(notes || "").replace(
    /Approved WhatsApp leave request [a-f0-9]{64}/gi,
    "Leave approved via WhatsApp",
  );
}
