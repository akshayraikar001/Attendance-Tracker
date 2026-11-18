import test from "node:test";
import assert from "node:assert/strict";
import { groupMessageTimes } from "../../shared/group-message-times.js";
test("group hints detect both labels anywhere without requiring an attendance message", () => {
  assert.deepEqual(
    groupMessageTimes("Hello team, InTime 9.15 am, Out time 7:05 p.m."),
    { inTime: "09:15", outTime: "19:05" },
  );
  assert.deepEqual(groupMessageTimes("Out 7pm"), {
    inTime: null,
    outTime: "19:00",
  });
  assert.deepEqual(groupMessageTimes("See you in 2 days; out 25:99"), {
    inTime: null,
    outTime: null,
  });
  assert.deepEqual(groupMessageTimes("Good morning everyone"), {
    inTime: null,
    outTime: null,
  });
});
