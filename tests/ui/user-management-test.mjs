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
  "FormData",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { render, screen, fireEvent, waitFor, within, cleanup } =
  await import("@testing-library/react");
const accounts = [
  {
    id: 1,
    username: "jane.doe",
    name: "Admin User",
    role: "Admin",
    active: true,
  },
];
const employees = [
  { id: 7, name: "Jane Doe" },
  { id: 8, name: "José Smith" },
  { id: 9, name: "李明" },
];
const writes = [];
async function api(path, body, method) {
  if (body) {
    assert.equal(
      typeof body.active,
      "boolean",
      "Active must be a boolean, never the numeric employee ID",
    );
    assert.equal(body.keycloakSubject, null, "Blank Keycloak ID is optional");
    writes.push({ path, body, method });
    if (method === "POST") accounts.push({ ...body, id: accounts.length + 1 });
    else
      Object.assign(
        accounts.find((a) => path === "/users/" + a.id),
        body,
      );
    return { ok: true };
  }
  if (path === "/users") return [...accounts];
  if (path === "/employees") return employees;
  throw new Error(path);
}
const file = ".local/user-management-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/pages/account/UserManagement.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: UserManagement } = await import("../../" + file);
  render(React.createElement(UserManagement, { api, user: accounts[0] }));
  await screen.findByText("Admin User (you)");
  fireEvent.click(screen.getByRole("button", { name: "Add user" }));
  const employee = screen.getByLabelText("Linked employee");
  assert.equal(employee.required, true);
  fireEvent.change(employee, { target: { value: "7" } });
  assert.equal(screen.getByLabelText("Name").value, "Jane Doe");
  assert.equal(
    screen.getByLabelText("Username").value,
    "jane.doe.7",
    "Avoid existing usernames",
  );
  fireEvent.change(employee, { target: { value: "9" } });
  assert.equal(screen.getByLabelText("Name").value, "李明");
  assert.equal(screen.getByLabelText("Username").value, "employee.9");
  fireEvent.change(employee, { target: { value: "8" } });
  assert.equal(screen.getByLabelText("Name").value, "José Smith");
  assert.equal(screen.getByLabelText("Username").value, "jose.smith");
  assert.equal(screen.getByLabelText(/Keycloak user ID/).required, false);
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "employee-password-123" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Save account" }).closest("form"),
  );
  await waitFor(() =>
    assert.equal(
      Boolean(screen.queryByRole("button", { name: "Save account" })),
      false,
    ),
  );
  assert.deepEqual(writes[0].body, {
    employeeId: 8,
    name: "José Smith",
    username: "jose.smith",
    password: "employee-password-123",
    role: "Employee",
    keycloakSubject: null,
    active: true,
  });
  let row = screen.getByText("jose.smith").closest("tr");
  fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
  assert.equal(screen.getByLabelText("Username").disabled, true);
  fireEvent.change(screen.getByLabelText("Linked employee"), {
    target: { value: "7" },
  });
  assert.equal(screen.getByLabelText("Name").value, "Jane Doe");
  assert.equal(
    screen.getByLabelText("Username").value,
    "jose.smith",
    "Existing login stays stable",
  );
  fireEvent.click(screen.getByLabelText("Active account"));
  fireEvent.submit(
    screen.getByRole("button", { name: "Save account" }).closest("form"),
  );
  await waitFor(() =>
    assert.equal(
      Boolean(screen.queryByRole("button", { name: "Save account" })),
      false,
    ),
  );
  assert.equal(writes[1].body.active, false);
  assert.equal(writes[1].body.employeeId, 7);
  assert.equal(writes[1].method, "PUT");
  assert.equal(writes[1].body.password, undefined);
  fireEvent.click(screen.getByRole("button", { name: "Add user" }));
  fireEvent.change(screen.getByLabelText("Access role"), {
    target: { value: "Staff" },
  });
  assert.equal(screen.getByLabelText("Linked employee").required, false);
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Staff Person" },
  });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "staff.person" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "staff-password-123" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Save account" }).closest("form"),
  );
  await waitFor(() =>
    assert.equal(
      Boolean(screen.queryByRole("button", { name: "Save account" })),
      false,
    ),
  );
  assert.equal(writes[2].body.employeeId, null);
  assert.equal(writes[2].body.active, true);
  console.log(
    "PASS: employee autofill/switching, username collisions and Unicode names, optional Keycloak, active/inactive boolean payloads, edit and unlinked staff creation.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
