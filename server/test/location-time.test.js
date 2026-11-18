import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayBounds,
  localDate,
  utcInstant,
} from "../../shared/location-time.js";
test("India local midnight spans two UTC dates", () => {
  assert.deepEqual(dayBounds("2026-10-08", "Asia/Kolkata"), [
    "2026-10-07 18:30:00.000",
    "2026-10-08 18:30:00.000",
  ]);
  assert.equal(
    localDate(utcInstant("2026-10-07 19:00:00.000"), "Asia/Kolkata"),
    "2026-10-08",
  );
  assert.equal(
    utcInstant("2026-10-08T04:00:00.000Z").toISOString(),
    "2026-10-08T04:00:00.000Z",
  );
});
test("local days accommodate daylight saving changes", () => {
  assert.deepEqual(dayBounds("2026-03-08", "America/New_York"), [
    "2026-03-08 05:00:00.000",
    "2026-03-09 04:00:00.000",
  ]);
  assert.deepEqual(dayBounds("2026-11-01", "America/New_York"), [
    "2026-11-01 04:00:00.000",
    "2026-11-02 05:00:00.000",
  ]);
});
