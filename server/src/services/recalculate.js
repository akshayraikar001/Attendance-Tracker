import { calculate, resolveRules } from "./rules.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
// Caller holds the settings row lock; recalculations commit together.
export async function recalculateAttendance(connection, settings) {
  const [rows] = await connection.execute(
    "SELECT a.*, e.department FROM attendance a JOIN employees e ON e.id=a.employeeId WHERE (a.mode='time' OR a.inTime IS NOT NULL) ORDER BY a.id FOR UPDATE",
  );
  let changed = 0;
  for (const row of rows) {
    // Legacy Out-only records remain editable; do not invent times or change them.
    if (!row.inTime) continue;
    const rules = resolveRules(
      settings,
      {
        id: row.employeeId,
        department: row.department,
      },
      row.date,
    );
    const result = calculate(row, rules);
    const oldRules = parse(row.rules);
    if (
      Object.entries(result).every(([key, value]) => row[key] === value) &&
      Object.entries(rules).every(([key, value]) => oldRules[key] === value)
    )
      continue;
    await connection.execute(
      "UPDATE attendance SET status=?,workedMinutes=?,lateMinutes=?,earlyMinutes=?,overtimeMinutes=?,rules=? WHERE id=?",
      [
        result.status,
        result.workedMinutes,
        result.lateMinutes,
        result.earlyMinutes,
        result.overtimeMinutes,
        JSON.stringify(rules),
        row.id,
      ],
    );
    changed++;
  }
  return changed;
}
