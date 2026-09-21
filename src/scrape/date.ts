const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Mon, 28 Jul 2025" -> "2025-07-28". ISO text sorts correctly as a string. */
export function isoDate(text: string): string {
  const m = clean(text).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) throw new Error(`unparseable draw date: ${JSON.stringify(text)}`);
  const month = MONTHS.indexOf(m[2]!);
  if (month < 0) throw new Error(`unknown month: ${m[2]}`);
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/**
 * "2025-07-28" -> "Mon 28 Jul 2025", the inverse of isoDate for display.
 *
 * The tables above rather than Intl: ICU abbreviates September as "Sept" in
 * en-GB, which is not how the site writes it and not what isoDate round-trips.
 *
 * Read in UTC on purpose. A draw date is an SGT calendar date with no time
 * attached, so it parses as UTC midnight and has to be read back in the same
 * zone or the weekday slides a day.
 */
export function displayDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad ISO date: ${iso}`);
  return (
    `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ` +
    `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  );
}
