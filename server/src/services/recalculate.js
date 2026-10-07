import { calculate, resolveRules } from "./rules.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
// Caller holds the settings row lock. Updates and their audit trail commit together.
export async function recalculateAttendance(connection, settings) {
  const [rows] = await connection.execute(
    "SELECT a.*, e.department FROM attendance a JOIN employees e ON e.id=a.employeeId WHERE a.mode='time' ORDER BY a.id FOR UPDATE",
  );
  let changed = 0;
  for (const row of rows) {
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
    await connection.execute(
      "INSERT INTO audit (action,entity,entityId,details) VALUES (?,?,?,?)",
      [
        "Attendance recalculated",
        "attendance",
        row.employeeId,
        JSON.stringify({
          date: row.date,
          before: row,
          after: { ...row, ...result, rules },
        }),
      ],
    );
    changed++;
  }
  return changed;
}
