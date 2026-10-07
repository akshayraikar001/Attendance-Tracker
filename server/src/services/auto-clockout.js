import { calculate, resolveRules } from "./rules.js";
import { localMessageTime } from "../utils/whatsapp-parser.js";
import { createHash } from "node:crypto";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;

export function createAutoClockOut({ transaction, audit, now = Date.now }) {
  let running = false;
  return async function run() {
    if (running) return;
    running = true;
    try {
      return await transaction(async (c) => {
        const [settingsRows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const settings = parse(settingsRows[0].rules);
        const [configRows] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const config = parse(configRows[0]?.config || {});
        const zone =
          settings.attendanceTimeZone || config.timeZone || "Asia/Kolkata";
        const local = localMessageTime(Math.floor(now() / 1000), zone);
        // Activation boundary prevents retroactively changing old attendance on upgrade.
        if (!settings.autoClockOutSince) {
          settings.autoClockOutSince = local.date;
          await c.execute("UPDATE settings SET rules=? WHERE id=1", [
            JSON.stringify(settings),
          ]);
        }
        if (settings.autoClockOutEnabled === false) return { total: 0 };
        const [rows] = await c.execute(
          `SELECT a.*,e.department FROM attendance a
          JOIN employees e ON e.id=a.employeeId
          LEFT JOIN auto_clockouts done ON done.employeeId=a.employeeId AND done.date=a.date
          WHERE done.employeeId IS NULL AND e.status='Active' AND a.mode='time'
          AND a.inTime IS NOT NULL AND a.inTime<'19:05' AND a.outTime IS NULL AND a.overnight=0
          AND a.date>=? AND (a.date<? OR (a.date=? AND ? >= '20:00'))
          ORDER BY a.date,a.employeeId FOR UPDATE`,
          [settings.autoClockOutSince, local.date, local.date, local.time],
        );
        let total = 0;
        for (const row of rows) {
          const rules = resolveRules(
            settings,
            { id: row.employeeId, department: row.department },
            row.date,
          );
          if (rules.shiftEnd <= rules.shiftStart) continue;
          const result = calculate(
            { ...row, outTime: "19:05", overnight: false },
            rules,
          );
          const note =
            "Auto Out time: 7:05 PM — no Out time received by 8:00 PM.";
          const notes = [row.notes, note].filter(Boolean).join("\n");
          await c.execute(
            `UPDATE attendance SET outTime='19:05',status=?,workedMinutes=?,lateMinutes=?,earlyMinutes=?,overtimeMinutes=?,notes=?,rules=? WHERE id=?`,
            [
              result.status,
              result.workedMinutes,
              result.lateMinutes,
              result.earlyMinutes,
              result.overtimeMinutes,
              notes,
              JSON.stringify(rules),
              row.id,
            ],
          );
          await c.execute(
            "INSERT INTO auto_clockouts (employeeId,date) VALUES (?,?)",
            [row.employeeId, row.date],
          );
          // Retain WhatsApp ownership only for a row that WhatsApp still owns.
          const { department, ...before } = row;
          const [owned] = await c.execute(
            "SELECT snapshotHash FROM whatsapp_days WHERE employeeId=? AND date=?",
            [row.employeeId, row.date],
          );
          const hash = (v) =>
            createHash("sha256").update(JSON.stringify(v)).digest("hex");
          if (owned[0]?.snapshotHash === hash(before)) {
            const [updated] = await c.execute(
              "SELECT * FROM attendance WHERE id=?",
              [row.id],
            );
            await c.execute(
              "UPDATE whatsapp_days SET snapshotHash=? WHERE employeeId=? AND date=?",
              [hash(updated[0]), row.employeeId, row.date],
            );
          }
          await audit(
            c,
            "Automatic Out time recorded",
            "attendance",
            row.employeeId,
            {
              date: row.date,
              before,
              after: { ...before, ...result, outTime: "19:05", notes },
              timeZone: zone,
            },
          );
          total++;
        }
        return { total };
      });
    } finally {
      running = false;
    }
  };
}
