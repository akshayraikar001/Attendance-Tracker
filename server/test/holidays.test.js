import test from "node:test";
import assert from "node:assert/strict";
import { holidayDateSchema, holidaySchema } from "../src/services/rules.js";
test("holiday dates validate actual calendar dates and SQL date bounds", () => {
  assert.equal(holidayDateSchema.parse("2028-02-29"), "2028-02-29");
  for (const date of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-1-1",
    "not a date",
  ]) {
    assert.equal(holidayDateSchema.safeParse(date).success, false, date);
  }
});
test("holidays require a name, trim it, and support reversible removal", () => {
  assert.deepEqual(holidaySchema.parse({ name: "  Office holiday  " }), {
    name: "Office holiday",
    active: true,
  });
  assert.equal(
    holidaySchema.parse({ name: "Office holiday", active: false }).active,
    false,
  );
  for (const value of [
    { name: " " },
    { name: "x".repeat(101) },
    { name: "Holiday", active: "false" },
  ]) {
    assert.equal(holidaySchema.safeParse(value).success, false);
  }
});
