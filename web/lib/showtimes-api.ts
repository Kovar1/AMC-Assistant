// Pure logic for the public GET /api/showtimes endpoint — no network, no DB, no server-only.
//
// The endpoint's job is to be quotable: an LLM reads the payload and reports it verbatim. So the
// rules here are stricter than a normal API's.
//   - Anything unknown is null, never a plausible-looking default.
//   - "Nothing is playing", "your filters removed everything", "that theatre is closed" and "the
//     AMC call failed" are four different statuses, each with a count that proves it.
//   - A theatre that did not resolve never appears in `theatres[]` at all; it goes in
//     `unresolvedInput[]`, so an empty result can never be misread as "nothing is on".
//   - Arithmetic the model would otherwise do itself (minutes until showtime, distance) is
//     computed here.

import { clock, fmt, FMT_FULL_LABEL, FORMAT_ORDER, type Format, type Showtime } from "@/lib/amc-logic";
import type { ShowtimesOutcome } from "@/lib/amc";
import type { IndexedTheatre } from "@/lib/theatre-index";
import { addDays, dayLabel, minutesBetweenLocal, nextWeekday, weekdayFromName } from "@/lib/dates";

export const MAX_THEATRES = 5;
export const MAX_DAYS = 7;
export const DEFAULT_RADIUS = 25;
export const MAX_RADIUS = 100;
export const DEFAULT_LIMIT = 3;
export const DEFAULT_MAX_PER_MOVIE = 12;
export const DEFAULT_MAX_SHOWTIMES = 400;

export type Selector =
  | { kind: "theatre"; tokens: string[] }
  | { kind: "place"; input: string; source: "near" | "city" | "zip"; radiusMiles: number; limit: number };

export type ParsedQuery = {
  selector: Selector;
  dateToken: string;
  days: number;
  afterToken: string | null; // null = "apply the default for this date range"
  beforeToken: string | null;
  formats: Format[];
  movie: string | null;
  view: "json" | "text";
  compact: boolean;
  maxPerMovie: number;
  maxShowtimes: number;
};

export type ParseResult =
  | { ok: true; query: ParsedQuery }
  | { ok: false; error: string; hint: string };

export type ResolvedTheatre = IndexedTheatre & {
  matchedInput: string;
  resolvedBy: "id" | "exact" | "name" | "near";
  distanceMiles: number | null;
};

export type UnresolvedInput = {
  input: string;
  status: "ambiguous" | "unresolved";
  message: string;
  candidates: { id: number; name: string; city: string; state: string }[];
};

export type ResolvedLocation = {
  input: string;
  matchedBy: string;
  centre: { lat: number; lng: number };
  radiusMiles: number | null;
};

export type BuildInput = {
  query: ParsedQuery;
  dates: string[];
  zone: string;
  generatedAt: string;
  generatedAtLabel: string;
  indexGeneratedAt: string;
  nowUtc: string;
  /** Wall-clock "now" in each resolved theatre's own zone, keyed by theatre id. */
  nowByTheatre: Map<number, string>;
  theatres: ResolvedTheatre[];
  unresolved: UnresolvedInput[];
  resolvedLocation: ResolvedLocation | null;
  outcomes: Map<number, ShowtimesOutcome>;
  warnings: string[];
};

/**
 * Full mode carries every field. Compact mode omits anything derivable, absent, or false — a busy
 * Manhattan theatre otherwise runs to tens of kilobytes, most of it repeated `false` and `null`.
 * Absence in compact mode means "not notable", never "unknown".
 */
export type ApiShowtime = {
  id: number;
  time: string;
  format: Format;
  bookable: boolean;
  iso?: string;
  startsInMinutes?: number | null;
  formatLabel?: string;
  auditorium?: number | string | null;
  soldOut?: boolean;
  almostSoldOut?: boolean;
  passed?: boolean;
  bookUrl?: string | null;
};

