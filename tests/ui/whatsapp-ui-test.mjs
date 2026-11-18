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
const { render, screen, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const React = await import("react");
const calls = [];
let groupCleared = false;
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
  if (path === "/whatsapp/group-messages/scan")
    return api(
      "/whatsapp/group-messages?" +
        new URLSearchParams(body.date ? { date: body.date } : {}),
    );
  if (path === "/whatsapp/group-messages" && method === "DELETE") {
    groupCleared = true;
    return { ok: true };
  }
  if (path.startsWith("/whatsapp/group-messages?")) {
    const params = new URL(path, "http://localhost").searchParams;
    const date = params.get("date") || "2026-11-07";
    const offset = Number(params.get("offset") || 0);
    if (groupCleared && params.get("history") !== "archived")
      return {
        days: [],
        messages: [],
        hasMore: false,
        source: { sessionId: "test", groupId: "123@g.us" },
        scan: { state: "cleared", scanned: 101 },
      };
    return {
      days: [
        { date: "2026-11-07", count: 101 },
        { date: "2026-11-06", count: 1 },
      ],
      source: { sessionId: "test", groupId: "123@g.us" },
      scan: { state: "complete", scanned: 101 },
      messages:
        date === "2026-11-06"
          ? [
              {
                id: "older",
                content: "Yesterday group note",
                type: "text",
                timestamp: 1793923200,
              },
            ]
          : Array.from({ length: offset ? 1 : 100 }, (_, i) => ({
              id: "group-" + (offset + i),
              content: "Group note " + (offset + i),
              type: "text",
              timestamp: 1794009600,
            })),
      hasMore: date === "2026-11-07" && offset === 0,
    };
  }
  if (path === "/whatsapp/group-messages/select")
    return {
      id: "selected-event",
      text: "Yesterday group note",
      state: "review",
      employeeId: 1,
      timestamp: 1793923200,
    };
  if (path === "/whatsapp") return structuredClone(state);
  if (path === "/whatsapp?history=archived")
    return {
      ...structuredClone(state),
      events: [
        {
          id: "archived",
          senderId: "phone:919000000001",
          text: "Archived IN 10:00",
          state: "applied",
          timestamp: Math.floor(Date.now() / 1000),
        },
      ],
    };
  if (path.startsWith("/whatsapp/messages?")) {
    const params = new URL(path, "http://localhost").searchParams;
    const rows = state.events.filter(
      (event) =>
        new Date(Number(event.timestamp) * 1000).toISOString().slice(0, 10) ===
        params.get("date"),
    );
    const offset = Number(params.get("offset") || 0);
    return {
      events: rows.slice(offset, offset + 100),
      hasMore: rows.length > offset + 100,
    };
  }
  if (path === "/whatsapp/events" && method === "DELETE") {
    state.events = state.events.filter(
      (event) =>
        !body.dates.includes(
          new Date(Number(event.timestamp) * 1000).toISOString().slice(0, 10),
        ),
    );
    state.days = state.days.filter((day) => !body.dates.includes(day.date));
    return { ok: true };
  }
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
  if (path === "/whatsapp/sync/clear") {
    state.config.syncProgress = null;
    state.config.resumeFromCache = true;
    return { ok: true };
  }
  if (path === "/whatsapp/sync")
    return { lastSync: new Date().toISOString(), error: null };
  if (path === "/whatsapp/links") return { ok: true };
  if (path === "/whatsapp/approve")
    return { state: "applied", reason: "In time recorded." };
  if (path === "/whatsapp/retry") {
    state.events[0] = {
      ...state.events[0],
      senderId: "phone:919000000001",
      senderName: "Test Person",
      reason: "Link this WhatsApp sender to an active employee.",
    };
    return { state: "review", reason: state.events[0].reason };
  }
  throw new Error(path);
};
const file = ".local/whatsapp-ui-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/pages/whatsapp/WhatsAppSettings.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: Settings } = await import("../../" + file);
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
  cleanup();
  state.events = [
    {
      id: "a".repeat(64),
      senderId: "unresolved",
      senderName: "",
      text: "@919876543210 In time 2:07",
      timestamp: Math.floor(Date.now() / 1000),
      state: "review",
      reason: "Link this WhatsApp sender to an active employee.",
    },
  ];
  render(
    React.createElement(Settings, {
      api,
      employees: [{ id: 1, name: "Test Person", status: "Active" }],
    }),
  );
  const fetchSender = await screen.findByRole("button", {
    name: "Fetch sender",
  });
  assert.equal(screen.queryByText(/@919876543210/), null);
  assert.equal(screen.queryByLabelText("Link sender unresolved"), null);
  fireEvent.click(fetchSender);
  await screen.findByLabelText("Link sender Test Person");
  assert.deepEqual(calls.find((c) => c.path === "/whatsapp/retry").body, {
    id: "a".repeat(64),
  });
  assert.equal(screen.queryByRole("button", { name: "Fetch sender" }), null);
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByLabelText("Show cleared history"));
  await screen.findByText("Archived IN 10:00");
  assert.ok(screen.getByRole("heading", { name: "Cleared message history" }));
  fireEvent.click(screen.getByLabelText("Show cleared history"));
  await screen.findByText("In time 2:07");
  assert.equal(screen.queryByText("Archived IN 10:00"), null);

  cleanup();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 86400000)
    .toISOString()
    .slice(0, 10);
  state.config = {
    ...state.config,
    timeZone: "UTC",
    enabled: true,
    syncProgress: null,
  };
  state.connection = { isConnected: true, status: "connected" };
  state.events = Array.from({ length: 101 }, (_, i) => ({
    id: "today-" + i,
    text: "Today message " + i,
    senderId: "phone:919000000001",
    timestamp: Date.parse(today + "T12:00:00Z") / 1000 + i,
    state: "applied",
  }));
  state.events.push({
    id: "yesterday",
    text: "Yesterday message",
    senderId: "phone:919000000001",
    timestamp: Date.parse(yesterday + "T12:00:00Z") / 1000,
    state: "applied",
  });
  state.days = [
    { date: today, count: 101 },
    { date: yesterday, count: 1 },
  ];
  window.confirm = () => true;
  render(React.createElement(Settings, { api, employees: [] }));
  await screen.findByText("Today message 0");
  assert.equal(screen.queryByText("Yesterday message"), null);
  assert.equal(
    screen
      .getByLabelText("Select " + today)
      .closest(".whatsapp-message-day")
      .querySelector("details").open,
    true,
  );
  const older = screen
    .getByLabelText("Select " + yesterday)
    .closest(".whatsapp-message-day")
    .querySelector("details");
  assert.equal(older.open, false);
  fireEvent.click(screen.getByRole("button", { name: "Load more messages" }));
  await screen.findByText("Today message 100");
  fireEvent.click(older.querySelector("summary"));
  await screen.findByText("Yesterday message");
  fireEvent.click(screen.getByLabelText("Select all days"));
  fireEvent.click(screen.getByRole("button", { name: "Sync selected days" }));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Sync selected days" }).disabled,
      false,
    ),
  );
  assert.deepEqual(
    calls.filter((c) => c.path === "/whatsapp/sync").at(-1).body.dates,
    [today, yesterday],
  );
  fireEvent.click(screen.getByLabelText("Select " + today));
  fireEvent.click(screen.getByRole("button", { name: "Clear selected days" }));
  await waitFor(() =>
    assert.equal(screen.queryByLabelText("Select " + yesterday), null),
  );
  assert.equal(state.events.length, 101);
  fireEvent.click(screen.getByRole("button", { name: "Sync all history" }));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Sync all history" }).disabled,
      false,
    ),
  );
  assert.deepEqual(
    calls.filter((c) => c.path === "/whatsapp/sync").at(-1).body,
    { all: true },
  );
  const syncCallsBeforeClear = calls.filter(
    (c) => c.path === "/whatsapp/sync",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "Clear stuck sync" }));
  await waitFor(() => assert.ok(screen.getByText(/Sync cleared/)));
  assert.equal(
    calls.filter((c) => c.path === "/whatsapp/sync/clear").length,
    1,
  );
  assert.equal(
    calls.filter((c) => c.path === "/whatsapp/sync").length,
    syncCallsBeforeClear,
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Sync latest messages" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sync latest messages" }));
  await waitFor(() =>
    assert.equal(
      calls.filter((c) => c.path === "/whatsapp/sync").length,
      syncCallsBeforeClear + 1,
    ),
  );
  console.log(
    "PASS: daily collapse defaults, full history pagination, bulk day sync/clear, and sync all controls.",
  );
  console.log(
    "PASS: QR pairing, group/timezone selection, saved sync controls, manual sync, progress display, sender mapping and unresolved sender recovery.",
  );

  cleanup();
  state.config.allowEditedMessages = false;
  state.config.timeZone = "UTC";
  state.events = [
    {
      id: "edited-review",
      text: "IN wrong",
      isEdited: 1,
      senderId: "phone:919000000001",
      employeeId: 1,
      state: "review",
      timestamp: Math.floor(Date.now() / 1000),
      reason: "Edited messages disabled.",
    },
  ];
  delete state.days;
  render(
    React.createElement(Settings, {
      api,
      employees: [{ id: 1, name: "Test Person", status: "Active" }],
    }),
  );
  await screen.findByText("Edited");
  assert.equal(
    screen.getByRole("button", { name: "Edit entry" }).disabled,
    true,
  );
  assert.equal(
    screen.getByRole("button", { name: "Approve / overwrite" }).disabled,
    true,
  );
  fireEvent.click(screen.getByLabelText("Allow edited messages"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save WhatsApp settings" }),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Edit entry" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  const dialog = screen.getByRole("dialog", { name: "Edit attendance entry" });
  fireEvent.change(within(dialog).getByLabelText("Time"), {
    target: { value: "10:45" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Approve entry" }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const approval = calls
    .filter((c) => c.path === "/whatsapp/approve")
    .at(-1).body;
  assert.equal(approval.overwrite, false);
  assert.equal(approval.correction.time, "10:45");
  assert.equal(approval.correction.expectedText, "IN wrong");
  assert.equal(approval.correction.employeeId, 1);
  console.log(
    "PASS: edited-message opt-in and manual correction dialog approval.",
  );
  cleanup();
  state.config.allowEditedMessages = false;
  state.events = [
    {
      id: "error-review",
      text: "IN wrong",
      senderId: "unresolved",
      state: "review",
      reason: "Invalid time.",
      timestamp: Math.floor(Date.now() / 1000),
    },
  ];
  render(
    React.createElement(Settings, {
      api,
      employees: [{ id: 1, name: "Test Person", status: "Active" }],
    }),
  );
  await screen.findByText("IN wrong");
  const beforeCorrection = calls.filter(
    (c) => c.path === "/whatsapp/approve",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  const errorDialog = screen.getByRole("dialog");
  fireEvent.change(within(errorDialog).getByLabelText("Employee"), {
    target: { value: "1" },
  });
  fireEvent.change(within(errorDialog).getByLabelText("Time"), {
    target: { value: "09:15" },
  });
  assert.equal(
    calls.filter((c) => c.path === "/whatsapp/approve").length,
    beforeCorrection,
  );
  fireEvent.click(
    within(errorDialog).getByRole("button", { name: "Approve entry" }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const fixed = calls.filter((c) => c.path === "/whatsapp/approve").at(-1).body;
  assert.equal(fixed.correction.employeeId, 1);
  assert.equal(fixed.correction.time, "09:15");
  assert.equal(fixed.correction.expectedText, "IN wrong");
  console.log(
    "PASS: unresolved error entry stays visible and supports explicit correction approval.",
  );

  fireEvent.click(screen.getByRole("button", { name: "All group messages" }));
  await screen.findByText("Group note 0");
  fireEvent.click(screen.getByRole("button", { name: "Load more messages" }));
  await screen.findByText("Group note 100");
  fireEvent.change(screen.getByLabelText("Available message days"), {
    target: { value: "2026-11-06" },
  });
  await screen.findByText("Yesterday group note");
  assert.equal(screen.queryByText("Group note 0"), null);
  const syncCount = calls.filter((c) => c.path === "/whatsapp/sync").length;
  fireEvent.click(screen.getByRole("button", { name: "Fetch all messages" }));
  await waitFor(() =>
    assert.ok(calls.some((c) => c.path === "/whatsapp/group-messages/scan")),
  );
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: "Pause scan" }), null),
  );
  assert.equal(
    calls.filter((c) => c.path === "/whatsapp/sync").length,
    syncCount,
  );
  assert.ok(screen.getByRole("columnheader", { name: "In time" }));
  assert.ok(screen.getByRole("columnheader", { name: "Out time" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear day" }));
  await screen.findByText("No messages.");
  const cleared = calls
    .filter(
      (c) => c.path === "/whatsapp/group-messages" && c.method === "DELETE",
    )
    .at(-1).body;
  assert.equal(cleared.date, "2026-11-06");
  fireEvent.click(screen.getByLabelText("Show cleared group messages"));
  await screen.findByText("Yesterday group note");
  const beforeSelection = calls.filter(
    (c) => c.path === "/whatsapp/approve",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "Select for review" }));
  await screen.findByRole("dialog", { name: "Edit attendance entry" });
  assert.equal(
    calls.filter((c) => c.path === "/whatsapp/approve").length,
    beforeSelection,
  );
  assert.deepEqual(
    calls.filter((c) => c.path === "/whatsapp/group-messages/select").at(-1)
      .body,
    {
      messageId: "older",
      sessionId: "test",
      groupId: "123@g.us",
    },
  );
  console.log(
    "PASS: group browser date switching, pagination and selection without automatic approval.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
