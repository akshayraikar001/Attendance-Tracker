import { localMessageTime } from "./whatsapp-parser.js";

const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const monthPattern =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
export function validLeaveDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1000 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function date(year, month, day) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validLeaveDate(value) ? value : null;
}
export function leaveDates(from, to) {
  if (!validLeaveDate(from) || !validLeaveDate(to) || from > to)
    throw new Error("Choose a valid start and end date.");
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count > 366) throw new Error("Approve at most 366 days in one request.");
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
  );
}
export function parseLeaveMessage(text, timestamp, timeZone) {
  const normalized = text
    .toLowerCase()
    .replace(/sir(?=today|tom)/g, "sir ")
    .replace(/\b(?:tomorow|tommorow|tommorrow|tomorrow|tomorw|tommorw)\b/g, "tomorrow")
    .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/half[ -]?day/g, "half day");
  if (!/\bleave\b|\bhalf day\b/.test(normalized)) return null;
  const result = {
    kind: /\bhalf day\b/.test(normalized) ? "Half day" : "Absent",
    from: null,
    to: null,
    reason: "",
    tentative: /\b(?:may\s+(?:be|take|need)|might|maybe)\b/.test(normalized),
  };
  const review = (reason) => ({ ...result, from: null, to: null, reason });
  if (
    /\b(?:not|cancel|cancelled|canceled|cancelling|cancellation|withdraw|withdrawn)\b/.test(
      normalized,
    )
  )
    return review(
      "Possible cancellation or negation. Review the original message and choose dates manually.",
    );
  const base = localMessageTime(timestamp, timeZone).date;
  const [year, month] = base.split("-").map(Number);
  const finish = (from, to, reason = "") => {
    if (!from || !to)
      return review("Invalid or incomplete date. Choose dates manually.");
    try {
      leaveDates(from, to);
    } catch {
      return review("Invalid date range. Choose dates manually.");
    }
    return {
      ...result,
      from,
      to,
      reason: [
        reason,
        result.tentative ? "Tentative request: confirm before approving." : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  };
  const relatives =
    normalized.match(/\b(?:day after tomorrow|tomorrow|today|yesterday)\b/g) || [];
  const relativeDate = (word) => {
    const offset = { today: 0, tomorrow: 1, "day after tomorrow": 2, yesterday: -1 }[word];
    return new Date(Date.parse(base) + offset * 86400000).toISOString().slice(0, 10);
  };
  // Requests currently store one inclusive range. Never turn separate dates
  // into a range that would also approve unrequested days.
  const consecutive = (values, reason) => {
    if (values.some((value) => !value)) return review("Invalid date. Choose dates manually.");
    const days = [...new Set(values)].sort();
    if (days.some((value, i) => i && Date.parse(value) - Date.parse(days[i - 1]) !== 86400000))
      return review("Separate dates: review each requested date; do not include the days between them.");
    return finish(days[0], days.at(-1), reason);
  };
  const lists = [...normalized.matchAll(new RegExp(
    `\\b(\\d{1,2}(?:\\s*(?:,|&|\\band\\b)\\s*\\d{1,2})+)(?:\\s+(${monthPattern}))?(?:\\s+(\\d{4}))?\\b`,
    "g",
  ))];
  if (lists.length && !/\d[-/]\d/.test(normalized)) {
    const list = lists[0];
    const remainder = normalized.replace(list[0], "").replace(/\b(?:day after tomorrow|tomorrow|today|yesterday)\b/g, "");
    if (lists.length !== 1 || /\d|\b(?:except|excluding|to|until|till|through|next|yesterday|today|tomorrow)\b/.test(remainder))
      return review("Additional dates or exclusions: choose the intended dates manually.");
    const listMonth = list[2] ? months.indexOf(list[2].slice(0, 3)) + 1 : month;
    const values = list[1].match(/\d+/g).map((day) => date(+(list[3] || year), listMonth, +day));
    return consecutive([...relatives.map(relativeDate), ...values], "Listed dates use the message month/year when omitted. Confirm before approving.");
  }
  if (relatives.length) {
    const remainder = normalized.replace(/\b(?:day after tomorrow|tomorrow|today|yesterday)\b/g, "");
    if (/\d|\b(?:except|excluding|days|weeks|next)\b/.test(remainder))
      return review("Additional dates or duration: choose the intended dates manually.");
    const rangeWords = /\b(?:until|till|through|to)\b/.test(remainder);
    if (rangeWords) {
      if (relatives.length !== 2 || !/\b(?:yesterday|today|tomorrow|day after tomorrow)\s+(?:to|until|till|through)\s+(?:yesterday|today|tomorrow|day after tomorrow)\b/.test(normalized))
        return review("Incomplete relative range. Choose dates manually.");
      return finish(relativeDate(relatives[0]), relativeDate(relatives[1]), "Relative dates use the message date and selected timezone.");
    }
    return consecutive(relatives.map(relativeDate), "Relative dates use the WhatsApp message date and selected timezone.");
  }
  const iso = [...normalized.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(
    (m) => m[0],
  );
  const slash = [
    ...normalized.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g),
  ].map((m) => date(+m[3], +m[2], +m[1]));
  const absolute = iso.length ? iso : slash;
  if (absolute.length) {
    if (
      absolute.length > 2 ||
      (absolute.length === 2 &&
        !/\b(?:to|until|till|through)\b/.test(normalized))
    )
      return review("Multiple dates: confirm a continuous range manually.");
    return finish(absolute[0], absolute.at(-1));
  }
  const range = normalized.match(
    new RegExp(
      `\\b(\\d{1,2})(?:\\s+(${monthPattern}))?(?:\\s+(\\d{4}))?\\s*(?:to|until|till|through|-)\\s*(\\d{1,2})(?:\\s+(${monthPattern}))?(?:\\s+(\\d{4}))?\\b`,
    ),
  );
  if (range) {
    if (
      /\b(?:and|except|excluding)\b/.test(
        normalized.slice(normalized.indexOf(range[0]) + range[0].length),
      )
    )
      return review(
        "Additional dates or exclusions: choose the intended range manually.",
      );
    const startMonth = range[2]
      ? months.indexOf(range[2].slice(0, 3)) + 1
      : range[5]
        ? months.indexOf(range[5].slice(0, 3)) + 1
        : month;
    let endMonth = range[5]
      ? months.indexOf(range[5].slice(0, 3)) + 1
      : startMonth;
    const startYear = +(range[3] || range[6] || year);
    let endYear = +(range[6] || startYear);
    if (!range[5] && +range[4] < +range[1]) {
      endMonth++;
      if (endMonth === 13) {
        endMonth = 1;
        endYear++;
      }
    }
    if (range[2] && range[5] && endMonth < startMonth && !range[6]) endYear++;
    return finish(
      date(startYear, startMonth, +range[1]),
      date(endYear, endMonth, +range[4]),
      "Missing month/year uses the message date. Confirm the proposed dates.",
    );
  }
  const named = normalized.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`),
  );
  if (named) {
    const value = date(
      +(named[3] || year),
      months.indexOf(named[2].slice(0, 3)) + 1,
      +named[1],
    );
    if (
      /\b(?:and|except|excluding)\b/.test(
        normalized.slice(normalized.indexOf(named[0]) + named[0].length),
      )
    )
      return review("Multiple dates: select the intended range manually.");
    return finish(
      value,
      value,
      named[3]
        ? ""
        : "Year inferred from the message date; confirm before approval.",
    );
  }
  return review("Date is unclear. Choose the leave dates before approving.");
}
