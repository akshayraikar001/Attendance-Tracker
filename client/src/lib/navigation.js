const pages = new Set([
  "Overview",
  "Attendance",
  "Calendar",
  "Employees",
  "Reports",
  "WhatsApp attendance",
  "Settings",
  "User management",
  "My account",
]);
export function savedPage(storage, role) {
  try {
    const page = storage.getItem("dayline-page");
    if (!pages.has(page)) return "Overview";
    if (role !== "Admin" && ["Settings", "User management"].includes(page))
      return "Overview";
    return page;
  } catch {
    return "Overview";
  }
}
