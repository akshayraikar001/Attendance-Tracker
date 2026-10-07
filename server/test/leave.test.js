import test from "node:test";
import assert from "node:assert/strict";
import { parseLeaveMessage, leaveDates } from "../src/utils/leave-parser.js";
const at = Date.parse("2026-10-06T10:00:00Z") / 1000;
test("Leave examples propose inclusive dates without changing attendance", () => {
  const examples = [
    [
      "@Bharat sir i will be on a leave from 8 to 10",
      "Absent",
      "2026-10-08",
      "2026-10-10",
    ],
    [
      "@Bharat sir i will be on a leave from 8 to 10 oct",
      "Absent",
      "2026-10-08",
      "2026-10-10",
    ],
    [
      "@Bharat sir i will be on a leave for tomorow",
      "Absent",
      "2026-10-07",
      "2026-10-07",
    ],
    ["@Bharat sir Today i am on a leave", "Absent", "2026-10-06", "2026-10-06"],
    [
      "@Bharat sirtoday i am on a half day",
      "Half day",
      "2026-10-06",
      "2026-10-06",
    ],
    [
      "@all tommorow i may be on a halfday",
      "Half day",
      "2026-10-07",
      "2026-10-07",
    ],
    ["Leave from 30 Dec to 2 Jan", "Absent", "2026-12-30", "2027-01-02"],
    ["Leave from 30 to 2", "Absent", "2026-10-30", "2026-11-02"],
    ["Leave on 8th October 2026", "Absent", "2026-10-08", "2026-10-08"],
    [
      "Leave from 08/10/2026 to 10/10/2026",
      "Absent",
      "2026-10-08",
      "2026-10-10",
    ],
    ["Leave on 2026-10-08", "Absent", "2026-10-08", "2026-10-08"],
    ["Half-day day after tomorrow", "Half day", "2026-10-08", "2026-10-08"],
  ];
  for (const [text, kind, from, to] of examples) {
    const result = parseLeaveMessage(text, at, "Asia/Kolkata");
    assert.equal(result.kind, kind, text);
    assert.equal(result.from, from, text);
    assert.equal(result.to, to, text);
  }
  assert.equal(parseLeaveMessage(examples[5][0], at, "UTC").tentative, true);
  assert.equal(leaveDates("2026-10-08", "2026-10-10").length, 3);
  assert.equal(parseLeaveMessage("Leave on 8 May", at, "UTC").tentative, false);
});
test("Relative dates use message timestamp/timezone, including midnight and year rollover", () => {
  const sent = Date.parse("2026-12-31T20:00:00Z") / 1000;
  assert.equal(
    parseLeaveMessage("Leave today", sent, "Asia/Kolkata").from,
    "2027-01-01",
  );
  assert.equal(
    parseLeaveMessage("Leave tomorrow", sent, "UTC").from,
    "2027-01-01",
  );
  assert.equal(
    parseLeaveMessage("Leave yesterday", sent, "Asia/Kolkata").from,
    "2026-12-31",
  );
});
test("Unclear, cancelled, invalid and non-contiguous requests require date review", () => {
  for (const text of [
    "Leave next week",
    "Cancel my leave tomorrow",
    "I am not on leave today",
    "Leave on 31 September",
    "Leave on 2026-02-29",
    "Leave from 8 to 10 oct and 12 oct",
    "Leave today and tomorrow",
    "Leave tomorrow to Friday",
  ]) {
    const result = parseLeaveMessage(text, at, "UTC");
    assert.equal(result.from, null, text);
    assert.ok(result.reason, text);
  }
  for (const text of [
    "IN 10:50",
    "Out time 6:55",
    "Good morning",
    "I am leaving now",
  ])
    assert.equal(parseLeaveMessage(text, at, "UTC"), null);
  assert.throws(() => leaveDates("2026-10-10", "2026-10-08"));
  assert.throws(() => leaveDates("2026-02-30", "2026-03-01"));
  assert.throws(() => leaveDates("2026-01-01", "2027-12-31"));
});
