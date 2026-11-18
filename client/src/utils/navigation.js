const pages = new Set([
  "Overview",
  "Time away",
  "Location tracking",
  "Attendance",
  "Calendar",
  "Employees",
  "Reports",
  "WhatsApp attendance",
  "Leave Approval",
  "Settings",
  "User management",
  "My account",
]);
export function savedPage(storage, role) {
  try {
    const page = storage.getItem("dayline-page");
    if (!pages.has(page)) return "Overview";
    if (
      role !== "Admin" &&
      [
        "Settings",
        "User management",
        "Leave Approval",
        "Time away",
        "Location tracking",
      ].includes(page)
    )
      return "Overview";
    return page;
  } catch {
    return "Overview";
  }
}