export type ApiMovie = {
  movieId: number;
  title: string;
  rating: string | null;
  runtimeMinutes: number | null;
  genre: string | null;
  movieUrl: string | null;
  showtimeCount: number;
  showtimesTruncated: boolean;
  showtimes: ApiShowtime[];
};

export type ApiDate = { date: string; dateLabel: string; movies: ApiMovie[] };

export type ApiTheatre = {
  id: number;
  name: string;
  city: string;
  state: string;
  timezone: string;
  distanceMiles: number | null;
  matchedInput: string;
  resolvedBy: string;
  status: "ok" | "no-showtimes" | "filtered-empty" | "closed" | "error";
  statusDetail: string;
  counts: { beforeFilters: number; returned: number; movies: number };
  dates: ApiDate[];
};

export type ShowtimesPayload = {
  ok: true;
  generatedAt: string;
  generatedAtLabel: string;
  source: string;
  indexGeneratedAt: string;
  disclaimer: string;
  query: Record<string, unknown>;
  resolvedLocation: ResolvedLocation | null;
  summary: {
    theatresRequested: number;
    theatresResolved: number;
    theatresAmbiguous: number;
    theatresUnresolved: number;
    movies: number;
    showtimes: number;
    truncated: boolean;
  };
  warnings: string[];
  theatres: ApiTheatre[];
  unresolvedInput: UnresolvedInput[];
};

const DISCLAIMER =
  "Every value here came from the AMC API at generatedAt. Nothing is inferred. null means unknown — do not guess it.";
const SOURCE = "AMC Theatres public API (api.amctheatres.com)";

// ---------------------------------------------------------------------------- query parsing

function fail(error: string, hint: string): ParseResult {
  return { ok: false, error, hint };
}

