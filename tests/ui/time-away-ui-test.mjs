import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<html><body></body></html>", {
  url: "http://localhost",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "MutationObserver",
  "FormData",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { render, screen, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
const date = new Date().toLocaleDateString("en-CA");
const calls = [];
let rows = [
  {
    id: 1,
    employeeId: 1,
    name: "Alex",
    date,
    departedAt: date + " 12:00:00",
    returnedAt: null,
    reason: "Appointment",
  },
];
globalThis.fetch = async (url, options = {}) => {
  calls.push(url);
  assert.ok(url.startsWith("/api/time-away"), url);
  if (options.method === "PUT") {
    const body = JSON.parse(options.body);
    assert.equal(body.date, date);
    rows = [
      {
        ...rows[0],
        ...body,
        employeeId: 1,
        returnedAt: body.returnedAt.replace("T", " ") + ":00",
      },
    ];
    return { ok: true, json: async () => ({ id: 1 }) };
  }
  const day = new URL(url, "http://localhost").searchParams.get("date");
  assert.ok(day);
  return { ok: true, json: async () => (day === date ? rows : []) };
};
const file = ".local/time-away-ui-test.mjs";
try {
  await build({
    entryPoints: ["client/src/pages/attendance/TimeAway.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: TimeAway } = await import("../../" + file);
  render(
    React.createElement(TimeAway, { employees: [{ id: 1, name: "Alex" }] }),
  );
  await screen.findByText("Appointment");
  assert.equal(screen.getByLabelText("Day").value, date);
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await screen.findByText("No time away recorded for this day.");
  fireEvent.click(screen.getByRole("button", { name: "Today", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Record return" }));
  fireEvent.change(screen.getByLabelText("Return (leave blank while away)"), {
    target: { value: date + "T13:15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save interval" }));
  await screen.findByText("Time away saved. Attendance hours are unchanged.");
  await waitFor(() => assert.ok(screen.getAllByText("1h 15m").length >= 2));
  fireEvent.click(screen.getByRole("button", { name: "Record time away" }));
  assert.equal(screen.getByLabelText("Departure").value.slice(0, 10), date);
  assert.ok(calls.every((url) => !url.includes("/attendance")));
  console.log(
    "PASS: daily filtering, navigation, record return, daily totals, selected-day defaults, and no attendance writes.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
