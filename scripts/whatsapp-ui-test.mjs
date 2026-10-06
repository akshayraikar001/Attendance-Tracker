import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "MutationObserver",
  "localStorage",
  "FormData",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const React = await import("react");
const calls = [];
let state = {
  config: {
    enabled: false,
    sessionId: "dayline-attendance",
    groupId: "",
    groupName: "Insight - Attendance",
    timeZone: "",
    since: 0,
  },
  connection: { status: "qr_ready", isConnected: false },
  qrCode: "data:image/png;base64,AA==",
  events: [],
  links: [],
  lastSync: null,
};
const api = async (path, body, method) => {
  calls.push({ path, body, method });
  if (path === "/whatsapp") return structuredClone(state);
  if (path === "/whatsapp/connect") {
    state.connection = { status: "connected", isConnected: true };
    state.qrCode = null;
    return { ok: true };
  }
  if (path === "/whatsapp/groups")
    return [{ id: "123@g.us", subject: "Insight - Attendance" }];
  if (path === "/whatsapp/config") {
    state.config = { ...body };
    return { ok: true };
  }
  if (path === "/whatsapp/sync")
    return { lastSync: new Date().toISOString(), error: null };
  if (path === "/whatsapp/links") return { ok: true };
  throw new Error(path);
};
const file = ".local/whatsapp-ui-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/components/WhatsAppSettings.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: Settings } = await import("../" + file);
  render(
    React.createElement(Settings, {
      api,
      employees: [{ id: 1, name: "Test Person", status: "Active" }],
    }),
  );
  await screen.findByRole("img", { name: "WhatsApp device linking QR code" });
  fireEvent.click(
    screen.getByRole("button", { name: "Link WhatsApp / refresh QR" }),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Load my groups" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Load my groups" }));
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Attendance group").value, "123@g.us"),
  );
  fireEvent.change(screen.getByLabelText("Timezone"), {
    target: { value: "Asia/Kolkata" },
  });
  assert.equal(
    screen.getByRole("spinbutton", { name: "Messages per sync" }).value,
    "200",
  );
  assert.equal(
    screen.getByRole("spinbutton", { name: "Auto-sync interval (minutes)" })
      .value,
    "5",
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Messages per sync" }),
    { target: { value: "400" } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Auto-sync interval (minutes)" }),
    { target: { value: "2" } },
  );
  fireEvent.click(screen.getByLabelText("Enable automatic attendance"));
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Save WhatsApp settings" })
      .closest("form"),
  );
  await waitFor(() => assert.equal(state.config.enabled, true));
  assert.equal(state.config.timeZone, "Asia/Kolkata");
  assert.equal(state.config.groupId, "123@g.us");
  assert.equal(state.config.messagesPerSync, 400);
  assert.equal(state.config.syncIntervalMinutes, 2);
  await screen.findByText(/checked every 2 minute/);
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Sync latest messages" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sync latest messages" }));
  await waitFor(() =>
    assert.ok(calls.some((c) => c.path === "/whatsapp/sync")),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Sync latest messages" }).disabled,
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("WhatsApp number with country code"), {
    target: { value: "+91 9000000001" },
  });
  fireEvent.change(screen.getByLabelText("Employee to link"), {
    target: { value: "1" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Link sender" }).closest("form"),
  );
  await waitFor(() =>
    assert.ok(calls.some((c) => c.path === "/whatsapp/links")),
  );
  assert.deepEqual(calls.find((c) => c.path === "/whatsapp/links").body, {
    identity: "phone:919000000001",
    employeeId: 1,
  });
  cleanup();
  state.config.syncProgress = { phase: "fetch", scanned: 400 };
  render(React.createElement(Settings, { api, employees: [] }));
  await screen.findByText(/Checking history: 400 messages fetched/);
  assert.equal(
    screen.getByRole("spinbutton", { name: "Messages per sync" }).value,
    "400",
  );
  assert.equal(
    screen.getByRole("spinbutton", { name: "Auto-sync interval (minutes)" })
      .value,
    "2",
  );
  console.log(
    "PASS: QR pairing, group/timezone selection, saved sync controls, manual sync, progress display and sender mapping.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
