const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Mon, 28 Jul 2025" -> "2025-07-28". ISO text sorts correctly as a string. */
export function isoDate(text: string): string {
  const m = clean(text).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) throw new Error(`unparseable draw date: ${JSON.stringify(text)}`);
  const month = MONTHS.indexOf(m[2]!);
  if (month < 0) throw new Error(`unknown month: ${m[2]}`);
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}
