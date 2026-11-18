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
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, cleanup } =
  await import("@testing-library/react");
const React = await import("react");
const file = ".local/report-bulk-ui-test.mjs";
try {
  await build({
    stdin: {
      contents: `export {default as Monthly} from './client/src/pages/reports/MonthlyReport.jsx'; export {default as Bulk} from './client/src/pages/attendance/BulkAttendance.jsx';`,
      resolveDir: process.cwd(),
      loader: "jsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { Monthly, Bulk } = await import("../../" + file);
  const employees = [
    { id: 1, name: "One", status: "Active", department: "Sales" },
  ];
  const records = [
    {
      employeeId: 1,
      date: "2026-10-01",
      status: "Present",
      workedMinutes: 480,
    },
    {
      employeeId: 1,
      date: "2026-10-02",
      status: "Half day",
      workedMinutes: 240,
    },
  ];
  for (const show of [false, true])
    for (const print of [false, true]) {
      render(
        React.createElement(Monthly, {
          employees,
          records,
          holidays: [],
          rules: {
            showDailyWorkingAverage: show,
            printDailyWorkingAverage: print,
          },
          onEdit: () => {},
        }),
      );
      fireEvent.change(screen.getByLabelText("Report month"), {
        target: { value: "2026-10" },
      });
      const heading = screen.queryByText("Daily working avg", {
        selector: "th",
      });
      if (!show && !print) assert.equal(heading, null);
      else {
        assert.equal(
          heading.classList.contains("average-screen-hidden"),
          !show,
        );
        assert.equal(
          heading.classList.contains("average-print-hidden"),
          !print,
        );
        const average = document.querySelector("tbody tr").lastElementChild;
        assert.equal(average.textContent, "8h 0m");
        assert.equal(average.className, heading.className);
      }
      assert.ok(screen.getByRole("button", { name: "Export with time" }));
      assert.ok(screen.getByRole("button", { name: "Export P / A / H only" }));
      cleanup();
    }
  for (const reset of [false, true]) {
    render(
      React.createElement(Bulk, {
        employees,
        records,
        date: "2026-10-01",
        reset,
        api: async () => ({}),
        onApplied: () => {},
        onClose: () => {},
      }),
    );
    assert.equal(
      document.querySelector(".bulk-employees .badge").textContent,
      "Present",
    );
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-02" },
    });
    assert.equal(
      document.querySelector(".bulk-employees .badge").textContent,
      "Half day",
    );
    assert.ok(document.querySelector(".bulk-employees .badge.half-day"));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-04" },
    });
    assert.equal(
      document.querySelector(".bulk-employees .badge").textContent,
      "Holiday",
    );
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-05" },
    });
    assert.equal(
      document.querySelector(".bulk-employees .badge").textContent,
      "Unmarked",
    );
    cleanup();
  }
  console.log(
    "PASS: independent report/print average visibility, both export actions, and reactive From-date status badges in bulk/reset.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
