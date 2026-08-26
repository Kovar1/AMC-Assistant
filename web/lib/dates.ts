// Date helpers. AMC showDateTimeLocal is theatre-local (Eastern for the NJ theatres); we
// compute "today"/"now" in America/New_York so the board lines up with the showtimes.
const TZ = "America/New_York";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayET(): string {
  return todayInZone(TZ);
}

export function nowET(): string {
  return nowInZone(TZ);
}

// Zone-aware variants. The board is Eastern-only, but the public API serves all 523 AMC theatres
// across five zones, so "today" and "now" have to be evaluated in the theatre's own zone —
// otherwise a 9pm Eastern request hides the whole evening in California.

export function todayInZone(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
}

export function nowInZone(timeZone: string): string {
  return new Date().toLocaleString("sv-SE", { timeZone }).replace(" ", "T"); // YYYY-MM-DDTHH:MM:SS
}

export function nowUtc(): string {
  return new Date().toISOString();
}

/** Minutes from `from` to `to`, both "YYYY-MM-DDTHH:MM:SS" wall-clock strings in the same zone. */
export function minutesBetweenLocal(from: string, to: string): number {
  const parse = (s: string) => Date.parse(`${s.slice(0, 19)}Z`);
  return Math.round((parse(to) - parse(from)) / 60000);
}

/** "Tue Aug 26" — for labels the model can quote directly. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MON[m - 1]} ${d}`;
}

/**
 * The next date on or after `fromIso` falling on `weekday` (0=Sun..6=Sat). Today counts, so
 * asking for "tuesday" on a Tuesday means today, not a week out.
 */
export function nextWeekday(fromIso: string, weekday: number): string {
  const [y, m, d] = fromIso.slice(0, 10).split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(fromIso, (weekday - cur + 7) % 7);
}

/** "fri" / "friday" -> 5. Null when the token is not a weekday name. */
export function weekdayFromName(name: string): number | null {
  const n = name.trim().toLowerCase();
  const i = FULL.findIndex((f) => f.toLowerCase() === n);
  if (i >= 0) return i;
  const j = DOW.findIndex((d) => d.toLowerCase() === n);
  return j >= 0 ? j : null;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type Chip = { iso: string; dow: string; day: string };

export function chip(iso: string, index: number): Chip {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = index === 0 ? "Today" : index === 1 ? "Tom" : DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return { iso, dow, day: `${MON[m - 1]} ${d}` };
}

export function heading(iso: string, today: string): string {
  if (iso === today) return "Tonight";
  const [y, m, d] = iso.split("-").map(Number);
  return `${FULL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MON[m - 1]} ${d}`;
}