function intParam(
  sp: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | { bad: string } {
  const raw = sp.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { bad: `${name} must be an integer between ${min} and ${max} (got "${raw}")` };
  return n;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeToken(name: string, raw: string | null): string | null | { bad: string } {
  if (raw === null || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "none") return "none";
  if (v === "now" && name === "after") return "now";
  if (TIME_RE.test(v)) return v;
  return {
    bad: `${name} must be "HH:MM" (24-hour)${name === "after" ? `, "now"` : ""} or "none" (got "${raw}")`,
  };
}

/**
 * Syntactic parse only — no clock is read here, because "today" depends on the theatre's zone and
 * the theatre is not resolved yet. Date and time tokens are resolved later, once a zone is known.
 */
export function parseShowtimesQuery(sp: URLSearchParams): ParseResult {
  const theatreRaw = (sp.get("theatre") ?? sp.get("theater") ?? "").trim();
  const near = (sp.get("near") ?? "").trim();
  const city = (sp.get("city") ?? "").trim();
  const zip = (sp.get("zip") ?? "").trim();

  const selectors = [
    theatreRaw && "theatre",
    near && "near",
    city && "city",
    zip && "zip",
  ].filter(Boolean) as string[];

  if (selectors.length === 0) {
    return fail(
      "No theatre selected.",
      'Pass exactly one of: theatre=<id|name>, near=<place or "lat,lng">, city=<city>, zip=<5-digit zip>. Example: ?near=brooklyn&view=text',
    );
  }
  if (selectors.length > 1) {
    return fail(
      `Pass only one theatre selector; got ${selectors.join(" and ")}.`,
      "Use theatre= for specific theatres, or one of near=/city=/zip= to search by location.",
    );
  }

  let selector: Selector;
  const radius = intParam(sp, "radius", DEFAULT_RADIUS, 1, MAX_RADIUS);
  if (typeof radius === "object") return fail(radius.bad, `radius is in miles, 1-${MAX_RADIUS}.`);
  const limit = intParam(sp, "limit", DEFAULT_LIMIT, 1, MAX_THEATRES);
  if (typeof limit === "object") return fail(limit.bad, `limit caps how many theatres a location search returns (1-${MAX_THEATRES}).`);

  if (theatreRaw) {
    const tokens = theatreRaw.split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) return fail("theatre was empty.", "Example: ?theatre=2253 or ?theatre=2253,557");
    if (tokens.length > MAX_THEATRES) {
      return fail(
        `Too many theatres: ${tokens.length}. The limit is ${MAX_THEATRES}.`,
        "Each theatre costs a separate AMC lookup per day. Narrow the list or use a location search.",
      );
    }
    const tooLong = tokens.find((t) => t.length > 60);
    if (tooLong) return fail(`Theatre name too long: "${tooLong.slice(0, 30)}…".`, "Theatre tokens are capped at 60 characters.");
    selector = { kind: "theatre", tokens };
  } else {
    const input = near || city || zip;
    const source = near ? "near" : city ? "city" : "zip";
    if (input.length > 60) return fail(`${source} value is too long.`, "Location values are capped at 60 characters.");
    selector = { kind: "place", input, source, radiusMiles: radius, limit };
  }

  const days = intParam(sp, "days", 1, 1, MAX_DAYS);
  if (typeof days === "object") return fail(days.bad, `days covers a range starting at date; the maximum is ${MAX_DAYS}.`);

  const dateToken = (sp.get("date") ?? "today").trim().toLowerCase() || "today";

  const after = parseTimeToken("after", sp.get("after"));
  if (after !== null && typeof after === "object") return fail(after.bad, 'after filters out earlier showtimes. Use "now", "17:00", or "none".');
  const before = parseTimeToken("before", sp.get("before"));
  if (before !== null && typeof before === "object") return fail(before.bad, 'before filters out later showtimes. Use "22:30" or "none".');

  const afterToken = after as string | null;
  const beforeToken = before as string | null;
  if (afterToken && beforeToken && TIME_RE.test(afterToken) && TIME_RE.test(beforeToken) && beforeToken < afterToken) {
    return fail(`before (${beforeToken}) is earlier than after (${afterToken}), which can never match.`, "Widen the window or drop one of them.");
  }

  const formatRaw = (sp.get("format") ?? "").trim();
  const formats: Format[] = [];
  if (formatRaw) {
    for (const tok of formatRaw.split(",").map((t) => t.trim()).filter(Boolean)) {
      const up = tok.toUpperCase() as Format;
      // A silently ignored format would make the answer claim a filter that never ran.
      if (!FORMAT_ORDER.includes(up)) {
        return fail(`Unknown format "${tok}".`, `Valid formats: ${FORMAT_ORDER.join(", ")}.`);
      }
      if (!formats.includes(up)) formats.push(up);
    }
  }

  const movieRaw = (sp.get("movie") ?? "").trim();
  if (movieRaw.length > 60) return fail("movie filter is too long.", "The movie title filter is capped at 60 characters.");

  const viewRaw = (sp.get("view") ?? "json").trim().toLowerCase();
  if (viewRaw !== "json" && viewRaw !== "text") return fail(`Unknown view "${viewRaw}".`, 'Valid views: json, text.');

  const compactRaw = (sp.get("compact") ?? "").trim().toLowerCase();
  const compact = compactRaw === "1" || compactRaw === "true";

  const maxPerMovie = intParam(sp, "maxPerMovie", DEFAULT_MAX_PER_MOVIE, 1, 24);
  if (typeof maxPerMovie === "object") return fail(maxPerMovie.bad, "maxPerMovie caps showtimes listed per film.");
  const maxShowtimes = intParam(sp, "maxShowtimes", DEFAULT_MAX_SHOWTIMES, 1, 600);
  if (typeof maxShowtimes === "object") return fail(maxShowtimes.bad, "maxShowtimes caps the whole response.");

  return {
    ok: true,
    query: {
      selector,
      dateToken,
      days,
      afterToken,
      beforeToken,
      formats,
      movie: movieRaw || null,
      view: viewRaw,
      compact,
      maxPerMovie,
      maxShowtimes,
    },
  };
}

/** Default `after` to "now" only for a single-day range that is today — otherwise a 9pm request
 *  for tomorrow would hide every matinee. */
export function defaultAfter(dates: string[], today: string): "now" | "none" {
  return dates.length === 1 && dates[0] === today ? "now" : "none";
}

export type DateResult = { ok: true; dates: string[] } | { ok: false; error: string; hint: string };

/**
 * Resolve the date token against `today` in the relevant zone. Kept separate from parsing because
 * "today" is only meaningful once a theatre — and therefore a time zone — is known.
 */
export function resolveDates(dateToken: string, days: number, today: string): DateResult {
  let start: string;
  if (dateToken === "today") start = today;
  else if (dateToken === "tomorrow") start = addDays(today, 1);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) {
    const [y, m, d] = dateToken.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      return { ok: false, error: `"${dateToken}" is not a real calendar date.`, hint: "Use YYYY-MM-DD." };
    }
    start = dateToken;
  } else {
    const wd = weekdayFromName(dateToken);
    if (wd === null) {
      return {
        ok: false,
        error: `Unknown date "${dateToken}".`,
        hint: 'Use "today", "tomorrow", a weekday name like "friday", or YYYY-MM-DD.',
      };
    }
    start = nextWeekday(today, wd);
  }
  return { ok: true, dates: Array.from({ length: days }, (_, i) => addDays(start, i)) };
}

