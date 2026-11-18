// Database timestamps are UTC; display and day boundaries use the attendance zone.
export function utcInstant(value) {
  return new Date(
    /[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
}
export function localDate(value = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function dayBounds(date, timeZone) {
  const midnight = Date.parse(date + "T00:00:00Z");
  const boundary = (target) => {
    let low = target - 36 * 3600000,
      high = target + 36 * 3600000;
    const day = new Date(target).toISOString().slice(0, 10);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(new Date(mid), timeZone) < day) low = mid + 1;
      else high = mid;
    }
    return new Date(low).toISOString().slice(0, 23).replace("T", " ");
  };
  return [boundary(midnight), boundary(midnight + 86400000)];
}
