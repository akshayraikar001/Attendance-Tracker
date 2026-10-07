import { spawn } from "node:child_process";
import { open, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
let child;
let starting;
async function settings() {
  let local = {};
  if (process.env.CHATERY_MANAGED_PATH)
    local = dotenv.parse(
      await readFile(path.join(process.env.CHATERY_MANAGED_PATH, ".env")),
    );
  return {
    base: process.env.CHATERY_URL || "http://127.0.0.1:3010",
    key: process.env.CHATERY_API_KEY || local.API_KEY || "",
  };
}
export async function chateryRequest(
  route,
  body,
  { missingOK = false, method } = {},
) {
  const { base, key } = await settings();
  let res;
  try {
    res = await fetch(new URL("/api/whatsapp" + route, base), {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(
      new Error(
        "Chatery is offline or did not respond. Check the WhatsApp connection.",
      ),
      { status: 503 },
    );
  }
  const data = await res.json();
  if (missingOK && res.status === 404) return null;
  if (!res.ok || !data.success)
    throw Object.assign(new Error(data.message || "Chatery request failed"), {
      status: 502,
    });
  return data.data;
}
export async function ensureChatery() {
  if (starting) return starting;
  starting = (async () => {
    try {
      await chateryRequest("/sessions");
      return;
    } catch (error) {
      if (!process.env.CHATERY_MANAGED_PATH) throw error;
    }
    if (child && child.exitCode === null)
      throw Object.assign(
        new Error("Chatery is starting. Try again shortly."),
        { status: 503 },
      );
    const { base } = await settings();
    const url = new URL(base);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Managed Chatery must use a localhost URL");
    const folder = fileURLToPath(new URL("../../../.local", import.meta.url));
    await mkdir(folder, { recursive: true });
    const log = await open(path.join(folder, "chatery.log"), "a", 0o600);
    try {
      child = spawn(process.execPath, ["index.js"], {
        cwd: process.env.CHATERY_MANAGED_PATH,
        env: { ...process.env, PORT: url.port || "3010" },
        stdio: ["ignore", log.fd, log.fd],
        detached: true,
      });
      child.on("error", () => {});
      child.unref();
    } finally {
      await log.close();
    }
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await chateryRequest("/sessions");
        return;
      } catch {}
    }
    throw Object.assign(
      new Error("Chatery could not start. Check its local service log."),
      { status: 503 },
    );
  })().finally(() => {
    starting = null;
  });
  return starting;
}
