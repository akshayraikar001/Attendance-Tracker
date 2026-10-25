import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://attendance.test",
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
Object.defineProperty(window, "isSecureContext", { value: true });
let denied = false,
  captures = 0;
Object.defineProperty(navigator, "geolocation", {
  value: {
    getCurrentPosition(success, error, options) {
      captures++;
      assert.equal(options.maximumAge, 0);
      assert.equal(options.enableHighAccuracy, true);
      if (denied) error({ code: 1 });
      else
        success({
          coords: { latitude: 12.9, longitude: 77.5, accuracy: 8 },
          timestamp: Date.now(),
        });
    },
  },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { render, screen, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
let enabled = false;
let configStatus = {
  provider: "google",
  geoapifyConfigured: false,
  embedConfigured: false,
  geocodingConfigured: false,
};
const configWrites = [];
const records = [],
  writes = [];
globalThis.fetch = async (url, options = {}) => {
  let result;
  if (url === "/api/locations/config") {
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      configWrites.push(body);
      if (body.provider) configStatus.provider = body.provider;
      for (const [field, status] of [
        ["geoapifyKey", "geoapifyConfigured"],
        ["embedKey", "embedConfigured"],
        ["geocodingKey", "geocodingConfigured"],
      ])
        if (body[field] !== undefined)
          configStatus[status] = Boolean(body[field]);
    }
    result = { ...configStatus };
  } else if (url.startsWith("/api/location-areas/"))
    result = { areaName: "Indiranagar, Bengaluru", status: "ok" };
  else if (url === "/api/employees")
    result = [{ id: 1, name: "Selected Employee" }];
  else if (url === "/api/locations/employees/1") {
    const body = JSON.parse(options.body);
    assert.equal(options.method, "PUT");
    enabled = body.enabled;
    result = { enabled };
  } else if (url === "/api/me/locations" && options.method === "POST") {
    const body = JSON.parse(options.body);
    assert.ok(enabled);
    writes.push(body);
    records.unshift({
      ...body,
      id: records.length + 1,
      employeeId: 1,
      hasPhoto: false,
      capturedAt: body.capturedAt.slice(0, 23).replace("T", " "),
      receivedAt: body.capturedAt.slice(0, 23).replace("T", " "),
    });
    result = { id: records.length };
  } else if (options.method === "DELETE" && url.startsWith("/api/locations/")) {
    records.splice(
      records.findIndex((r) => r.id === Number(url.split("/").pop())),
      1,
    );
    result = { ok: true };
  } else if (
    url.startsWith("/api/me/locations?") ||
    url.startsWith("/api/locations?")
  ) {
    if (url.startsWith("/api/locations?"))
      assert.equal(
        new URL(url, "https://test").searchParams.get("employeeId"),
        "1",
      );

    assert.equal(new URL(url, "https://test").searchParams.has("from"), false);
    result = {
      enabled,
      date: "2026-10-08",
      timeZone: "Asia/Kolkata",
      records: [...records],
      mapProvider: configStatus.provider,
      mapsConfigured: configStatus.geoapifyConfigured,
      mapsKey: "",
      areaNamesConfigured: true,
      limit: 500,
    };
  } else throw new Error("Unexpected " + url);
  return { ok: true, json: async () => result };
};
const file = ".local/locations-ui-test.mjs";
await mkdir(".local", { recursive: true });
try {
  await build({
    entryPoints: ["client/src/pages/locations/LocationTracking.jsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  const { default: Locations } = await import("../../" + file);
  render(React.createElement(Locations, { admin: true }));
  await screen.findByRole("option", { name: "Selected Employee" });
  assert.ok(screen.getByText("Map settings · API keys"));
  assert.ok(screen.getByLabelText("Day"));
  fireEvent.click(screen.getByText("Map settings · API keys"));
  fireEvent.change(screen.getByLabelText("Maps preview API key"), {
    target: { value: "test-browser-key" },
  });
  fireEvent.change(screen.getByLabelText("Area names API key"), {
    target: { value: "test-server-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save map settings" }));
  await screen.findByText("Map settings saved.");
  assert.deepEqual(configWrites[0], {
    provider: "google",
    embedKey: "test-browser-key",
    geocodingKey: "test-server-key",
  });
  assert.equal(screen.getByLabelText("Area names API key").value, "");
  fireEvent.click(screen.getByRole("button", { name: "Save map settings" }));
  await waitFor(() => assert.equal(configWrites.length, 2));
  assert.deepEqual(configWrites[1], { provider: "google" });
  fireEvent.change(screen.getByLabelText("Map provider"), {
    target: { value: "geoapify" },
  });
  fireEvent.change(screen.getByLabelText("Geoapify API key"), {
    target: { value: "private-geoapify-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save map settings" }));
  await waitFor(() => assert.equal(configWrites.length, 3));
  assert.deepEqual(configWrites[2], {
    provider: "geoapify",
    geoapifyKey: "private-geoapify-key",
  });
  assert.equal(screen.queryByLabelText("Maps preview API key"), null);

  fireEvent.change(screen.getByLabelText("Employee"), {
    target: { value: "1" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Enable check-ins" }),
  );
  await screen.findByRole("button", { name: "Disable check-ins" });
  cleanup();
  render(React.createElement(Locations));
  const submit = await screen.findByRole("button", {
    name: "Capture & save location",
  });
  assert.equal(screen.queryByLabelText(/latitude/i), null);
  fireEvent.change(screen.getByLabelText("Visit note (optional)"), {
    target: { value: "Customer visit" },
  });
  fireEvent.click(submit);
  await screen.findByText("Location check-in saved.");
  await screen.findByRole("link", { name: "Google Maps" });
  const map = await screen.findByAltText("Map showing this check-in location");
  assert.ok(map.getAttribute("src").startsWith("/api/location-maps/"));
  assert.equal(
    document.querySelector('iframe[src*="google.com/maps/embed"]'),
    null,
  );
  assert.ok(!map.getAttribute("src").includes("private-geoapify"));

  await screen.findAllByText("Indiranagar, Bengaluru");
  assert.equal(screen.queryByText("12.900000, 77.500000"), null);
  assert.ok(screen.getByText("Daily timeline · latest first · Asia/Kolkata"));
  const expectedTime = new Date(writes[0].capturedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  assert.equal(
    document.querySelector(".location-entry time").textContent,
    expectedTime,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].latitude, 12.9);
  assert.equal(writes[0].longitude, 77.5);
  assert.equal(writes[0].photo, null);
  assert.equal(writes[0].employeeId, undefined);
  assert.ok(
    screen
      .getByRole("link", { name: "Google Maps" })
      .href.includes("12.9%2C77.5"),
  );
  assert.equal(screen.queryByRole("button", { name: "Delete check-in" }), null);
  denied = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Capture & save location" }),
  );
  await screen.findByText(/Location permission was denied/);
  assert.equal(writes.length, 1);
  assert.equal(captures, 2);
  cleanup();
  render(React.createElement(Locations, { admin: true }));
  await screen.findByRole("option", { name: "Selected Employee" });
  fireEvent.change(screen.getByLabelText("Employee"), {
    target: { value: "1" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Disable check-ins" }),
  );
  await screen.findByRole("button", { name: "Enable check-ins" });
  assert.equal(enabled, false);
  assert.ok(screen.getByRole("link", { name: "Google Maps" }));
  window.confirm = () => false;
  fireEvent.click(screen.getByRole("button", { name: "Delete check-in" }));
  assert.equal(records.length, 1);
  window.confirm = () => true;
  fireEvent.click(screen.getByRole("button", { name: "Delete check-in" }));
  await screen.findByText("Location check-in deleted.");
  await screen.findByText("No check-ins on this day.");
  assert.equal(records.length, 0);
  console.log(
    "PASS: admin employee selection/enable/disable, fresh device capture, optional photo, immutable coordinates, saved history, maps link, and permission-denied handling.",
  );
} finally {
  cleanup();
  dom.window.close();
  await rm(file, { force: true });
}
