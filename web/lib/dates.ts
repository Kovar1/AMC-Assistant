// Date helpers. AMC showDateTimeLocal is theatre-local (Eastern for the NJ theatres); we
// compute "today"/"now" in America/New_York so the board lines up with the showtimes.
const TZ = "America/New_York";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

export function nowET(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T"); // YYYY-MM-DDTHH:MM:SS
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
