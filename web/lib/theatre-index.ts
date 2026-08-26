// Lookup over the bundled AMC theatre catalogue (lib/theatre-index.json, built by
// scripts/build-theatre-index.mjs). Pure — no network, no DB, no server-only.
//
// Bundling the catalogue means resolving a theatre by id, name, city, zip or distance costs zero
// AMC calls and is fully deterministic: the same query always yields the same theatres, and an
// ambiguous name can be reported as such instead of silently resolving to the first hit.

import index from "@/lib/theatre-index.json";

export type IndexedTheatre = {
  id: number;
  name: string;
  slug: string;
  city: string;
  state: string;
  zip: string;
  market: string;
  lat: number;
  lng: number;
  tz: string;
  closed: boolean;
};

export type ScoredTheatre = IndexedTheatre & { distanceMiles: number };

export type PlaceMatch = {
  matchedBy: "coords" | "zip" | "city" | "market" | "state";
  centre: { lat: number; lng: number };
  matched: IndexedTheatre[];
};

const THEATRES = index.theatres as IndexedTheatre[];
export const INDEX_GENERATED_AT: string = index.generatedAt;
export const THEATRE_COUNT: number = THEATRES.length;

export function allTheatres(): IndexedTheatre[] {
  return THEATRES;
}

/** Lowercase and drop everything but letters and digits, so "AMC Empire 25" == "amcempire25". */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Common metro nicknames people actually type. Only entries where the shorthand is unambiguous —
// anything genuinely ambiguous should reach the caller as ambiguous, not be guessed at here.
const PLACE_ALIASES: Record<string, string> = {
  nyc: "new york",
  manhattan: "new york",
  la: "los angeles",
  lax: "los angeles",
  sf: "san francisco",
  bayarea: "san francisco",
  philly: "philadelphia",
  vegas: "las vegas",
  dc: "washington",
  atl: "atlanta",
  chi: "chicago",
  nola: "new orleans",
  dfw: "dallas",
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", newhampshire: "NH", newjersey: "NJ",
  newmexico: "NM", newyork: "NY", northcarolina: "NC", northdakota: "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", rhodeisland: "RI", southcarolina: "SC",
  southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", westvirginia: "WV", wisconsin: "WI", wyoming: "WY",
  districtofcolumbia: "DC",
};

export function byId(id: number): IndexedTheatre | null {
  return THEATRES.find((t) => t.id === id) ?? null;
}

/** Exact slug or exact full-name match. Used before substring search so a precise name wins. */
export function byExact(query: string): IndexedTheatre | null {
  const q = normalize(query);
  return THEATRES.find((t) => normalize(t.slug) === q || normalize(t.name) === q) ?? null;
}

/** Every theatre whose name contains the query. Returns all matches — the caller decides what
 *  more than one means. Never ranks-and-picks. */
export function byName(query: string): IndexedTheatre[] {
  const q = normalize(query);
  if (!q) return [];
  return THEATRES.filter((t) => normalize(t.name).includes(q));
}

export function byZip(zip: string): IndexedTheatre[] {
  const z = zip.trim().slice(0, 5);
  return /^\d{5}$/.test(z) ? THEATRES.filter((t) => t.zip === z) : [];
}

export function byCity(query: string): IndexedTheatre[] {
  const q = normalize(query);
  if (!q) return [];
  return THEATRES.filter((t) => normalize(t.city) === q);
}

export function byMarket(query: string): IndexedTheatre[] {
  const q = normalize(query);
  if (!q) return [];
  // Markets look like "Dallas" or "Albany, GA" — match the leading segment too.
  return THEATRES.filter((t) => {
    const m = normalize(t.market);
    return m === q || m.startsWith(q);
  });
}

export function byState(query: string): IndexedTheatre[] {
  const q = normalize(query);
  const code = q.length === 2 ? q.toUpperCase() : STATE_NAMES[q];
  return code ? THEATRES.filter((t) => t.state === code) : [];
}

/** Great-circle distance in miles. */
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function centroid(list: IndexedTheatre[]): { lat: number; lng: number } {
  const lat = list.reduce((s, t) => s + t.lat, 0) / list.length;
  const lng = list.reduce((s, t) => s + t.lng, 0) / list.length;
  return { lat, lng };
}

function scoreAndSort(list: IndexedTheatre[], lat: number, lng: number): ScoredTheatre[] {
  return list
    .map((t) => ({ ...t, distanceMiles: Math.round(haversineMiles(lat, lng, t.lat, t.lng) * 10) / 10 }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/** Theatres within `radiusMiles`, nearest first, capped at `limit`. Empty when nothing is in
 *  range — deliberately does NOT fall back to "nearest anyway", so the caller can say so. */
export function near(lat: number, lng: number, radiusMiles: number, limit: number): ScoredTheatre[] {
  return scoreAndSort(THEATRES, lat, lng)
    .filter((t) => t.distanceMiles <= radiusMiles)
    .slice(0, limit);
}

/** Nearest `limit` of an already-matched set, ignoring radius. Used for state-wide matches, where
 *  a centroid-plus-radius would wrongly return nothing for a geographically large state. */
export function nearestFrom(
  list: IndexedTheatre[],
  lat: number,
  lng: number,
  limit: number,
): ScoredTheatre[] {
  return scoreAndSort(list, lat, lng).slice(0, limit);
}

/**
 * Turn a free-text place into a centre point plus the theatres that matched it — geocoding from
 * the index itself, so there's no third-party geocoder and no API key. Resolves anywhere AMC
 * actually operates, which is exactly the set of places this endpoint can answer for.
 * Returns null when nothing matches, so the caller reports "not found" instead of guessing.
 */
export function resolvePlace(query: string): PlaceMatch | null {
  const raw = query.trim();
  if (!raw) return null;

  const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { matchedBy: "coords", centre: { lat, lng }, matched: [] };
    }
  }

  const zipHits = byZip(raw);
  if (zipHits.length) return { matchedBy: "zip", centre: centroid(zipHits), matched: zipHits };

  const candidates = [raw, PLACE_ALIASES[normalize(raw)]].filter(Boolean) as string[];
  for (const q of candidates) {
    const city = byCity(q);
    if (city.length) return { matchedBy: "city", centre: centroid(city), matched: city };
    const market = byMarket(q);
    if (market.length) return { matchedBy: "market", centre: centroid(market), matched: market };
  }
  for (const q of candidates) {
    const state = byState(q);
    if (state.length) return { matchedBy: "state", centre: centroid(state), matched: state };
  }
  return null;
}
