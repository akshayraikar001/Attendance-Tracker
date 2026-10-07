import { pool } from "../config/db.js";
export async function audit(conn, action, entity, entityId, details) {
  await conn.execute(
    "INSERT INTO audit (action,entity,entityId,details) VALUES (?,?,?,?)",
    [action, entity, entityId, JSON.stringify(details)],
  );
}
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
