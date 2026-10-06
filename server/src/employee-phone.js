import { normalizePhone } from "../../shared/phone.js";
export async function saveEmployeePhone(connection, employeeId, value) {
  const phone = normalizePhone(value);
  if (phone) {
    const [owners] = await connection.execute(
      "SELECT employeeId FROM whatsapp_links WHERE identity=? AND employeeId<>?",
      ["phone:" + phone.slice(1), employeeId],
    );
    if (owners.length)
      throw Object.assign(
        new Error("This phone number is already linked to another employee."),
        { status: 409 },
      );
  }
  await connection.execute("UPDATE employees SET phone=? WHERE id=?", [
    phone,
    employeeId,
  ]);
  // Replace the previous number and remove older 10-digit aliases together.
  await connection.execute(
    "DELETE FROM whatsapp_links WHERE employeeId=? AND identity LIKE 'phone:%'",
    [employeeId],
  );
  if (phone)
    await connection.execute(
      "INSERT INTO whatsapp_links (identity,employeeId) VALUES (?,?)",
      ["phone:" + phone.slice(1), employeeId],
    );
  return phone;
}
