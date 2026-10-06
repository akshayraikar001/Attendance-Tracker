import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAttendanceMessage,
  senderIdentity,
} from "../src/whatsapp-parser.js";
const at = Date.parse("2026-10-05T04:00:00Z") / 1000;
test("WhatsApp IN/OUT uses selected timezone and explicit clock values", () => {
  assert.deepEqual(parseAttendanceMessage("IN", at, "Asia/Kolkata"), {
    action: "in",
    date: "2026-10-05",
    time: "09:30",
  });
  assert.equal(
    parseAttendanceMessage("Out 6:15 PM", at, "Asia/Kolkata").time,
    "18:15",
  );
  assert.equal(
    parseAttendanceMessage("In time: 09:30", at, "UTC").time,
    "09:30",
  );
  assert.equal(
    parseAttendanceMessage("clock out 12:00 AM", at, "UTC").time,
    "00:00",
  );
  assert.equal(
    parseAttendanceMessage("Check-in 12.00 PM", at, "UTC").time,
    "12:00",
  );
  assert.equal(
    parseAttendanceMessage("IN", at, "America/New_York").time,
    "00:00",
  );
});
test("Unclear times are held for review and unrelated conversation is ignored", () => {
  for (const text of [
    "In 25:00",
    "In tomorrow",
    "IN 9:99 AM",
    "In 9:30 AM out 6 PM",
  ])
    assert.ok(parseAttendanceMessage(text, at, "UTC").reason, text);
  assert.equal(parseAttendanceMessage("Good morning", at, "UTC"), null);
  assert.equal(
    parseAttendanceMessage("Please check in later", at, "UTC"),
    null,
  );
  assert.equal(parseAttendanceMessage("Out 6:30", at, "UTC").time, "18:30");
});
test("Invalid minutes remain invalid before office-hour conversion for IN and OUT", () => {
  for (const action of ["In time", "out Time"])
    for (let hour = 1; hour <= 8; hour++)
      for (const minute of ["60", "99"])
        for (const suffix of ["", " AM", " PM"])
          for (const separator of [":", "."]) {
            const text = `${action} ${hour}${separator}${minute}${suffix}`;
            const result = parseAttendanceMessage(text, at, "Asia/Kolkata");
            assert.equal(
              result.reason,
              "Invalid time; review this message.",
              text,
            );
            assert.equal(result.time, undefined, text);
          }
});
test("Valid office-hour shorthand and explicit times keep their existing meaning", () => {
  for (const [text, time] of [
    ["In Time 10:50", "10:50"],
    ["In time 2:05", "14:05"],
    ["out Time 6:55", "18:55"],
    ["out time 7:59", "19:59"],
    ["Out time 8:00", "20:00"],
    ["IN 2.05", "14:05"],
    ["IN 09:00 AM", "09:00"],
    ["OUT 6:55 PM", "18:55"],
    ["OUT 18:55", "18:55"],
    ["OUT", "09:30"],
  ])
    assert.equal(
      parseAttendanceMessage(text, at, "Asia/Kolkata").time,
      time,
      text,
    );
});
test("Phone identities normalize device suffixes; LIDs remain distinct", () => {
  assert.equal(
    senderIdentity({ sender: "919999999999:3@s.whatsapp.net" }),
    "phone:919999999999",
  );
  assert.equal(
    senderIdentity({ sender: "919999999999@c.us" }),
    "phone:919999999999",
  );
  assert.equal(
    senderIdentity({ sender: "123456@lid", senderPhone: "123456" }),
    "lid:123456",
  );
  assert.equal(senderIdentity({ sender: "123@g.us" }), null);
});