// ---------------------------------------------------------------------------- resolution

export type Resolution = {
  theatres: ResolvedTheatre[];
  unresolved: UnresolvedInput[];
  resolvedLocation: ResolvedLocation | null;
  warnings: string[];
};

const MAX_CANDIDATES = 8;

function candidates(list: IndexedTheatre[]) {
  return list.slice(0, MAX_CANDIDATES).map((t) => ({ id: t.id, name: t.name, city: t.city, state: t.state }));
}

/**
 * Turn the selector into concrete theatres, using only the bundled index — zero AMC calls, fully
 * deterministic. A name matching several theatres is reported as `ambiguous` and fetches nothing:
 * picking the first hit is exactly the silent wrong answer this endpoint exists to avoid.
 */
export function resolveTheatres(
  selector: Selector,
  idx: {
    byId: (id: number) => IndexedTheatre | null;
    byExact: (q: string) => IndexedTheatre | null;
    byName: (q: string) => IndexedTheatre[];
    resolvePlace: (q: string) => { matchedBy: string; centre: { lat: number; lng: number }; matched: IndexedTheatre[] } | null;
    near: (lat: number, lng: number, radius: number, limit: number) => (IndexedTheatre & { distanceMiles: number })[];
    nearestFrom: (list: IndexedTheatre[], lat: number, lng: number, limit: number) => (IndexedTheatre & { distanceMiles: number })[];
  },
): Resolution {
  const theatres: ResolvedTheatre[] = [];
  const unresolved: UnresolvedInput[] = [];
  const warnings: string[] = [];

  if (selector.kind === "theatre") {
    for (const token of selector.tokens) {
      if (/^\d+$/.test(token)) {
        const hit = idx.byId(Number(token));
        if (hit) theatres.push({ ...hit, matchedInput: token, resolvedBy: "id", distanceMiles: null });
        else
          unresolved.push({
            input: token,
            status: "unresolved",
            message: `AMC has no theatre with id ${token} in the bundled catalogue. No showtimes were fetched for it.`,
            candidates: [],
          });
        continue;
      }
      const exact = idx.byExact(token);
      if (exact) {
        theatres.push({ ...exact, matchedInput: token, resolvedBy: "exact", distanceMiles: null });
        continue;
      }
      const hits = idx.byName(token);
      if (hits.length === 1) {
        theatres.push({ ...hits[0], matchedInput: token, resolvedBy: "name", distanceMiles: null });
      } else if (hits.length > 1) {
        unresolved.push({
          input: token,
          status: "ambiguous",
          message: `${hits.length} AMC theatres match "${token}". No showtimes were fetched for it — ask the user which one they mean.`,
          candidates: candidates(hits),
        });
      } else {
        unresolved.push({
          input: token,
          status: "unresolved",
          message: `No AMC theatre name contains "${token}". No showtimes were fetched for it.`,
          candidates: [],
        });
      }
    }
  } else {
    const { input, radiusMiles, limit } = selector;
    const place = idx.resolvePlace(input);
    if (!place) {
      unresolved.push({
        input,
        status: "unresolved",
        message: `"${input}" did not match any AMC theatre, city, market, state or zip code. AMC may not operate there. No showtimes were fetched.`,
        candidates: [],
      });
      return { theatres, unresolved, resolvedLocation: null, warnings };
    }

    // A state centroid can sit far from every theatre, so a radius would wrongly return nothing.
    const useRadius = place.matchedBy !== "state";
    const found = useRadius
      ? idx.near(place.centre.lat, place.centre.lng, radiusMiles, limit)
      : idx.nearestFrom(place.matched, place.centre.lat, place.centre.lng, limit);

    if (found.length === 0) {
      unresolved.push({
        input,
        status: "unresolved",
        message: `"${input}" resolved (by ${place.matchedBy}), but no AMC theatre is within ${radiusMiles} miles of it. Try a larger radius.`,
        candidates: [],
      });
    }
    for (const t of found) {
      theatres.push({ ...t, matchedInput: input, resolvedBy: "near", distanceMiles: t.distanceMiles });
    }
    const zones = new Set(found.map((t) => t.tz));
    if (zones.size > 1) {
      warnings.push(
        `The matched theatres span more than one time zone (${[...zones].join(", ")}). Each theatre's showtimes are listed in its own local time.`,
      );
    }
    return {
      theatres: dedupe(theatres),
      unresolved,
      resolvedLocation: {
        input,
        matchedBy: place.matchedBy,
        centre: place.centre,
        radiusMiles: useRadius ? radiusMiles : null,
      },
      warnings,
    };
  }

  const deduped = dedupe(theatres);
  if (deduped.length < theatres.length) {
    warnings.push("Duplicate theatres in the request were collapsed into one.");
  }
  const zones = new Set(deduped.map((t) => t.tz));
  if (zones.size > 1) {
    warnings.push(
      `The requested theatres span more than one time zone (${[...zones].join(", ")}). Each theatre's showtimes are listed in its own local time.`,
    );
  }
  return { theatres: deduped, unresolved, resolvedLocation: null, warnings };
}

