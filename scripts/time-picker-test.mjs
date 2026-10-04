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
const file = ".local/time-picker-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/components/TimeDisplay.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { TimeInput, TimeFormatContext } = await import("../" + file);
  const changes = [];
  function Harness({ format = "12h", disabled = false }) {
    const [value, setValue] = React.useState("09:00");
    return React.createElement(
      TimeFormatContext.Provider,
      { value: format },
      React.createElement(
        "fieldset",
        { disabled },
        React.createElement(TimeInput, {
          "aria-label": "Clock in",
          value,
          onChange: (e) => {
            changes.push(e.target.value);
            setValue(e.target.value);
          },
        }),
      ),
    );
  }
  render(React.createElement(Harness));
  assert.equal(screen.getByLabelText("Clock in").value, "9:00 AM");
  fireEvent.click(screen.getByRole("button", { name: "Choose time" }));
  assert.ok(screen.getByRole("group", { name: "Time picker" }));
  fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Minute"), {
    target: { value: "35" },
  });
  fireEvent.change(screen.getByLabelText("AM or PM"), {
    target: { value: "PM" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set time" }));
  assert.equal(changes.at(-1), "12:35");
  assert.equal(screen.getByLabelText("Clock in").value, "12:35 PM");
  assert.equal(screen.queryByRole("group", { name: "Time picker" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Choose time" }));
  fireEvent.change(screen.getByLabelText("AM or PM"), {
    target: { value: "AM" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set time" }));
  assert.equal(changes.at(-1), "00:35");
  fireEvent.click(screen.getByRole("button", { name: "Choose time" }));
  fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "4" } });
  fireEvent.keyDown(screen.getByLabelText("Hour"), { key: "Escape" });
  assert.equal(screen.queryByRole("group", { name: "Time picker" }), null);
  assert.equal(changes.at(-1), "00:35");
  fireEvent.change(screen.getByLabelText("Clock in"), {
    target: { value: "5:15 PM" },
  });
  assert.equal(changes.at(-1), "17:15");
  fireEvent.change(screen.getByLabelText("Clock in"), {
    target: { value: "bad time" },
  });
  assert.equal(screen.getByLabelText("Clock in").checkValidity(), false);
  fireEvent.click(screen.getByRole("button", { name: "Choose time" }));
  fireEvent.click(screen.getByRole("button", { name: "Set time" }));
  assert.equal(screen.getByLabelText("Clock in").checkValidity(), true);
  cleanup();
  render(React.createElement(Harness, { format: "24h" }));
  assert.equal(screen.getByLabelText("Clock in").type, "time");
  fireEvent.change(screen.getByLabelText("Clock in"), {
    target: { value: "18:45" },
  });
  assert.equal(changes.at(-1), "18:45");
  console.log(
    "PASS: clock picker, noon/midnight, cancel, manual entry, validation recovery, and 24-hour entry.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
