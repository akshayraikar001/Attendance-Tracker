export const today = () => new Date().toLocaleDateString("en-CA");
export const fmt = (n) =>
  n == null ? "—" : `${Math.floor(n / 60)}h ${n % 60}m`;
export const shortDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const initials = (n) =>
  n
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