function dedupe(list: ResolvedTheatre[]): ResolvedTheatre[] {
  const seen = new Set<number>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

// ---------------------------------------------------------------------------- payload building

function threshold(token: string | null, nowLocal: string): string | null {
  if (!token || token === "none") return null;
  if (token === "now") return nowLocal.slice(11, 19);
  return `${token}:00`;
}

function buildTheatre(input: BuildInput, t: ResolvedTheatre, budget: { left: number }): ApiTheatre {
  const { query, dates } = input;
  const outcome = input.outcomes.get(t.id);
  const nowLocal = input.nowByTheatre.get(t.id) ?? input.generatedAt.slice(0, 19);
  const today = nowLocal.slice(0, 10);

  const base = {
    id: t.id,
    name: t.name,
    city: t.city,
    state: t.state,
    timezone: t.tz,
    distanceMiles: t.distanceMiles,
    matchedInput: t.matchedInput,
    resolvedBy: t.resolvedBy,
  };

  if (t.closed) {
    return {
      ...base,
      status: "closed",
      statusDetail: "AMC lists this theatre as closed. No showtimes were requested for it.",
      counts: { beforeFilters: 0, returned: 0, movies: 0 },
      dates: [],
    };
  }
  if (outcome && !outcome.ok) {
    return {
      ...base,
      status: "error",
      statusDetail: `ERROR: ${outcome.message}. No showtimes can be reported for it. Do not guess.`,
      counts: { beforeFilters: 0, returned: 0, movies: 0 },
      dates: [],
    };
  }

  const all = outcome?.ok ? outcome.showtimes : [];
  const afterAt = threshold(query.afterToken, nowLocal);
  const beforeAt = query.beforeToken && query.beforeToken !== "none" ? `${query.beforeToken}:00` : null;
  const movieNeedle = query.movie?.toLowerCase() ?? null;

  let beforeFilters = 0;
  let returned = 0;
  const movieIds = new Set<number>();
  const outDates: ApiDate[] = [];

  for (const date of dates) {
    const onDate = all.filter((s) => (s.showDateTimeLocal ?? "").startsWith(date) && !s.isCanceled);
    beforeFilters += onDate.length;

    const kept = onDate.filter((s) => {
      const local = s.showDateTimeLocal ?? "";
      if (local.length < 19) return false;
      const hhmmss = local.slice(11, 19);
      if (afterAt && hhmmss < afterAt) return false;
      if (beforeAt && hhmmss > beforeAt) return false;
      if (query.formats.length && !query.formats.includes(fmt(s))) return false;
      if (movieNeedle && !(s.movieName ?? "").toLowerCase().includes(movieNeedle)) return false;
      return true;
    });
    if (kept.length === 0) continue;

    const byMovie = new Map<number, Showtime[]>();
    for (const s of kept) {
      const list = byMovie.get(s.movieId) ?? [];
      list.push(s);
      byMovie.set(s.movieId, list);
    }

    // Sort key is kept beside the movie rather than read back off it: compact mode omits `iso`,
    // so the emitted shape is not always sortable.
    const ranked: { firstShow: string; movie: ApiMovie }[] = [];
    for (const [movieId, list] of byMovie) {
      list.sort((a, b) => (a.showDateTimeLocal ?? "").localeCompare(b.showDateTimeLocal ?? ""));
      const capped = list.slice(0, Math.min(query.maxPerMovie, Math.max(0, budget.left)));
      if (capped.length === 0) continue;
      budget.left -= capped.length;
      returned += capped.length;
      movieIds.add(movieId);

      const head = list[0];
      ranked.push({
        firstShow: capped[0].showDateTimeLocal ?? "",
        movie: {
          movieId,
          title: head.movieName ?? `Movie ${movieId}`,
          rating: head.mpaaRating || null,
          runtimeMinutes: typeof head.runTime === "number" ? head.runTime : null,
          genre: head.genre || null,
          movieUrl: head.movieUrl || null,
          showtimeCount: capped.length,
          showtimesTruncated: capped.length < list.length,
          showtimes: capped.map((s) => apiShowtime(s, nowLocal, today, input.nowUtc, query.compact)),
        },
      });
    }
    if (ranked.length === 0) continue;

    ranked.sort((a, b) => a.firstShow.localeCompare(b.firstShow));
    outDates.push({ date, dateLabel: dayLabel(date), movies: ranked.map((r) => r.movie) });
  }

  const status: ApiTheatre["status"] =
    returned > 0 ? "ok" : beforeFilters > 0 ? "filtered-empty" : "no-showtimes";

  const detail =
    status === "ok"
      ? `${beforeFilters} showtime(s) listed; ${returned} remain after your filters.`
      : status === "filtered-empty"
        ? `AMC listed ${beforeFilters} showtime(s) for this date, but your filters removed all of them.`
        : "AMC listed no showtimes for this theatre on the requested date(s).";

  return {
    ...base,
    status,
    statusDetail: detail,
    counts: { beforeFilters, returned, movies: movieIds.size },
    dates: outDates,
  };
}

function apiShowtime(
  s: Showtime,
  nowLocal: string,
  today: string,
  nowUtc: string,
  compact: boolean,
): ApiShowtime {
  const local = s.showDateTimeLocal ?? "";
  const passed = local < nowLocal;
  const sellClosed = !!s.sellUntilDateTimeUtc && nowUtc >= s.sellUntilDateTimeUtc;
  const bookable = !s.isSoldOut && !passed && !sellClosed && !!s.purchaseUrl;
  const format = fmt(s);
  // Only meaningful for today; a countdown to a show three days out invites bad arithmetic.
  const startsInMinutes = local.startsWith(today) ? minutesBetweenLocal(nowLocal, local) : null;

  const core = { id: s.id, time: clock(local), format, bookable };
  if (compact) {
    return {
      ...core,
      ...(startsInMinutes !== null && { startsInMinutes }),
      ...(s.isSoldOut && { soldOut: true }),
      ...(passed && { passed: true }),
    };
  }
  return {
    ...core,
    iso: local,
    startsInMinutes,
    formatLabel: FMT_FULL_LABEL[format],
    auditorium: s.auditorium ?? null,
    soldOut: !!s.isSoldOut,
    almostSoldOut: !!s.isAlmostSoldOut,
    passed,
    // No link at all when it can't be booked, so there is no dead URL available to quote.
    bookUrl: bookable ? (s.purchaseUrl ?? null) : null,
  };
}

export function buildShowtimesPayload(input: BuildInput): ShowtimesPayload {
  const budget = { left: input.query.maxShowtimes };
  const theatres = input.theatres.map((t) => buildTheatre(input, t, budget));

  const showtimes = theatres.reduce((n, t) => n + t.counts.returned, 0);
  const movies = new Set<number>();
  for (const t of theatres) for (const d of t.dates) for (const m of d.movies) movies.add(m.movieId);

  const truncated = budget.left <= 0 || theatres.some((t) => t.dates.some((d) => d.movies.some((m) => m.showtimesTruncated)));
  const warnings = [...input.warnings];
  if (truncated) {
    warnings.push(
      `The response hit its size cap (maxShowtimes=${input.query.maxShowtimes}, maxPerMovie=${input.query.maxPerMovie}), so some showtimes are not listed. Narrow the query with after=, format=, or movie= for a complete answer.`,
    );
  }

  const ambiguous = input.unresolved.filter((u) => u.status === "ambiguous").length;

  return {
    ok: true,
    generatedAt: input.generatedAt,
    generatedAtLabel: input.generatedAtLabel,
    source: SOURCE,
    indexGeneratedAt: input.indexGeneratedAt,
    disclaimer: DISCLAIMER,
    query: {
      selector: input.query.selector,
      dates: input.dates,
      dateLabels: input.dates.map(dayLabel),
      timezone: input.zone,
      after: input.query.afterToken ?? "none",
      // The concrete cutoff "now" stood for, so a reader never has to infer what time it means.
      afterResolved:
        input.query.afterToken === "now"
          ? input.generatedAt.slice(11, 16)
          : input.query.afterToken && input.query.afterToken !== "none"
            ? input.query.afterToken
            : null,
      before: input.query.beforeToken ?? "none",
      formats: input.query.formats,
      movie: input.query.movie,
      view: input.query.view,
      compact: input.query.compact,
      maxPerMovie: input.query.maxPerMovie,
      maxShowtimes: input.query.maxShowtimes,
    },
    resolvedLocation: input.resolvedLocation,
    summary: {
      theatresRequested:
        input.query.selector.kind === "theatre" ? input.query.selector.tokens.length : 1,
      theatresResolved: theatres.length,
      theatresAmbiguous: ambiguous,
      theatresUnresolved: input.unresolved.length - ambiguous,
      movies: movies.size,
      showtimes,
      truncated,
    },
    warnings,
    theatres,
    unresolvedInput: input.unresolved,
  };
}

// ---------------------------------------------------------------------------- text rendering

/** Compact, directly quotable rendering. Empty and error states are prose sentences, never codes,
 *  so a model reading this cannot turn "we don't know" into "there is nothing on". */
export function renderShowtimesText(p: ShowtimesPayload): string {
  const L: string[] = [];
  const q = p.query as {
    dateLabels: string[];
    timezone: string;
    after: string;
    afterResolved: string | null;
    before: string;
    formats: Format[];
  };

  L.push(`AMC SHOWTIMES — ${q.dateLabels.join(", ")}`);
  if (p.resolvedLocation) {
    const r = p.resolvedLocation;
    const scope = r.radiusMiles ? ` within ${r.radiusMiles} miles` : "";
    L.push(`Near "${r.input}" (matched by ${r.matchedBy}) · ${p.theatres.length} theatre(s)${scope} · times in ${q.timezone}`);
  } else {
    L.push(`${p.theatres.length} theatre(s) · times local to each theatre`);
  }
  L.push(`Data as of ${p.generatedAtLabel} · source: AMC Theatres API`);
  const filters: string[] = [];
  if (q.afterResolved) {
    filters.push(`start time at or after ${q.afterResolved}${q.after === "now" ? " (now)" : ""}`);
  } else {
    filters.push("all start times");
  }
  if (q.before && q.before !== "none") filters.push(`ending by ${q.before}`);
  filters.push(q.formats.length ? `formats: ${q.formats.join(", ")}` : "all formats");
  L.push(`Filters: ${filters.join(" · ")}`);

  for (const t of p.theatres) {
    const dist = t.distanceMiles === null ? "" : ` · ${t.distanceMiles} mi`;
    L.push("");
    L.push(`## ${t.name} — ${t.city}, ${t.state} (id ${t.id})${dist}`);
    if (t.status !== "ok") {
      L.push(`  ${t.statusDetail}`);
      continue;
    }
    for (const d of t.dates) {
      if (p.query.dates && (p.query.dates as string[]).length > 1) L.push(`  [${d.dateLabel}]`);
      for (const m of d.movies) {
        const meta = [m.rating, m.runtimeMinutes ? `${m.runtimeMinutes} min` : null].filter(Boolean).join(" · ");
        L.push(`- ${m.title}${meta ? ` — ${meta}` : ""}`);
        const times = m.showtimes.map((s) => {
          const tag = s.format === "STANDARD" ? "" : ` [${s.formatLabel ?? FMT_FULL_LABEL[s.format]}]`;
          const sold = s.soldOut ? " (SOLD OUT)" : s.passed ? " (started)" : "";
          return `${s.time}${tag}${sold}`;
        });
        L.push(`  ${times.join(" · ")}`);
        if (m.showtimesTruncated) L.push(`  (more showtimes exist than are listed here)`);
      }
    }
  }

  if (p.unresolvedInput.length) {
    L.push("");
    L.push("--- COULD NOT RESOLVE ---");
    for (const u of p.unresolvedInput) {
      L.push(`"${u.input}" — ${u.message}`);
      for (const c of u.candidates) L.push(`  ${c.id}  ${c.name} — ${c.city}, ${c.state}`);
    }
    if (p.unresolvedInput.some((u) => u.status === "ambiguous")) {
      L.push("Ask the user which one. Do not choose for them.");
    }
  }

  L.push("");
  L.push("--- NOTES ---");
  L.push(
    `${p.summary.showtimes} showtime(s) shown, from ${p.summary.movies} movie(s), across ${p.theatres.filter((t) => t.status === "ok").length} theatre(s) with listings.`,
  );
  for (const w of p.warnings) L.push(w);
  L.push("Booking links are omitted in text view. For links: add view=json (optionally &movie=<title>).");
  L.push(`Everything above is verbatim from the AMC API as of ${p.generatedAtLabel}. Nothing is inferred.`);
  return L.join("\n");
}
