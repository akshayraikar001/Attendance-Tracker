import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="theme-color"></head><body></body></html>',
  { url: "http://localhost" },
);
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
const today = new Date().toLocaleDateString("en-CA");
const employees = [
  {
    id: 1,
    name: "First Person",
    email: null,
    department: "Sales",
    role: "Sales",
    status: "Active",
  },
  {
    id: 2,
    name: "Second Person",
    email: null,
    department: "Development",
    role: "Developer",
    status: "Active",
  },
];
let holidays = [];
let holidayWrites = 0;
let settings = {
  fullDayHours: 8,
  halfDayHours: 4,
  shiftStart: "09:00",
  shiftEnd: "18:00",
  graceMinutes: 15,
  overtimeAfterHours: 8,
  breakMinutes: 60,
};
let entries = [
  {
    id: 2,
    employeeId: 2,
    date: today,
    mode: "time",
    inTime: "10:00",
    outTime: null,
    status: "In progress",
    notes: "Second employee note",
    lateMinutes: 60,
  },
];
let attendanceWrites = 0,
  resetWrites = 0,
  bulkPreviews = 0,
  bulkWrites = 0;
let catalog = {
  departments: [
    { id: 1, name: "Sales", count: 1 },
    { id: 2, name: "Development", count: 1 },
  ],
  roles: [
    { id: 3, name: "Sales", count: 1 },
    { id: 4, name: "Developer", count: 1 },
  ],
};
globalThis.fetch = async (url, options) => {
  let result;
  if (url === "/api/catalog") result = catalog;
  else if (url.startsWith("/api/catalog/")) {
    const [, , , kind, id] = url.split("/");
    const data = JSON.parse(options.body);
    if (options.method === "POST") {
      result = { id: 20, name: data.name, count: 0 };
      catalog[kind].push(result);
    } else if (options.method === "PUT") {
      const item = catalog[kind].find((c) => c.id === Number(id));
      item.name = data.name;
      result = { ok: true };
    } else {
      catalog[kind] = catalog[kind].filter((c) => c.id !== Number(id));
      result = { ok: true };
    }
  } else if (url.startsWith("/api/attendance/bulk-reset")) {
    const payload = JSON.parse(options.body);
    const matches = (r) =>
      payload.employeeIds.includes(r.employeeId) &&
      r.date >= payload.from &&
      r.date <= payload.to;
    const affected = entries.filter(matches);
    result = {
      total: affected.length,
      previewToken: "reset-reviewed",
      sample: affected.map((r) => ({
        name: employees.find((e) => e.id === r.employeeId).name,
        date: r.date,
        replaces: r.status,
      })),
    };
    if (!url.endsWith("/preview")) {
      assert.equal(payload.previewToken, "reset-reviewed");
      entries = entries.filter((r) => !matches(r));
      resetWrites++;
    }
  } else if (url.startsWith("/api/attendance/bulk-absence")) {
    const payload = JSON.parse(options.body);
    if (url.endsWith("/preview")) {
      bulkPreviews++;
      result = {
        create: 2,
        replace: 0,
        skippedHolidays: 0,
        skippedExisting: 0,
        total: 2,
        previewToken: "reviewed",
        sample: [
          { name: "First Person", date: payload.from },
          { name: "Second Person", date: payload.from },
        ],
      };
    } else {
      assert.equal(payload.previewToken, "reviewed");
      bulkWrites++;
      result = {
        total: 2,
        skippedExisting: 0,
        skippedHolidays: 0,
        applied: true,
      };
    }
  } else if (url === "/api/holidays") result = holidays;
  else if (url.startsWith("/api/holidays/")) {
    const date = url.split("/").pop();
    const value = JSON.parse(options.body);
    assert.equal(options.method, "PUT");
    holidays = holidays.filter((h) => h.date !== date);
    if (value.active) holidays.push({ date, name: value.name });
    holidayWrites++;
    result = { ok: true };
  } else if (url === "/api/settings") {
    if (options) settings = JSON.parse(options.body);
    result = settings;
  } else if (url === "/api/employees") result = employees;
  else if (url === "/api/audit")
    result = [
      {
        id: 1,
        action: "Attendance updated",
        entity: "attendance",
        entityId: 1,
        createdAt: today + " 10:30:00",
        details: {
          date: today,
          before: { inTime: "09:30" },
          after: { inTime: "10:00" },
        },
      },
    ];
  else if (url === "/api/attendance") {
    if (options) {
      const e = JSON.parse(options.body);
      entries = entries.filter(
        (r) => r.employeeId !== e.employeeId || r.date !== e.date,
      );
      entries.push({ ...e, id: 100 + e.employeeId, status: "In progress" });
      attendanceWrites++;
      result = { ok: true };
    } else
      result = entries.map((entry) => ({
        ...employees.find((employee) => employee.id === entry.employeeId),
        ...entry,
      }));
  } else throw new Error("Unexpected API " + url);
  return { ok: true, json: async () => structuredClone(result) };
};
await mkdir(".local", { recursive: true });
const file = ".local/ui-test-app.mjs";
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
  const { default: App } = await import(
    "../../" + file + "?test=" + Date.now()
  );
  render(React.createElement(App));
  await screen.findByRole("button", { name: "Record attendance" });
  assert.equal(screen.queryByText("Daily attendance"), null);
  assert.equal(document.documentElement.dataset.theme, "dark");
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Record attendance" }).disabled,
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Record attendance" }));
  let dialog = screen.getByRole("dialog");
  fireEvent.change(
    within(dialog).getByPlaceholderText("Add a little context…"),
    { target: { value: "First employee note" } },
  );
  fireEvent.submit(dialog.querySelector("form"));
  await waitFor(() => assert.equal(attendanceWrites, 1));
  await waitFor(() =>
    assert.equal(
      within(dialog).getByRole("button", { name: "Save attendance" }).disabled,
      false,
    ),
  );
  assert.ok(screen.getByRole("dialog"));
  fireEvent.click(dialog.parentElement);
  assert.equal(screen.queryByRole("dialog"), null);
  fireEvent.click(screen.getByRole("button", { name: "Record attendance" }));
  dialog = screen.getByRole("dialog");
  assert.ok(within(dialog).getByRole("button", { name: "Close dialog" }));
  fireEvent.change(within(dialog).getByLabelText("Employee"), {
    target: { value: "2" },
  });
  assert.equal(
    within(dialog).getByPlaceholderText("Add a little context…").value,
    "Second employee note",
  );
  assert.equal(within(dialog).getByLabelText("In time").value, "10:00 AM");
  assert.equal(within(dialog).getByLabelText("Out time").value, "");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  assert.equal(screen.queryByRole("dialog"), null);
  console.log(
    "PASS: attendance saves stay open, backdrop closes, reopening and switching employees reload their entry, Cancel closes.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  assert.ok(screen.getByRole("heading", { name: "Daily report · " + today }));
  fireEvent.change(screen.getByLabelText("Group"), {
    target: { value: "Sales" },
  });
  assert.ok(screen.getByText("First Person"));
  assert.equal(screen.queryByText("Second Person"), null);
  console.log("PASS: simple daily report is the default and filters by group.");
  fireEvent.click(
    within(document.querySelector(".sidebar")).getByRole("button", {
      name: "Settings",
      exact: true,
    }),
  );
  fireEvent.change(screen.getByLabelText("Configure timings for"), {
    target: { value: "group" },
  });
  fireEvent.change(screen.getByLabelText("Group"), {
    target: { value: "Sales" },
  });
  fireEvent.change(screen.getByLabelText("Shift start"), {
    target: { value: "10:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
  await waitFor(() =>
    assert.equal(settings.groupRules.Sales.shiftStart, "10:00"),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Save timings" }).disabled,
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("Configure timings for"), {
    target: { value: "employee" },
  });
  fireEvent.change(screen.getByLabelText("Employee"), {
    target: { value: "1" },
  });
  assert.equal(screen.getByLabelText("Shift start").value, "10:00 AM");
  fireEvent.change(screen.getByLabelText("Shift start"), {
    target: { value: "11:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
  await waitFor(() =>
    assert.equal(settings.employeeRules[1].shiftStart, "11:00"),
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Use inherited timings" }).disabled,
      false,
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Use inherited timings" }),
  );
  await waitFor(() => assert.equal(settings.employeeRules[1], undefined));
  console.log(
    "PASS: group timings, individual timing inheritance, custom employee timings, and reset.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  const calendar = screen.getByRole("region", { name: "Attendance calendar" });
  fireEvent.click(
    within(calendar).getByRole("button", {
      name: new RegExp(`^View ${today}`),
    }),
  );
  let dayPanel = screen.getByRole("region", { name: "Selected day report" });
  const originalEntries = JSON.stringify(entries);
  fireEvent.change(within(dayPanel).getByPlaceholderText("Holiday name"), {
    target: { value: "Team holiday" },
  });
  fireEvent.click(
    within(dayPanel).getByRole("button", { name: /^(Add|Save) holiday$/ }),
  );
  await waitFor(() => assert.equal(holidayWrites, 1));
  await within(dayPanel).findByText(/Holiday · Team holiday/);
  assert.equal(JSON.stringify(entries), originalEntries);
  assert.equal(
    within(calendar)
      .getByRole("button", { name: `View ${today}, Team holiday` })
      .getAttribute("aria-pressed"),
    "true",
  );
  fireEvent.change(within(dayPanel).getByPlaceholderText("Holiday name"), {
    target: { value: "Office closed" },
  });
  fireEvent.click(
    within(dayPanel).getByRole("button", { name: "Save holiday" }),
  );
  await within(dayPanel).findByText(/Holiday · Office closed/);
  fireEvent.click(
    within(dayPanel).getByRole("button", {
      name: "Edit attendance for Second Person",
    }),
  );
  dialog = screen.getByRole("dialog");
  assert.equal(within(dialog).getByLabelText("Date").value, today);
  assert.equal(
    within(dialog).getByPlaceholderText("Add a little context…").value,
    "Second employee note",
  );
  fireEvent.change(
    within(dialog).getByPlaceholderText("Add a little context…"),
    { target: { value: "Edited from calendar" } },
  );
  fireEvent.submit(dialog.querySelector("form"));
  await waitFor(() =>
    assert.equal(
      entries.find((e) => e.employeeId === 2 && e.date === today).notes,
      "Edited from calendar",
    ),
  );
  await waitFor(() =>
    assert.equal(
      within(dialog).getByRole("button", { name: "Save attendance" }).disabled,
      false,
    ),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    within(dayPanel).getByRole("button", { name: "Remove holiday" }),
  );
  await waitFor(() => assert.equal(holidayWrites, 3));
  await waitFor(() =>
    assert.equal(within(dayPanel).queryByText(/Holiday · Office closed/), null),
  );
  fireEvent.click(within(calendar).getByRole("button", { name: "Next month" }));
  const nextMonth = new Date(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
    1,
  );
  const nextDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
  assert.ok(
    within(dayPanel).getByRole("heading", { name: `Day report · ${nextDate}` }),
  );
  fireEvent.change(within(dayPanel).getByPlaceholderText("Holiday name"), {
    target: { value: "Future holiday" },
  });
  fireEvent.click(
    within(dayPanel).getByRole("button", { name: /^(Add|Save) holiday$/ }),
  );
  await within(dayPanel).findByText(/Holiday · Future holiday/);
  const firstRow = within(dayPanel).getByText("First Person").closest("tr");
  assert.ok(within(firstRow).getByText("Holiday"));
  fireEvent.click(
    within(dayPanel).getByRole("button", {
      name: "Edit attendance for First Person",
    }),
  );
  dialog = screen.getByRole("dialog");
  assert.equal(within(dialog).getByLabelText("Date").value, nextDate);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  fireEvent.click(screen.getByRole("button", { name: /Daily report$/ }));
  assert.ok(screen.getAllByText("Holiday").length >= 2);
  console.log(
    "PASS: calendar navigation, holiday create/edit/remove, preserve work, unmarked holiday status, selected-day editing and daily report.",
  );

  assert.equal(screen.queryByText("My workspace"), null);
  fireEvent.click(screen.getByRole("button", { name: /Monthly report$/ }));
  fireEvent.change(screen.getByLabelText("Report month"), {
    target: { value: "2026-10" },
  });
  assert.ok(
    screen.getByRole("button", { name: "First Person, 2026-10-04, Holiday" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next report month" }));
  assert.equal(screen.getByLabelText("Report month").value, "2026-11");
  fireEvent.click(
    screen.getByRole("button", { name: "Previous report month" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "First Person, 2026-10-04, Holiday" }),
  );
  dialog = screen.getByRole("dialog");
  assert.equal(within(dialog).getByLabelText("Date").value, "2026-10-04");
  fireEvent.click(within(dialog).getByRole("button", { name: "Next date" }));
  assert.equal(within(dialog).getByLabelText("Date").value, "2026-10-05");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Attendance details" }));
  assert.equal(screen.queryByLabelText("From"), null);
  assert.equal(screen.queryByLabelText("To"), null);
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: today } });
  assert.equal(screen.getByLabelText("Day").value, today);
  fireEvent.click(screen.getByRole("button", { name: "Employee summary" }));
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-10-07" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next date range" }));
  assert.equal(screen.getByLabelText("From").value, "2026-10-08");
  assert.equal(screen.getByLabelText("To").value, "2026-10-14");
  console.log(
    "PASS: monthly statuses, neutral Sunday, monthly/day/range navigation and attendance editing from the month grid.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Attendance", exact: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bulk absent" }));
  dialog = screen.getByRole("dialog");
  assert.equal(
    within(dialog).getByLabelText("Skip weekly holidays and named holidays")
      .checked,
    true,
  );
  assert.equal(
    within(dialog).getByLabelText("Replace existing attendance with Absent")
      .checked,
    false,
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Select displayed" }),
  );
  fireEvent.change(within(dialog).getByLabelText("From"), {
    target: { value: "2026-10-06" },
  });
  fireEvent.change(within(dialog).getByLabelText("To"), {
    target: { value: "2026-10-07" },
  });
  fireEvent.submit(dialog.querySelector("form"));
  await within(dialog).findByRole("button", { name: "Apply 2 absences" });
  assert.equal(bulkWrites, 0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Next to" }));
  assert.equal(
    within(dialog).queryByRole("button", { name: "Apply 2 absences" }),
    null,
  );
  fireEvent.submit(dialog.querySelector("form"));
  await waitFor(() => assert.equal(bulkPreviews, 2));
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Apply 2 absences" }),
  );
  await waitFor(() => assert.equal(bulkWrites, 1));
  await waitFor(() =>
    assert.equal(
      within(dialog).getByRole("button", { name: "Cancel" }).disabled,
      false,
    ),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  console.log(
    "PASS: bulk form requires review, invalidates changed previews, defaults to preserving existing entries and skipping holidays, and applies only on request.",
  );
  fireEvent.click(
    within(document.querySelector(".sidebar")).getByRole("button", {
      name: "Settings",
      exact: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Departments" }));
  fireEvent.change(screen.getByLabelText("New department"), {
    target: { value: "Operations" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
  await screen.findByText("Operations");
  const catalogRow = screen.getByText("Operations").closest(".catalog-row");
  fireEvent.click(within(catalogRow).getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("New name"), {
    target: { value: "Operations Team" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Operations Team");
  fireEvent.click(
    within(
      screen.getByText("Operations Team").closest(".catalog-row"),
    ).getByRole("button", { name: "Remove" }),
  );
  await waitFor(() =>
    assert.equal(screen.queryByText("Operations Team"), null),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Holidays", exact: true }),
  );
  fireEvent.click(screen.getByLabelText("Sunday"));
  fireEvent.click(screen.getByRole("button", { name: "Save weekly holidays" }));
  await waitFor(() => assert.deepEqual(settings.weeklyOffDays, []));
  console.log(
    "PASS: department add/rename/remove and weekly holiday settings.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Timings", exact: true }));
  assert.equal(
    screen.getByRole("switch", { name: "Use AM/PM time format" }).checked,
    true,
  );
  fireEvent.click(
    screen.getByRole("switch", { name: "Use AM/PM time format" }),
  );
  await waitFor(() => assert.equal(settings.timeFormat, "24h"));
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Shift start").type, "time"),
  );
  fireEvent.click(
    screen.getByRole("switch", { name: "Use AM/PM time format" }),
  );
  await waitFor(() => assert.equal(settings.timeFormat, "12h"));
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Shift start").value, "9:00 AM"),
  );
  fireEvent.change(screen.getByLabelText("Shift start"), {
    target: { value: "12:30 PM" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
  await waitFor(() => assert.equal(settings.shiftStart, "12:30"));
  fireEvent.click(screen.getByRole("button", { name: "Reports", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /Daily report$/ }));
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: today } });
  assert.ok(screen.getAllByText(/10:00 AM/).length);
  console.log(
    "PASS: AM/PM defaults, saved format toggle, canonical PM input, and formatted printable daily report.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Employee report", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Select employee"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Employee report from"), {
    target: { value: today },
  });
  fireEvent.change(screen.getByLabelText("Employee report to"), {
    target: { value: today },
  });
  assert.ok(screen.getByRole("heading", { name: "Second Person" }));
  assert.ok(
    screen.getByText(
      entries.find((e) => e.employeeId === 2 && e.date === today).notes,
    ),
  );
  assert.ok(screen.getByText("10:00 AM"));
  assert.ok(screen.getByText("No email provided"));
  console.log(
    "PASS: dashboard register removed; detailed employee report selects one person and shows dates, formatted clocks and notes.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Attendance", exact: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset attendance" }));
  dialog = screen.getByRole("dialog");
  assert.equal(
    within(dialog).queryByLabelText("Replace existing attendance with Absent"),
    null,
  );
  assert.equal(
    within(dialog).queryByLabelText("Skip weekly holidays and named holidays"),
    null,
  );
  assert.equal(
    within(dialog).getByRole("button", { name: "Preview changes" }).disabled,
    true,
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Select displayed" }),
  );
  fireEvent.change(within(dialog).getByLabelText("From"), {
    target: { value: today },
  });
  fireEvent.change(within(dialog).getByLabelText("To"), {
    target: { value: today },
  });
  const resetCount = entries.filter((r) => r.date === today).length;
  assert.ok(resetCount > 0);
  fireEvent.submit(dialog.querySelector("form"));
  await within(dialog).findByRole("button", {
    name: `Reset ${resetCount} entries`,
  });
  assert.equal(resetWrites, 0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Next to" }));
  assert.equal(
    within(dialog).queryByRole("button", { name: /^Reset \d+ entries$/ }),
    null,
  );
  fireEvent.submit(dialog.querySelector("form"));
  fireEvent.click(
    await within(dialog).findByRole("button", { name: /^Reset \d+ entries$/ }),
  );
  await waitFor(() => assert.equal(resetWrites, 1));
  await screen.findByText(/attendance entries reset$/);
  assert.equal(entries.filter((r) => r.date === today).length, 0);
  await waitFor(() =>
    assert.equal(
      within(dialog).getByRole("button", { name: "Cancel" }).disabled,
      false,
    ),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  console.log(
    "PASS: reset selection/date range, preview required and invalidated on changes, explicit apply, and attendance reload.",
  );
  // New timing options persist, and the calendar separates Absent from Unmarked.
  entries.push({
    id: 999,
    employeeId: 1,
    date: "2026-10-12",
    mode: "manual",
    status: "Absent",
    notes: "Leave approved via WhatsApp",
  });
  fireEvent.click(
    within(document.querySelector(".sidebar")).getByRole("button", {
      name: "Settings",
      exact: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Timings", exact: true }));
  assert.equal(screen.getByLabelText("Deduct a 1-hour break").checked, false);
  assert.equal(
    screen.getByLabelText("Automatic Out time at 8 PM").checked,
    true,
  );
  fireEvent.click(screen.getByLabelText("Deduct a 1-hour break"));
  fireEvent.click(screen.getByText("Day-specific shift times"));
  fireEvent.click(screen.getByLabelText("Saturday"));
  fireEvent.change(screen.getByLabelText("Saturday start"), {
    target: { value: "11:00 AM" },
  });
  fireEvent.change(screen.getByLabelText("Saturday end"), {
    target: { value: "5:00 PM" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
  await waitFor(() => assert.equal(settings.breakDeductionEnabled, true));
  assert.equal(settings.weekdayShifts[6].shiftStart, "11:00");
  assert.equal(settings.weekdayShifts[6].shiftEnd, "17:00");
  fireEvent.click(
    screen.getByRole("button", { name: "Calendar", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Selected day"), {
    target: { value: "2026-10-12" },
  });
  assert.ok(screen.getByText("Absent: First Person"));
  fireEvent.click(
    screen.getByRole("button", { name: "Preview attendance for 2026-10-12" }),
  );
  const preview = screen.getByRole("dialog");
  assert.ok(within(preview).getByText("A 1"));
  assert.ok(within(preview).getByText("First Person"));
  assert.equal(within(preview).queryByText("Second Person"), null);
  fireEvent.click(
    within(preview).getByRole("button", { name: "Close preview" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reports", exact: true }));
  fireEvent.click(
    screen.getByRole("button", { name: "Attendance details", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Day"), {
    target: { value: "2026-10-12" },
  });
  assert.ok(screen.getByText("Leave approved via WhatsApp"));
  fireEvent.change(screen.getByLabelText("Day"), {
    target: { value: "2026-10-13" },
  });
  assert.equal(screen.queryByText("Leave approved via WhatsApp"), null);
  fireEvent.click(
    screen.getByRole("button", { name: "Activity log", exact: true }),
  );
  assert.ok(screen.getByText("Attendance updated", { selector: "strong" }));
  assert.ok(screen.getByText(new RegExp("First Person")));
  fireEvent.change(screen.getByLabelText("Search activity"), {
    target: { value: "unmatched" },
  });
  assert.ok(screen.getByText("No matching activity."));
  fireEvent.change(screen.getByLabelText("Search activity"), {
    target: { value: "First Person" },
  });
  assert.ok(screen.getByText("Attendance updated", { selector: "strong" }));
  console.log(
    "PASS: break toggle, recurring weekday shifts, calendar absentee names and preview, one-day details filtering, and readable/searchable activity.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
