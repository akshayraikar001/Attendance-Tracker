import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { entrySchema, calculate } from "../server/src/rules.js";

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
const { render, screen, fireEvent, waitFor, within, cleanup } =
  await import("@testing-library/react");
const React = await import("react");
const errors = [];
window.addEventListener("error", (event) => errors.push(event.error));
const today = new Date().toLocaleDateString("en-CA");
const otherDate = today === "2026-10-06" ? "2026-10-07" : "2026-10-06";
const settings = {
  fullDayHours: 8,
  halfDayHours: 4,
  shiftStart: "09:00",
  shiftEnd: "18:00",
  graceMinutes: 15,
  overtimeAfterHours: 8,
  breakMinutes: 0,
  timeFormat: "12h",
};
let employees;
let entries;
let writes;
let failNextSave;
const catalog = {
  departments: [
    { id: 1, name: "Sales" },
    { id: 2, name: "Development" },
  ],
  roles: [{ id: 3, name: "Staff" }],
};
globalThis.fetch = async (url, options = {}) => {
  const method = options.method || "GET";
  let result;
  if (url === "/api/employees" && method === "GET") result = employees;
  else if (url === "/api/employees" && method === "POST") {
    const employee = { ...JSON.parse(options.body), id: 4 };
    employees.push(employee);
    result = { id: employee.id };
  } else if (url.startsWith("/api/employees/") && method === "PUT") {
    const id = Number(url.split("/").pop());
    employees = employees.map((employee) =>
      employee.id === id ? { ...JSON.parse(options.body), id } : employee,
    );
    result = { ok: true };
  } else if (url === "/api/attendance" && method === "GET") {
    result = entries.map((entry) => ({
      ...employees.find((e) => e.id === entry.employeeId),
      ...entry,
    }));
  } else if (url === "/api/attendance" && method === "POST") {
    if (failNextSave) {
      failNextSave = false;
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "Test save failed; retry." }),
      };
    }
    const entry = entrySchema.parse(JSON.parse(options.body));
    const record = { ...entry, ...calculate(entry, settings) };
    entries = entries.filter(
      (r) => r.employeeId !== entry.employeeId || r.date !== entry.date,
    );
    entries.push(record);
    writes++;
    result = { ok: true };
  } else if (url.startsWith("/api/attendance/") && method === "DELETE") {
    const [, , , employeeId, date] = url.split("/");
    entries = entries.filter(
      (r) => r.employeeId !== Number(employeeId) || r.date !== date,
    );
    result = { ok: true };
  } else if (url === "/api/settings") result = settings;
  else if (url === "/api/catalog") result = catalog;
  else if (["/api/holidays", "/api/audit"].includes(url)) result = [];
  else throw new Error(`Unexpected request: ${method} ${url}`);
  return { ok: true, status: 200, json: async () => structuredClone(result) };
};
const file = ".local/attendance-editor-test.mjs";
await mkdir(".local", { recursive: true });
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
  const { default: App } = await import("../" + file);
  for (const format of ["12h", "24h"]) {
    settings.timeFormat = format;
    employees = [
      "Unmarked employee",
      "WhatsApp employee",
      "Manual status employee",
    ].map((name, i) => ({
      id: i + 1,
      name,
      email: null,
      department: "Sales",
      role: "Staff",
      status: "Active",
    }));
    entries = [
      {
        employeeId: 2,
        date: today,
        mode: "time",
        inTime: "10:31",
        outTime: null,
        status: "In progress",
        notes: "Imported from WhatsApp",
      },
      {
        employeeId: 3,
        date: today,
        mode: "manual",
        inTime: null,
        outTime: null,
        status: "Absent",
        notes: "Manual entry",
      },
    ];
    writes = 0;
    failNextSave = false;
    localStorage.setItem("dayline-page", "Attendance");
    render(React.createElement(App));
    const edit = await screen.findByRole("button", {
      name: "Edit attendance for Unmarked employee",
    });
    // This exact click previously crashed App with ReferenceError: k is not defined.
    fireEvent.click(edit);
    let dialog = screen.getByRole("dialog");
    const field = (name) =>
      within(dialog).getByLabelText(name, { exact: true });
    const change = (name, value) =>
      fireEvent.change(field(name), { target: { value } });
    const display = (h, m = "00") =>
      format === "24h"
        ? `${String(h).padStart(2, "0")}:${m}`
        : `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
    const close = () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Close dialog" }),
      );
    const save = async () => {
      const count = writes;
      assert.equal(dialog.querySelector("form").checkValidity(), true);
      fireEvent.submit(dialog.querySelector("form"));
      await waitFor(() => assert.equal(writes, count + 1));
      await waitFor(() =>
        assert.equal(
          within(dialog).getByRole("button", { name: "Save attendance" })
            .disabled,
          false,
        ),
      );
      assert.ok(screen.getByRole("dialog"));
    };
    assert.equal(field("In time").value, display(9));
    assert.equal(field("Out time").value, "");
    change("In time", display(10));
    await save();
    close();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit attendance for Unmarked employee",
      }),
    );
    dialog = screen.getByRole("dialog");
    assert.equal(field("In time").value, display(10));
    change("Out time", display(18));
    await save();
    assert.equal(entries.find((e) => e.employeeId === 1).workedMinutes, 480);

    change("Employee", "2");
    assert.equal(field("In time").value, display(10, "31"));
    assert.equal(field("Out time").value, "");
    assert.equal(field("Notes optional").value, "Imported from WhatsApp");
    if (format === "12h") {
      fireEvent.click(
        within(dialog).getAllByRole("button", { name: "Choose time" })[1],
      );
      change("Hour", "7");
      change("AM or PM", "PM");
      fireEvent.click(within(dialog).getByRole("button", { name: "Set time" }));
    } else change("Out time", "19:00");
    await save();
    assert.equal(entries.find((e) => e.employeeId === 2).outTime, "19:00");

    change("Employee", "3");
    assert.equal(field("Attendance status").value, "Absent");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "In / out time" }),
    );
    assert.equal(field("Out time").value, "");
    change("Out time", display(17));
    await save();
    assert.equal(entries.find((e) => e.employeeId === 3).mode, "time");

    change("Date", otherDate);
    assert.equal(field("In time").value, display(9));
    assert.equal(field("Out time").value, "");
    change("In time", display(11));
    failNextSave = true;
    const count = writes;
    fireEvent.submit(dialog.querySelector("form"));
    await screen.findByText("Test save failed; retry.");
    assert.equal(writes, count);
    assert.equal(field("In time").value, display(11));
    await save();
    close();

    // Add and cancel/reopen must keep working after several edits and a failed save.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(
        screen.getByRole("button", { name: "Record attendance" }),
      );
      dialog = screen.getByRole("dialog");
      change("Employee", "3");
      change("Date", otherDate);
      assert.equal(field("In time").value, display(11));
      close();
      assert.equal(screen.queryByRole("dialog"), null);
      assert.equal(document.querySelector(".modal-backdrop"), null);
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit attendance for Unmarked employee",
      }),
    );
    dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear both times" }),
    );
    await waitFor(() => assert.equal(field("In time").value, ""));
    assert.equal(field("Out time").value, "");
    change("In time", display(9, "30"));
    await save();
    close();

    // The department selector belongs to the employee form, not the overnight checkbox.
    fireEvent.click(screen.getByRole("button", { name: /^Employees/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add employee" }));
    dialog = screen.getByRole("dialog");
    assert.equal(field("Department").tagName, "SELECT");
    assert.deepEqual(
      [...field("Department").options].map((o) => o.value),
      ["", "Sales", "Development"],
    );
    change("Full name", "New employee");
    change("Department", "Development");
    change("Job title", "Staff");
    fireEvent.submit(dialog.querySelector("form"));
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
    assert.equal(
      employees.find((e) => e.name === "New employee").department,
      "Development",
    );
    const employeeCard = screen
      .getByText("New employee")
      .closest(".employee-card");
    fireEvent.click(
      within(employeeCard).getByRole("button", { name: /Edit employee/ }),
    );
    dialog = screen.getByRole("dialog");
    assert.equal(field("Department").value, "Development");
    change("Department", "Sales");
    fireEvent.submit(dialog.querySelector("form"));
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
    assert.equal(
      employees.find((e) => e.name === "New employee").department,
      "Sales",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS (${format}): three-dot edit, empty/WhatsApp/manual records, add/save/reopen, time picker, date/employee switching, failed-save retry, clear/save and employee add/edit with Department dropdown.`,
    );
    cleanup();
  }
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
