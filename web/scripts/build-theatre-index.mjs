// Build the bundled AMC theatre index used by the public /api/showtimes endpoint.
//   node --env-file=.env.local scripts/build-theatre-index.mjs
//
// Pages the whole AMC theatre catalogue (523 theatres / 6 pages as of Aug 2026) and writes a
// trimmed lib/theatre-index.json. Bundling it means theatre resolution — by id, name, city, zip
// or distance — costs zero AMC calls at request time and is fully deterministic.
//
// Re-run occasionally (theatres open/close rarely). The endpoint reports the file's generatedAt
// so staleness is visible rather than silent.
//
// Verified against the live API: /v2/theatres?page-size=100 pages via _links.next and returns
// location.latitude/longitude on LIST results, so no per-theatre detail fan-out is needed.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = process.env.AMC_VENDOR_KEY;
if (!KEY) {
  console.error("AMC_VENDOR_KEY required (run with --env-file=.env.local)");
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// AMC reports a display name ("EASTERN TIME"), not an IANA zone. We need IANA so request-time
// date math is DST-correct — the utcOffset AMC returns is only valid on the day it was fetched.
const ZONES = {
  "EASTERN TIME": "America/New_York",
  "CENTRAL TIME": "America/Chicago",
  "MOUNTAIN TIME": "America/Denver",
  "PACIFIC TIME": "America/Los_Angeles",
  "ARIZONA TIME": "America/Phoenix",
  ARIZONA: "America/Phoenix",
  "ALASKA TIME": "America/Anchorage",
  "HAWAII TIME": "Pacific/Honolulu",
  "ATLANTIC TIME": "America/Puerto_Rico",
};

// States whose real zone disagrees with AMC's coarse label. AMC calls Arizona "MOUNTAIN TIME",
// but Arizona doesn't observe DST — mapping it to America/Denver puts every Phoenix showtime an
// hour off from March to November. Hawaii is the same story against "PACIFIC TIME".
const STATE_ZONES = { AZ: "America/Phoenix", HI: "Pacific/Honolulu" };

/** The UTC offset an IANA zone was actually at on `when`, as "-07:00". */
function offsetAt(timeZone, when) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(when)
    .find((p) => p.type === "timeZoneName");
  const m = /GMT([+-]\d{2}:\d{2})/.exec(parts?.value ?? "");
  return m ? m[1] : "+00:00";
}

async function get(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA, "X-AMC-Vendor-Key": KEY },
  });
  if (!res.ok) throw new Error(`AMC ${res.status} for ${url}`);
  return res.json();
}

let url = "https://api.amctheatres.com/v2/theatres?page-size=100";
const raw = [];
let page = 0;
while (url) {
  const body = await get(url);
  const batch = body._embedded?.theatres ?? [];
  raw.push(...batch);
  page += 1;
  console.log(`page ${page}: +${batch.length} (total ${raw.length}${body.count ? ` of ${body.count}` : ""})`);
  url = body._links?.next?.href ?? null;
}

// Fail loudly on an unmapped timezone rather than guessing — a wrong zone means wrong showtimes.
const unknownZones = [...new Set(raw.map((t) => t.timezone).filter((z) => z && !ZONES[z]))];
if (unknownZones.length) {
  console.error(`Unmapped AMC timezone(s): ${unknownZones.join(", ")}\nAdd them to ZONES and re-run.`);
  process.exit(1);
}

const theatres = [];
const skipped = [];
for (const t of raw) {
  const loc = t.location ?? {};
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  // Without coordinates a theatre can't take part in distance search; keep it out of the index
  // rather than shipping an entry that silently never matches "near me".
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    skipped.push(`${t.id} ${t.name}`);
    continue;
  }
  theatres.push({
    id: t.id,
    name: t.name,
    slug: t.slug ?? "",
    city: loc.city ?? "",
    state: loc.state ?? "",
    zip: String(loc.postalCode ?? "").slice(0, 5), // AMC sometimes returns ZIP+4
    market: loc.marketName ?? "",
    lat,
    lng,
    tz: STATE_ZONES[loc.state] ?? ZONES[t.timezone] ?? "America/New_York",
    closed: !!t.isClosed,
    _amcOffset: t.utcOffset, // validation only, stripped below
  });
}
theatres.sort((a, b) => a.id - b.id);

// Cross-check every mapping against the offset AMC itself reported at fetch time. This is what
// catches a zone label that looks right but isn't (the Arizona/Denver case) — if the IANA zone
// we picked disagrees with AMC today, the mapping is wrong and showtimes would be off by an hour.
const now = new Date();
const mismatched = theatres.filter((t) => t._amcOffset && offsetAt(t.tz, now) !== t._amcOffset);
if (mismatched.length) {
  console.error(`\n${mismatched.length} theatre(s) whose IANA zone disagrees with AMC's reported offset:`);
  for (const t of mismatched.slice(0, 10)) {
    console.error(`  ${t.id} ${t.name} (${t.city}, ${t.state}) — mapped ${t.tz}=${offsetAt(t.tz, now)}, AMC says ${t._amcOffset}`);
  }
  console.error("Fix ZONES/STATE_ZONES and re-run.");
  process.exit(1);
}
for (const t of theatres) delete t._amcOffset;

const out = { generatedAt: new Date().toISOString(), count: theatres.length, theatres };
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "theatre-index.json");
writeFileSync(target, JSON.stringify(out), "utf8");

const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`\nWrote ${theatres.length} theatres to lib/theatre-index.json (${kb} KB)`);
console.log(`Closed: ${theatres.filter((t) => t.closed).length}  ·  Zones: ${new Set(theatres.map((t) => t.tz)).size}`);
if (skipped.length) console.log(`Skipped (no coordinates): ${skipped.length} — ${skipped.join(", ")}`);
