import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildEmployeeReport } from "../services/employee-report.js";
import { chateryRequest } from "../integrations/chatery.js";
import { normalizePhone } from "../../../shared/phone.js";
const selection = z.object({
  month: z
    .string()
    .regex(
      /^(?:[2-9]\d{3})-(?:0[1-9]|1[0-2])$/,
      "Choose a valid report month.",
    ),
  format: z.enum(["pdf", "xlsx"]),
  detail: z.enum(["detailed", "simple"]),
});
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
export function registerEmployeeReports({
  app,
  wrap,
  query,
  transaction,
  audit,
  send = chateryRequest,
  build = buildEmployeeReport,
}) {
  app.use("/api/employee-reports", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get(
    "/api/employee-reports",
    wrap(async (req, res) => {
      const input = selection.parse(req.query);
      const employees = await query(
        "SELECT id,name,phone,status FROM employees ORDER BY name",
      );
      const deliveries = await query(
        "SELECT employeeId,state,sentAt,filename,error,phone,TIMESTAMPDIFF(SECOND,updatedAt,UTC_TIMESTAMP()) AS age FROM employee_report_sends WHERE month=? AND format=? AND detail=?",
        [input.month, input.format, input.detail],
      );
      res.json(
        employees.map((employee) => {
          const row = deliveries.find((d) => d.employeeId === employee.id);
          return {
            ...employee,
            delivery: row
              ? {
                  ...row,
                  state:
                    row.state === "sending" && row.age >= 120
                      ? "unknown"
                      : row.state,
                }
              : null,
          };
        }),
      );
    }),
  );
  async function report(input) {
    const [employee] = await query(
      "SELECT id,name,phone FROM employees WHERE id=?",
      [input.employeeId],
    );
    if (!employee) throw fail("Employee not found.", 404);
    const [setting] = await query("SELECT rules FROM settings WHERE id=1");
    const records = await query(
      "SELECT * FROM attendance WHERE employeeId=? AND date>=? AND date<LAST_DAY(?)+INTERVAL 1 DAY ORDER BY date",
      [employee.id, input.month + "-01", input.month + "-01"],
    );
    const holidays = await query(
      "SELECT date,name FROM holidays WHERE active=1 AND date>=? AND date<=LAST_DAY(?)",
      [input.month + "-01", input.month + "-01"],
    );
    return {
      employee,
      file: await build({
        ...input,
        employee,
        records,
        holidays,
        rules: parse(setting.rules),
      }),
    };
  }
  app.get(
    "/api/employee-reports/:id/download",
    wrap(async (req, res) => {
      const input = {
        ...selection.parse(req.query),
        employeeId: z.coerce.number().int().positive().parse(req.params.id),
      };
      const { file } = await report(input);
      res
        .set({
          "Content-Type": file.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        })
        .send(file.bytes);
    }),
  );
  app.post(
    "/api/employee-reports/send",
    wrap(async (req, res) => {
      const input = selection
        .extend({
          employeeId: z.number().int().positive(),
          resend: z.boolean().default(false),
        })
        .parse(req.body);
      const { employee, file } = await report(input);
      let phone;
      try {
        phone = normalizePhone(employee.phone);
      } catch {
        throw fail(
          "Save this employee’s phone number with country code first.",
        );
      }
      if (!phone)
        throw fail("Add this employee’s phone number before sending.");
      const [row] = await query(
        "SELECT config FROM whatsapp_config WHERE id=1",
      );
      const cfg = parse(row.config);
      const connection = await send(
        `/sessions/${encodeURIComponent(cfg.sessionId)}/status`,
        null,
        { missingOK: true },
      );
      if (!connection?.isConnected)
        throw fail("Connect your WhatsApp device before sending reports.", 409);
      const payload = {
        sessionId: cfg.sessionId,
        chatId: phone.slice(1) + "@s.whatsapp.net",
        documentUrl: `data:${file.mime};base64,${file.bytes.toString("base64")}`,
        filename: file.filename,
        mimetype: file.mime,
        caption: `Hi ${employee.name.trim().split(/\s+/)[0]}, Kindly Review your ${new Date(input.month + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} Attendence`,
      };
      // Chatery's default JSON body limit is 100 KB. Never send a public report URL.
      if (Buffer.byteLength(JSON.stringify(payload)) > 95 * 1024)
        throw fail(
          "This report is too large for the connector. Choose Excel or simple attendance.",
          413,
        );
      const attemptId = randomUUID();
      const key = [employee.id, input.month, input.format, input.detail];
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [currentEmployees] = await c.execute(
          "SELECT phone FROM employees WHERE id=? FOR UPDATE",
          [employee.id],
        );
        if (currentEmployees[0]?.phone !== employee.phone)
          throw fail(
            "The employee phone changed. Refresh before sending.",
            409,
          );
        const [current] = await c.execute(
          "SELECT state,TIMESTAMPDIFF(SECOND,updatedAt,UTC_TIMESTAMP()) AS age FROM employee_report_sends WHERE employeeId=? AND month=? AND format=? AND detail=? FOR UPDATE",
          key,
        );
        if (current[0]?.state === "sending" && current[0].age < 120)
          throw fail(
            "This report is already being sent. Refresh its status shortly.",
            409,
          );
        if (current.length && !input.resend)
          throw fail(
            "A send was already attempted for this report. Review its status and explicitly choose resend.",
            409,
          );
        await c.execute(
          "INSERT INTO employee_report_sends (employeeId,month,format,detail,state,attemptId,phone,filename,updatedAt) VALUES (?,?,?,?,'sending',?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE state='sending',attemptId=VALUES(attemptId),phone=VALUES(phone),filename=VALUES(filename),error=NULL,updatedAt=UTC_TIMESTAMP()",
          [...key, attemptId, phone, file.filename],
        );
        await audit(c, "Employee report sending", "employee", employee.id, {
          actorId: req.user.id,
          month: input.month,
          format: input.format,
          detail: input.detail,
          attemptId,
        });
      });
      try {
        const result = await send("/chats/send-document", payload, {
          timeoutMs: 60000,
        });
        if (!result?.messageId)
          throw fail(
            "The connector did not confirm a message ID. Check WhatsApp before resending.",
            502,
          );
        await transaction(async (c) => {
          await c.execute(
            "UPDATE employee_report_sends SET state='sent',messageId=?,sentAt=UTC_TIMESTAMP(),updatedAt=UTC_TIMESTAMP(),error=NULL WHERE employeeId=? AND month=? AND format=? AND detail=? AND attemptId=?",
            [result.messageId, ...key, attemptId],
          );
          await audit(c, "Employee report sent", "employee", employee.id, {
            actorId: req.user.id,
            month: input.month,
            format: input.format,
            detail: input.detail,
            attemptId,
            messageId: result.messageId,
          });
        });
        res.json({ ok: true, filename: file.filename });
      } catch {
        // A timeout can happen after WhatsApp accepted a document. Never retry automatically.
        await query(
          "UPDATE employee_report_sends SET state='unknown',error=?,updatedAt=UTC_TIMESTAMP() WHERE employeeId=? AND month=? AND format=? AND detail=? AND attemptId=?",
          [
            "Delivery not confirmed. Check WhatsApp before resending.",
            ...key,
            attemptId,
          ],
        );
        throw fail(
          "Delivery not confirmed. Check WhatsApp before explicitly resending; it may already have been sent.",
          502,
        );
      }
    }),
  );
}
