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
const file = ".local/leave-ui-test.mjs";
const calls = [];
let reloaded = 0,
  opened = 0;
const state = {
  enabled: false,
  groupName: "Insight - Attendance",
  timeZone: "Asia/Kolkata",
  messagesPerSync: 200,
  syncIntervalMinutes: 5,
  total: 1,
  hasMore: false,
  requests: [
    {
      id: "a".repeat(64),
      employeeId: 1,
      employeeName: "Akshay",
      senderId: "phone:919999999999",
      senderName: "Akshay",
      timestamp: 1791280800,
      text: "@Bharat sir leave from 8 to 10 oct",
      kind: "Absent",
      fromDate: "2026-10-08",
      toDate: "2026-10-10",
      reason: "Confirm proposed dates.",
      state: "pending",
    },
  ],
};
const api = async (path, body, method) => {
  calls.push({ path, body, method });
  if (path.startsWith("/leave?")) return structuredClone(state);
  if (path === "/leave/config") {
    state.enabled = body.enabled;
    return { ok: true };
  }
  if (path === "/leave/sync") return {};
  if (path.endsWith("/approve")) {
    if (!body.overwrite)
      throw Error(
        "Existing attendance on 2026-10-08. Review it and explicitly allow replacement to approve.",
      );
    state.requests = [];
    state.total = 0;
    return { ok: true, days: 3 };
  }
  if (path.endsWith("/reject")) {
    state.requests = [];
    state.total = 0;
    return { ok: true };
  }
  throw Error(path);
};
try {
  await mkdir(".local", { recursive: true });
  await build({
    entryPoints: ["client/src/pages/leave/LeaveApproval.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: Component } = await import("../../" + file);
  const props = {
    api,
    employees: [{ id: 1, name: "Akshay", status: "Active" }],
    onReload: async () => {
      reloaded++;
    },
    onOpenWhatsApp: () => {
      opened++;
    },
  };
  render(React.createElement(Component, props));
  await screen.findByRole("checkbox", { name: "Allow Leave Approval" });
  assert.equal(
    screen.getByRole("button", { name: "Review request" }).disabled,
    true,
  );
  assert.equal(calls.filter((c) => c.path.endsWith("/approve")).length, 0);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Allow Leave Approval" }),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Review request" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "WhatsApp settings" }));
  assert.equal(opened, 1);
  fireEvent.click(screen.getByRole("button", { name: "Sync leave requests" }));
  await waitFor(() => assert.ok(calls.some((c) => c.path === "/leave/sync")));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Review request" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.equal(screen.getByLabelText("From date").value, "2026-10-08");
  assert.equal(screen.getByLabelText("To date").value, "2026-10-10");
  assert.equal(
    screen.getByRole("checkbox", {
      name: "Replace existing attendance on these dates",
    }).checked,
    false,
  );
  fireEvent.submit(screen.getByRole("form", { name: "Review leave request" }));
  await screen.findByRole("alert");
  assert.match(screen.getByRole("alert").textContent, /Existing attendance/);
  assert.equal(
    calls.find((c) => c.path.endsWith("/approve")).body.overwrite,
    false,
  );
  assert.equal(reloaded, 0);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Replace existing attendance on these dates",
    }),
  );
  window.confirm = () => false;
  fireEvent.submit(screen.getByRole("form", { name: "Review leave request" }));
  assert.equal(calls.filter((c) => c.path.endsWith("/approve")).length, 1);
  window.confirm = () => true;
  fireEvent.submit(screen.getByRole("form", { name: "Review leave request" }));
  await screen.findByText("Approved 3 day(s). Attendance updated.");
  assert.equal(reloaded, 1);
  assert.equal(
    calls.filter((c) => c.path.endsWith("/approve")).at(-1).body.overwrite,
    true,
  );
  cleanup();
  state.requests = [
    {
      id: "b".repeat(64),
      senderName: "Unmatched employee",
      senderId: "unresolved",
      timestamp: 1791280800,
      text: "halfday next week",
      kind: "Half day",
      state: "pending",
      reason: "Date is unclear.",
    },
  ];
  state.total = 1;
  render(React.createElement(Component, props));
  await screen.findByRole("button", { name: "Review request" });
  fireEvent.click(screen.getByRole("button", { name: "Review request" }));
  assert.equal(screen.getByLabelText("Employee").value, "");
  assert.equal(screen.getByLabelText("From date").value, "");
  fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
  await screen.findByText("Request rejected.");
  assert.equal(reloaded, 1);
  console.log(
    "PASS: opt-in gate, shared settings/sync, manual review, suggested dates, conflict protection, overwrite confirmation/cancellation, attendance refresh, unmatched sender and rejection.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
