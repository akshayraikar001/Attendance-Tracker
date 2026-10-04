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
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  requests.push({ url, body });
  if (url === "/api/auth/me") return { ok: false, status: 401 };
  if (url === "/api/auth/register" || url === "/api/auth/login")
    return { ok: true, json: async () => ({ name: "Test Person" }) };
  throw new Error(url);
};
const file = ".local/auth-ui-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/components/AuthGate.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: Gate } = await import("../" + file);
  const draw = () =>
    render(
      React.createElement(Gate, null, () =>
        React.createElement("p", null, "Workspace loaded"),
      ),
    );
  draw();
  await screen.findByRole("heading", { name: "Welcome back" });
  fireEvent.click(
    screen.getByRole("button", { name: "New to Dayline? Create account" }),
  );
  assert.equal(screen.queryByText("One-time setup code"), null);
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Test Person" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password-123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "wrong-password" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create account" }).closest("form"),
  );
  await screen.findByText("Passwords do not match.");
  assert.equal(
    requests.filter((r) => r.url === "/api/auth/register").length,
    0,
  );
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "test-password-123" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create account" }).closest("form"),
  );
  await screen.findByText("Workspace loaded");
  assert.equal(requests.at(-1).body.email, "person@example.test");
  assert.equal(requests.at(-1).body.confirmPassword, "test-password-123");
  cleanup();
  draw();
  await screen.findByRole("heading", { name: "Welcome back" });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in", exact: true }));
  await screen.findByText("Workspace loaded");
  console.log(
    "PASS: internal signup, password confirmation, immediate access, email sign-in.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
