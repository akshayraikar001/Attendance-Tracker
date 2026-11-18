import test from "node:test";
import assert from "node:assert/strict";
import {
  dayBounds,
  parseAttendanceMessage,
  senderIdentity,
} from "../src/utils/whatsapp-parser.js";
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
test("Joined In/Out time labels accept case and spacing variations without matching unrelated words", () => {
  for (const [text, action, time] of [
    ["Intime 9.36", "in", "09:36"],
    ["  INTIME:9:36 AM  ", "in", "09:36"],
    ["inTime 2:05", "in", "14:05"],
    ["In   time 10:10", "in", "10:10"],
    ["Outtime 6.55", "out", "18:55"],
    ["OUTTIME:6:55 PM", "out", "18:55"],
    ["outTime = 19:00", "out", "19:00"],
    ["Out   time 7:15", "out", "19:15"],
    ["Clock-intime 09:36", "in", "09:36"],
    ["Check-outtime 6:55", "out", "18:55"],
  ])
    assert.deepEqual(
      parseAttendanceMessage(text, at, "Asia/Kolkata"),
      {
        action,
        date: "2026-10-05",
        time,
      },
      text,
    );
  for (const text of ["Intime 9:99", "Outtime 8:30", "Intime tomorrow"])
    assert.ok(parseAttendanceMessage(text, at, "Asia/Kolkata").reason, text);
  for (const text of [
    "Intimely response",
    "Incoming message",
    "Outside office",
    "Outtimekeeper",
    "Please send your Intime 9:36",
  ])
    assert.equal(parseAttendanceMessage(text, at, "Asia/Kolkata"), null, text);
});
test("IN and OUT accept spaced dots/colons and mixed case without weakening validation", () => {
  for (const [label, action] of [
    ["In time", "in"],
    ["iN TiMe", "in"],
    ["INTIME:", "in"],
    ["Out time", "out"],
    ["oUt TiMe", "out"],
    ["OUTTIME =", "out"],
  ]) {
    for (const separator of [".", ". ", " .", " . ", " : ", ".\t"]) {
      for (const [hour, minute, suffix, expected] of [
        ["9", "40", "", "09:40"],
        ["10", "25", "", "10:25"],
        ["6", "55", "", "18:55"],
        ["2", "05", "", "14:05"],
        ["09", "40", " aM", "09:40"],
        ["6", "55", "pM", "18:55"],
      ]) {
        const text = `  ${label}  ${hour}${separator}${minute}${suffix}  `;
        assert.deepEqual(
          parseAttendanceMessage(text, at, "Asia/Kolkata"),
          {
            action,
            date: "2026-10-05",
            time: expected,
          },
          text,
        );
      }
    }
    for (const clock of [
      "9. 60",
      "10 . 99",
      "25. 00",
      "8. 01",
      "9..40",
      "9.4",
      "9. 40 later",
      "9. 40 10.25",
    ]) {
      const result = parseAttendanceMessage(
        `${label} ${clock}`,
        at,
        "Asia/Kolkata",
      );
      assert.ok(result.reason, `${label} ${clock}`);
      assert.equal(result.time, undefined);
    }
  }
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

test("History participants recover missing senders without interpreting groups or LIDs as phones", () => {
  assert.equal(
    senderIdentity({
      sender: "123@g.us",
      participant: "919000000001@s.whatsapp.net",
    }),
    "phone:919000000001",
  );
  assert.equal(
    senderIdentity({ sender: "123@g.us", participant: "180281420083257@lid" }),
    "lid:180281420083257",
  );
  assert.equal(
    senderIdentity({
      key: { participant: "919000000001:3@s.whatsapp.net" },
      senderPhone: "9190000000013",
    }),
    "phone:919000000001",
  );
  assert.equal(
    senderIdentity({
      sender: "123:4@lid",
      participantAlt: "919000000001@s.whatsapp.net",
    }),
    "phone:919000000001",
  );
  assert.equal(senderIdentity({ sender: "123:4@lid" }), "lid:123");
  for (const sender of [
    "unresolved",
    "solved@lid",
    "123@g.us",
    "123@sXwhatsappYnet",
  ])
    assert.equal(senderIdentity({ sender, senderPhone: "919000000001" }), null);
});

test("hour-only IN/OUT and mentions retain office-time interpretation", () => {
  for (const [text, time] of [
    ["In time 10", "10:00"],
    ["OUT TIME 7", "19:00"],
    ["IN 9 am", "09:00"],
    ["OUT 8PM", "20:00"],
    ["@919999999999 In time 10 @all", "10:00"],
    ["@Bharat: out time 6", "18:00"],
  ])
    assert.equal(
      parseAttendanceMessage(text, at, "Asia/Kolkata").time,
      time,
      text,
    );
  for (const text of [
    "IN 25",
    "OUT 21",
    "IN 9.4",
    "IN 10 people",
    "IN 10 or 11",
  ])
    assert.ok(parseAttendanceMessage(text, at, "UTC").reason, text);
});

test("mention display removes address tokens without changing email or ordinary words", async () => {
  const { withoutMentions } = await import("../../shared/message-text.js");
  assert.equal(
    withoutMentions("@919999999999 @Bharat Leave Friday and Saturday"),
    "Leave Friday and Saturday",
  );
  assert.equal(
    withoutMentions("Email staff@example.com about leave"),
    "Email staff@example.com about leave",
  );
  assert.equal(withoutMentions("@123456789012345@lid IN 10"), "IN 10");
});

test("WhatsApp calendar boundaries include entire yesterday across daylight saving changes", () => {
  for (const [date, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ]) {
    const [start, end] = dayBounds(date, "America/New_York");
    assert.equal(end - start, hours * 3600);
    assert.equal(
      parseAttendanceMessage("IN", start, "America/New_York").date,
      date,
    );
    assert.equal(
      parseAttendanceMessage("OUT", end - 1, "America/New_York").date,
      date,
    );
    assert.notEqual(
      parseAttendanceMessage("IN", end, "America/New_York").date,
      date,
    );
  }
});
