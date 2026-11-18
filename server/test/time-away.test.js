import test from "node:test";
import assert from "node:assert/strict";
import { timeAwaySchema } from "../src/controllers/employee-access.js";
const base = {
  employeeId: 1,
  date: "2026-10-07",
  departedAt: "2026-10-07T23:30",
  reason: "Errand",
};
test("Time away supports open intervals and overnight returns", () => {
  assert.equal(timeAwaySchema.parse(base).returnedAt, null);
  assert.equal(
    timeAwaySchema.parse({ ...base, returnedAt: "2026-10-08T00:15" })
      .returnedAt,
    "2026-10-08T00:15",
  );
});
test("Time away rejects invalid calendar dates, reversed times, and mismatched departure dates", () => {
  for (const entry of [
    { ...base, departedAt: "2026-02-30T12:00", date: "2026-02-30" },
    { ...base, returnedAt: "2026-10-07T23:30" },
    { ...base, returnedAt: "2026-10-07T23:29" },
    { ...base, date: "2026-10-06" },
    { ...base, returnedAt: "2026-10-08T25:00" },
  ])
    assert.equal(timeAwaySchema.safeParse(entry).success, false);
});
