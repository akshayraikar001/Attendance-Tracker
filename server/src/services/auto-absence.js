import { createHash } from "node:crypto";
import { addDays, holidayForDate } from "../../../shared/calendar.js";
import { resolveRules } from "./rules.js";
import { localMessageTime } from "../utils/whatsapp-parser.js";
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;

export function createAutoAbsent({ transaction, audit, now = Date.now }) {
  let running = false;
  return async function run() {
    if (running) return;
    running = true;
    try {
      return await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT rules FROM settings WHERE id=1 FOR UPDATE",
        );
        const settings = parse(rows[0].rules);
        if (!settings.autoAbsentEnabled) return { total: 0 };
        const [configs] = await c.execute(
          "SELECT config FROM whatsapp_config WHERE id=1",
        );
        const zone =
          settings.attendanceTimeZone ||
          parse(configs[0]?.config || {}).timeZone ||
          "Asia/Kolkata";
        const local = localMessageTime(Math.floor(now() / 1000), zone);
        if (!settings.autoAbsentSince) {
          settings.autoAbsentSince = local.date;
          delete settings.autoAbsentThrough;
        }
        let date = settings.autoAbsentThrough
          ? addDays(settings.autoAbsentThrough, 1)
          : settings.autoAbsentSince;
        if (date < settings.autoAbsentSince) date = settings.autoAbsentSince;
        const [employees] = await c.execute(
          "SELECT *,UNIX_TIMESTAMP(createdAt) AS createdTimestamp FROM employees WHERE status='Active' ORDER BY id",
        );
        const [holidays] = await c.execute(
          "SELECT date,name FROM holidays WHERE active=1 AND date>=? AND date<?",
          [date, local.date],
        );
        let total = 0;
        // Bound each transaction; a long offline backlog continues next minute.
        for (
          let scanned = 0;
          date < local.date && scanned < 31;
          scanned++, date = addDays(date, 1)
        ) {
          let waitingForShift = false;
          if (!holidayForDate(date, holidays, settings.weeklyOffDays ?? [0])) {
            const [existing] = await c.execute(
              "SELECT employeeId FROM attendance WHERE date=? FOR UPDATE",
              [date],
            );
            const [done] = await c.execute(
              "SELECT employeeId FROM auto_absences WHERE date=?",
              [date],
            );
            const protectedIds = new Set(
              [...existing, ...done].map((row) => row.employeeId),
            );
            for (const employee of employees) {
              if (protectedIds.has(employee.id)) continue;
              const joined = localMessageTime(
                Number(employee.createdTimestamp),
                zone,
              ).date;
              if (joined > date) continue;
              const rules = resolveRules(settings, employee, date);
              if (
                rules.shiftEnd <= rules.shiftStart &&
                addDays(date, 1) === local.date &&
                local.time < rules.shiftEnd
              ) {
                waitingForShift = true;
                continue;
              }
              const notes =
                "Automatically marked Absent after day end: no attendance was recorded.";
              await c.execute(
                "INSERT INTO attendance (employeeId,date,mode,status,notes,rules) VALUES (?,?,'manual','Absent',?,?)",
                [employee.id, date, notes, JSON.stringify(rules)],
              );
              const [saved] = await c.execute(
                "SELECT * FROM attendance WHERE employeeId=? AND date=?",
                [employee.id, date],
              );
              const snapshot = createHash("sha256")
                .update(JSON.stringify(saved[0]))
                .digest("hex");
              await c.execute(
                "INSERT INTO auto_absences (employeeId,date,snapshotHash) VALUES (?,?,?)",
                [employee.id, date, snapshot],
              );
              await audit(
                c,
                "Automatic absence recorded",
                "attendance",
                employee.id,
                { date, before: null, after: saved[0], timeZone: zone },
              );
              total++;
            }
          }
          // Do not skip an overnight shift that has not finished yet.
          if (waitingForShift) break;
          settings.autoAbsentThrough = date;
        }
        await c.execute("UPDATE settings SET rules=? WHERE id=1", [
          JSON.stringify(settings),
        ]);
        return { total };
      });
    } finally {
      running = false;
    }
  };
}
