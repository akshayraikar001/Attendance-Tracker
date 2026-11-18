// Store one international number, independent of presentation punctuation.
export function normalizePhone(value) {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const compact = raw.replace(/[ ()-]/g, "");
  if (
    !/^\+?[1-9]\d{7,14}$/.test(compact) ||
    (!compact.startsWith("+") && compact.length <= 10)
  ) {
    throw new Error(
      "Include the country code, for example +919999999999 for an Indian number.",
    );
  }
  return "+" + compact.replace(/^\+/, "");
}
