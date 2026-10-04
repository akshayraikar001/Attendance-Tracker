import test from "node:test";
import assert from "node:assert/strict";
import { formatTime, parseTime } from "../../shared/time.js";
import { defaults, settingsSchema } from "../src/rules.js";
test("clock display handles midnight, noon, afternoon, blanks and 24-hour format without timezone conversion", () => {
  for (const [value, label] of [
    ["00:00", "12:00 AM"],
    ["12:00", "12:00 PM"],
    ["09:35", "9:35 AM"],
    ["17:15", "5:15 PM"],
    ["23:59", "11:59 PM"],
  ]) {
    assert.equal(formatTime(value), label);
    assert.equal(parseTime(label), value);
    assert.equal(formatTime(value, "24h"), value);
  }
  assert.equal(formatTime(null), "—");
  assert.equal(parseTime(""), "");
  assert.equal(parseTime("9:35 am"), "09:35");
  for (const value of ["13:00 PM", "00:10 AM", "9:60 AM", "24:00", "wrong"])
    assert.equal(parseTime(value), null);
});
test("settings default to AM/PM and validate the saved workspace preference", () => {
  assert.equal(settingsSchema.parse(defaults).timeFormat, "12h");
  assert.equal(
    settingsSchema.parse({ ...defaults, timeFormat: "24h" }).timeFormat,
    "24h",
  );
  assert.equal(
    settingsSchema.safeParse({ ...defaults, timeFormat: "other" }).success,
    false,
  );
});
