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

test("Relative spellings and consecutive lists suggest both dates without approving gaps", () => {
  for (const word of [
    "tomorrow",
    "tomorow",
    "tommorow",
    "tommorrow",
    "tomorw",
    "tommorw",
  ]) {
    const parsed = parseLeaveMessage(
      `@919999999999 sir leave today and ${word}`,
      at,
      "UTC",
    );
    assert.equal(parsed.from, "2026-10-06", word);
    assert.equal(parsed.to, "2026-10-07", word);
  }
  for (const text of [
    "Leave on 15,16",
    "Halfday on 15 and 16 Oct",
    "Leave 16 & 15 October 2026",
    "Leave 15th,16th Oct",
  ]) {
    const parsed = parseLeaveMessage(text, at, "UTC");
    assert.equal(parsed.from, "2026-10-15", text);
    assert.equal(parsed.to, "2026-10-16", text);
  }
  for (const text of [
    "Today I need to take leave",
    "@919999999999 leave today",
  ]) {
    const parsed = parseLeaveMessage(text, at, "UTC");
    assert.equal(parsed.from, "2026-10-06", text);
    assert.equal(parsed.to, "2026-10-06", text);
  }
  for (const text of [
    "Leave on 15,18",
    "Leave today and Friday",
    "Leave tomorrow for 3 days",
    "Leave 30,31 February",
    "Cancel leave today and tommorw",
    "Leave today and 2026-10-15",
    "Leave from 8 to 10 and 15,16",
  ]) {
    assert.equal(parseLeaveMessage(text, at, "UTC").from, null, text);
  }
  const sent = Date.parse("2026-12-31T20:00:00Z") / 1000;
  assert.equal(
    parseLeaveMessage("Leave today and tommorw", sent, "Asia/Kolkata").to,
    "2027-01-02",
  );
  assert.equal(
    parseLeaveMessage("Leave today to day after tomorrow", at, "UTC").to,
    "2026-10-08",
  );
});

test("weekday leave uses the message's Monday–Sunday week", () => {
  for (const text of [
    "Leave Friday and Saturday",
    "@919999999999 I want to take leave fri & sat",
    "Half day this Friday, Saturday",
  ]) {
    const result = parseLeaveMessage(text, at, "Asia/Kolkata");
    assert.equal(result.from, "2026-10-09", text);
    assert.equal(result.to, "2026-10-10", text);
  }
  assert.equal(parseLeaveMessage("Leave Friday", at, "UTC").from, "2026-10-09");
  const range = parseLeaveMessage("Leave Friday to Sunday", at, "UTC");
  assert.equal(range.from, "2026-10-09");
  assert.equal(range.to, "2026-10-11");
  const sunday = Date.parse("2026-10-11T10:00:00Z") / 1000;
  assert.equal(
    parseLeaveMessage("Leave Friday and Saturday", sunday, "UTC").from,
    "2026-10-09",
  );
  const midnight = Date.parse("2026-10-11T23:30:00Z") / 1000;
  assert.equal(
    parseLeaveMessage("Leave Friday and Saturday", midnight, "Asia/Kolkata")
      .from,
    "2026-10-16",
  );
  assert.equal(
    parseLeaveMessage("Leave Friday and Saturday", midnight, "UTC").from,
    "2026-10-09",
  );
  const newYear = Date.parse("2027-01-01T10:00:00Z") / 1000;
  assert.equal(
    parseLeaveMessage("Leave Monday", newYear, "UTC").from,
    "2026-12-28",
  );
  for (const text of [
    "Leave next Friday",
    "Leave Friday and Monday",
    "Leave Friday or Saturday",
    "Leave Friday return Saturday",
    "Leave today and Friday",
    "Leave Friday 15",
    "Leave Friday to",
    "Not on leave Friday",
  ]) {
    const result = parseLeaveMessage(text, at, "UTC");
    assert.equal(result.from, null, text);
    assert.ok(result.reason, text);
  }
  assert.equal(
    parseLeaveMessage("@Friday leave tomorrow", at, "UTC").from,
    "2026-10-07",
  );
});
