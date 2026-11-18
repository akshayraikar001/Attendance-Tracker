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
const file = ".local/report-send-ui-test.mjs";
const sent = [],
  statuses = new Map();
let confirmed = false;
window.confirm = () => confirmed;
const people = [
  { id: 1, name: "Akshay Rao", phone: "+919000000001", status: "Active" },
  { id: 2, name: "Other Employee", phone: "+919000000002", status: "Active" },
  { id: 3, name: "No Phone", phone: null, status: "Active" },
];
globalThis.fetch = async (url, options = {}) => {
  let data;
  if (options.method === "POST") {
    const body = JSON.parse(options.body);
    assert.equal(url, "/api/employee-reports/send");
    sent.push(body);
    statuses.set(
      `${body.month}/${body.format}/${body.detail}/${body.employeeId}`,
      { state: "sent", sentAt: "2026-10-31 10:00:00" },
    );
    data = { ok: true };
  } else {
    const p = new URL(url, "http://localhost").searchParams;
    data = people.map((r) => ({
      ...r,
      delivery:
        statuses.get(
          `${p.get("month")}/${p.get("format")}/${p.get("detail")}/${r.id}`,
        ) || null,
    }));
  }
  return { ok: true, status: 200, json: async () => data };
};
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/pages/reports/SendEmployeeReport.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
  });
  const { default: Component } = await import("../../" + file);
  render(React.createElement(Component));
  await screen.findByRole("checkbox", { name: "Select Akshay Rao" });
  assert.equal(
    screen.getByRole("checkbox", { name: "Select No Phone" }).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText("File format"), {
    target: { value: "xlsx" },
  });
  await screen.findByRole("checkbox", { name: "Select Akshay Rao" });
  fireEvent.change(screen.getByLabelText("Report contents"), {
    target: { value: "simple" },
  });
  await screen.findByRole("checkbox", { name: "Select Akshay Rao" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Akshay Rao" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Send selected reports" }),
  );
  assert.equal(sent.length, 0);
  confirmed = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Send selected reports" }),
  );
  await waitFor(() => assert.equal(sent.length, 1));
  await screen.findByText("✓ Sent");
  assert.equal(sent[0].employeeId, 1);
  assert.equal(sent[0].format, "xlsx");
  assert.equal(sent[0].detail, "simple");
  assert.equal(sent[0].resend, true);
  assert.equal(
    screen.getByRole("checkbox", { name: "Select Akshay Rao" }).disabled,
    false,
  );
  assert.equal(
    screen.getByRole("checkbox", { name: "Select Other Employee" }).disabled,
    false,
  );
  fireEvent.click(
    screen.getByLabelText("Allow resending previously attempted reports"),
  );
  assert.equal(
    screen.getByRole("checkbox", { name: "Select Akshay Rao" }).disabled,
    true,
  );
  fireEvent.click(
    screen.getByLabelText("Allow resending previously attempted reports"),
  );
  assert.equal(
    screen.getByRole("checkbox", { name: "Select Akshay Rao" }).disabled,
    false,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Akshay Rao" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Send selected reports" }),
  );
  await waitFor(() => assert.equal(sent.length, 2));
  assert.equal(sent[1].resend, true);
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Report month").disabled, false),
  );
  fireEvent.change(screen.getByLabelText("Report month"), {
    target: { value: "2026-09" },
  });
  await waitFor(() => assert.equal(screen.queryByText("✓ Sent"), null));
  assert.equal(
    screen.getByRole("button", { name: "Send selected reports" }).disabled,
    true,
  );
  assert.ok(
    screen
      .getAllByRole("link", { name: "Download XLSX" })[0]
      .getAttribute("href")
      .includes("month=2026-09"),
  );
  console.log(
    "PASS: selection, PDF/Excel and detail controls, confirmation cancellation, selected-only sending, persisted status display, explicit resend, month reset and download links.",
  );
} finally {
  cleanup();
  await rm(file, { force: true });
  dom.window.close();
}
