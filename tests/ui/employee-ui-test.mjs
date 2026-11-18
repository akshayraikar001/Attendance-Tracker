import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
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
const React = await import("react");
const { render, screen, fireEvent, within, cleanup } =
  await import("@testing-library/react");
const date = new Date().toLocaleDateString("en-CA");
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  url = url.split("?")[0];
  const data = {
    "/api/me/profile": {
      employee: { id: 1, name: "Own Employee", status: "Active" },
      holidays: [],
      weeklyOffDays: [0],
    },
    "/api/me/attendance": [
      {
        id: 1,
        employeeId: 1,
        date,
        status: "Present",
        notes: "My personal note",
        workedMinutes: 480,
      },
    ],
    "/api/me/time-away": [
      {
        id: 1,
        date,
        departedAt: date + " 12:00:00",
        returnedAt: null,
        reason: "Appointment",
      },
    ],
  };
  assert.ok(url in data, "Unexpected endpoint: " + url);
  return { ok: true, json: async () => data[url] };
};
const file = ".local/employee-ui-test.mjs";
try {
  await build({
    entryPoints: ["client/src/App.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: App } = await import("../../" + file);
  render(
    React.createElement(App, {
      user: { name: "Employee", role: "Employee" },
      onLogout: () => {},
    }),
  );
  await screen.findByText("My personal note");
  assert.equal(screen.queryByText("User management"), null);
  const nav = within(
    screen.getByRole("navigation", { name: "Employee navigation" }),
  );
  assert.equal(
    nav
      .getByRole("button", { name: "Dashboard", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.ok(screen.getByRole("heading", { name: "Hello, Employee" }));
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  assert.equal(
    screen
      .getByRole("button", { name: "Close menu" })
      .closest("aside")
      .classList.contains("is-open"),
    true,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(
    screen
      .getByRole("button", { name: "Open navigation" })
      .getAttribute("aria-expanded"),
    "false",
  );
  fireEvent.click(nav.getByRole("button", { name: "Calendar", exact: true }));
  assert.equal(screen.queryByRole("button", { name: /Edit attendance/ }), null);
  assert.equal(
    screen.queryByRole("button", { name: "Record", exact: true }),
    null,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Time away", exact: true }),
  );
  await screen.findByText("Awaiting return");
  assert.equal(screen.queryByRole("button", { name: "Record return" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Reports", exact: true }));
  await screen.findByRole("button", { name: "Export my report" });
  fireEvent.change(screen.getByLabelText("Report month"), {
    target: { value: "2000-01" },
  });
  assert.ok(screen.getByText("No attendance to show"));
  assert.equal(
    screen.getByRole("button", { name: "Export my report" }).disabled,
    true,
  );
  fireEvent.click(
    nav.getByRole("button", { name: "My attendance", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Report month"), {
    target: { value: date.slice(0, 7) },
  });
  assert.ok(screen.getByText("My personal note"));
  fireEvent.change(screen.getByLabelText("Attendance status"), {
    target: { value: "Present" },
  });
  assert.ok(screen.getByText("My personal note"));
  assert.ok(calls.every((url) => url.startsWith("/api/me/")));
  console.log(
    "PASS: Employee dashboard, notes, read-only calendar, own reports, time away, and scoped endpoints.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
