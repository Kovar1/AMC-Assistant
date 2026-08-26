import { describe, it, expect, vi } from "vitest";
import type { Showtime } from "@/lib/amc-logic";
import type { ShowtimesOutcome } from "@/lib/amc";
import type { IndexedTheatre } from "@/lib/theatre-index";
import {
  buildShowtimesPayload,
  defaultAfter,
  parseShowtimesQuery,
  renderShowtimesText,
  resolveDates,
  resolveTheatres,
  type BuildInput,
  type ParsedQuery,
  type ResolvedTheatre,
  type Selector,
} from "@/lib/showtimes-api";

// ------------------------------------------------------------------ helpers

function parse(qs: string) {
  return parseShowtimesQuery(new URLSearchParams(qs));
}

function okQuery(qs: string): ParsedQuery {
  const r = parse(qs);
  if (!r.ok) throw new Error(`expected parse to succeed: ${r.error}`);
  return r.query;
}

const THEATRE_A: IndexedTheatre = {
  id: 100, name: "AMC Test Alpha 10", slug: "amc-test-alpha-10", city: "PARAMUS", state: "NJ",
  zip: "07652", market: "Paramus", lat: 40.9, lng: -74.07, tz: "America/New_York", closed: false,
};
const THEATRE_B: IndexedTheatre = {
  id: 200, name: "AMC Test Beta 20", slug: "amc-test-beta-20", city: "HACKENSACK", state: "NJ",
  zip: "07601", market: "Paramus", lat: 40.88, lng: -74.04, tz: "America/New_York", closed: false,
};
const THEATRE_CLOSED: IndexedTheatre = { ...THEATRE_A, id: 300, name: "AMC Test Gamma 30", closed: true };

function resolved(t: IndexedTheatre, extra: Partial<ResolvedTheatre> = {}): ResolvedTheatre {
  return { ...t, matchedInput: String(t.id), resolvedBy: "id", distanceMiles: null, ...extra };
}

let nextId = 1;
function show(local: string, over: Partial<Showtime> = {}): Showtime {
  return {
    id: nextId++,
    movieId: 900,
    movieName: "Test Movie",
    showDateTimeLocal: local,
    showDateTimeUtc: `${local}Z`,
    auditorium: 3,
    purchaseUrl: `https://www.amctheatres.com/showtimes/all/x/${nextId}`,
    runTime: 96,
    mpaaRating: "R",
    genre: "COMEDY",
    movieUrl: "https://www.amctheatres.com/movies/test-900",
    ...over,
  };
}

const DATE = "2026-08-26";
const NOW_LOCAL = "2026-08-26T19:00:00";
const NOW_UTC = "2026-08-26T23:00:00.000Z";

function build(over: Partial<BuildInput> = {}): ReturnType<typeof buildShowtimesPayload> {
  const theatres = over.theatres ?? [resolved(THEATRE_A)];
  const nowByTheatre = over.nowByTheatre ?? new Map(theatres.map((t) => [t.id, NOW_LOCAL]));
  return buildShowtimesPayload({
    query: over.query ?? okQuery("theatre=100"),
    dates: over.dates ?? [DATE],
    zone: "America/New_York",
    generatedAt: NOW_LOCAL,
    generatedAtLabel: "Wed Aug 26 · 7:00 PM",
    indexGeneratedAt: "2026-08-26T00:00:00.000Z",
    nowUtc: NOW_UTC,
    nowByTheatre,
    theatres,
    unresolved: over.unresolved ?? [],
    resolvedLocation: over.resolvedLocation ?? null,
    outcomes: over.outcomes ?? new Map<number, ShowtimesOutcome>([[100, { ok: true, showtimes: [] }]]),
    warnings: over.warnings ?? [],
    ...over,
  });
}

function outcome(id: number, showtimes: Showtime[]): Map<number, ShowtimesOutcome> {
  return new Map([[id, { ok: true, showtimes }]]);
}

/** All showtimes across the payload, flattened. */
function allShows(p: ReturnType<typeof buildShowtimesPayload>) {
  return p.theatres.flatMap((t) => t.dates.flatMap((d) => d.movies.flatMap((m) => m.showtimes)));
}

// ------------------------------------------------------------------ parsing

describe("parseShowtimesQuery — selectors", () => {
  it("rejects a request with no theatre selector, and says how to fix it", () => {
    const r = parse("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.hint).toMatch(/theatre=/);
    expect(r.hint).toMatch(/near=/);
  });

  it("rejects two selectors at once rather than silently preferring one", () => {
    const r = parse("theatre=100&near=brooklyn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only one/i);
  });

  it("accepts the American spelling as an alias", () => {
    const a = okQuery("theatre=100,200");
    const b = okQuery("theater=100,200");
    expect(b.selector).toEqual(a.selector);
  });

  it("splits and trims a theatre list", () => {
    expect(okQuery("theatre= 100 , 200 ").selector).toEqual({ kind: "theatre", tokens: ["100", "200"] });
  });

  it("rejects more than five theatres", () => {
    const r = parse("theatre=1,2,3,4,5,6");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many theatres/);
  });

  it("rejects an over-long token", () => {
    expect(parse(`theatre=${"x".repeat(61)}`).ok).toBe(false);
  });

  it("carries radius and limit onto a place selector", () => {
    const s = okQuery("near=brooklyn&radius=10&limit=2").selector as Extract<Selector, { kind: "place" }>;
    expect(s).toMatchObject({ kind: "place", input: "brooklyn", source: "near", radiusMiles: 10, limit: 2 });
  });

  it("defaults radius and limit", () => {
    const s = okQuery("city=chicago").selector as Extract<Selector, { kind: "place" }>;
    expect(s.radiusMiles).toBe(25);
    expect(s.limit).toBe(3);
  });

  it("rejects an out-of-range limit and radius", () => {
    expect(parse("near=x&limit=9").ok).toBe(false);
    expect(parse("near=x&radius=500").ok).toBe(false);
  });
});

describe("parseShowtimesQuery — filters", () => {
  it("rejects an unknown format instead of silently dropping it", () => {
    const r = parse("theatre=100&format=imax3d");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Unknown format/);
      expect(r.hint).toMatch(/IMAX/);
    }
  });

  it("accepts and upper-cases a valid format list, dropping duplicates", () => {
    expect(okQuery("theatre=100&format=imax,dolby,imax").formats).toEqual(["IMAX", "DOLBY"]);
  });

  it("accepts after as now, a time, or none", () => {
    expect(okQuery("theatre=100&after=now").afterToken).toBe("now");
    expect(okQuery("theatre=100&after=17:00").afterToken).toBe("17:00");
    expect(okQuery("theatre=100&after=none").afterToken).toBe("none");
  });

  it("leaves after null when absent, so the caller can apply the date-aware default", () => {
    expect(okQuery("theatre=100").afterToken).toBeNull();
  });

  it("rejects a malformed or out-of-range time", () => {
    expect(parse("theatre=100&after=7pm").ok).toBe(false);
    expect(parse("theatre=100&after=25:00").ok).toBe(false);
    expect(parse("theatre=100&before=noon").ok).toBe(false);
  });

  it("rejects before earlier than after, which could never match", () => {
    const r = parse("theatre=100&after=19:00&before=17:00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/never match/);
  });

  it("rejects an unknown view", () => {
    expect(parse("theatre=100&view=xml").ok).toBe(false);
  });

  it("rejects days beyond the cap and a non-integer", () => {
    expect(parse("theatre=100&days=8").ok).toBe(false);
    expect(parse("theatre=100&days=1.5").ok).toBe(false);
  });

  it("rejects an over-long movie filter", () => {
    expect(parse(`theatre=100&movie=${"x".repeat(61)}`).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ dates

describe("resolveDates", () => {
  const today = "2026-08-26"; // a Wednesday

  it("resolves today and tomorrow", () => {
    expect(resolveDates("today", 1, today)).toEqual({ ok: true, dates: [today] });
    expect(resolveDates("tomorrow", 1, today)).toEqual({ ok: true, dates: ["2026-08-27"] });
  });

  it("treats a weekday name as the next occurrence, counting today", () => {
    expect(resolveDates("friday", 1, today)).toEqual({ ok: true, dates: ["2026-08-28"] });
    expect(resolveDates("wed", 1, today)).toEqual({ ok: true, dates: [today] });
  });

  it("accepts an explicit ISO date", () => {
    expect(resolveDates("2026-12-25", 1, today)).toEqual({ ok: true, dates: ["2026-12-25"] });
  });

  it("expands a multi-day range", () => {
    const r = resolveDates("today", 3, today);
    expect(r).toEqual({ ok: true, dates: ["2026-08-26", "2026-08-27", "2026-08-28"] });
  });

  it("rejects a date that is not real", () => {
    const r = resolveDates("2026-02-30", 1, today);
    expect(r.ok).toBe(false);
  });

  it("rejects an unparseable token with guidance", () => {
    const r = resolveDates("someday", 1, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/YYYY-MM-DD/);
  });
});

describe("defaultAfter", () => {
  it("is now for a single-day request covering today", () => {
    expect(defaultAfter(["2026-08-26"], "2026-08-26")).toBe("now");
  });

  it("is none for a future date, so a late-evening request still shows matinees", () => {
    expect(defaultAfter(["2026-08-27"], "2026-08-26")).toBe("none");
  });

  it("is none for a multi-day range", () => {
    expect(defaultAfter(["2026-08-26", "2026-08-27"], "2026-08-26")).toBe("none");
  });
});

// ------------------------------------------------------------------ resolution

function idx(over: Partial<Parameters<typeof resolveTheatres>[1]> = {}) {
  return {
    byId: (id: number) => [THEATRE_A, THEATRE_B, THEATRE_CLOSED].find((t) => t.id === id) ?? null,
    byExact: () => null,
    byName: () => [],
    resolvePlace: () => null,
    near: () => [],
    nearestFrom: () => [],
    ...over,
  };
}

describe("resolveTheatres — by id and name", () => {
  it("resolves numeric ids", () => {
    const r = resolveTheatres({ kind: "theatre", tokens: ["100"] }, idx());
    expect(r.theatres.map((t) => t.id)).toEqual([100]);
    expect(r.theatres[0].resolvedBy).toBe("id");
    expect(r.unresolved).toEqual([]);
  });

  it("reports an unknown id as unresolved instead of dropping it silently", () => {
    const r = resolveTheatres({ kind: "theatre", tokens: ["99999999"] }, idx());
    expect(r.theatres).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].status).toBe("unresolved");
    expect(r.unresolved[0].message).toMatch(/no theatre with id/i);
  });

  it("prefers an exact name match over substring search", () => {
    const byExact = vi.fn(() => THEATRE_A);
    const byName = vi.fn(() => [THEATRE_A, THEATRE_B]);
    const r = resolveTheatres({ kind: "theatre", tokens: ["AMC Test Alpha 10"] }, idx({ byExact, byName }));
    expect(r.theatres[0].resolvedBy).toBe("exact");
    expect(byName).not.toHaveBeenCalled();
  });

  it("resolves a substring that matches exactly one theatre", () => {
    const r = resolveTheatres({ kind: "theatre", tokens: ["alpha"] }, idx({ byName: () => [THEATRE_A] }));
    expect(r.theatres.map((t) => t.id)).toEqual([100]);
    expect(r.theatres[0].resolvedBy).toBe("name");
  });

  it("reports an ambiguous name with candidates and resolves nothing", () => {
    const r = resolveTheatres({ kind: "theatre", tokens: ["test"] }, idx({ byName: () => [THEATRE_A, THEATRE_B] }));
    expect(r.theatres).toEqual([]);
    expect(r.unresolved[0].status).toBe("ambiguous");
    expect(r.unresolved[0].candidates.map((c) => c.id)).toEqual([100, 200]);
    expect(r.unresolved[0].message).toMatch(/ask the user/i);
  });

  it("caps the candidate list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...THEATRE_A, id: i + 1 }));
    const r = resolveTheatres({ kind: "theatre", tokens: ["x"] }, idx({ byName: () => many }));
    expect(r.unresolved[0].candidates).toHaveLength(8);
  });

  it("keeps a resolved theatre alongside an ambiguous one, in separate lists", () => {
    const byName = vi.fn((q: string) => (q === "amb" ? [THEATRE_A, THEATRE_B] : []));
    const r = resolveTheatres({ kind: "theatre", tokens: ["100", "amb"] }, idx({ byName }));
    expect(r.theatres.map((t) => t.id)).toEqual([100]);
    expect(r.unresolved.map((u) => u.input)).toEqual(["amb"]);
  });

  it("collapses a duplicate theatre and says so", () => {
    const r = resolveTheatres({ kind: "theatre", tokens: ["100", "100"] }, idx());
    expect(r.theatres).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/[Dd]uplicate/);
  });

  it("warns when requested theatres span time zones", () => {
    const west = { ...THEATRE_B, tz: "America/Los_Angeles" };
    const r = resolveTheatres(
      { kind: "theatre", tokens: ["100", "200"] },
      idx({ byId: (id: number) => (id === 100 ? THEATRE_A : west) }),
    );
    expect(r.warnings.join(" ")).toMatch(/time zone/i);
  });
});

describe("resolveTheatres — by place", () => {
  const place = { kind: "place" as const, input: "paramus", source: "city" as const, radiusMiles: 25, limit: 3 };

  it("resolves nearby theatres with distances", () => {
    const r = resolveTheatres(place, idx({
      resolvePlace: () => ({ matchedBy: "city", centre: { lat: 40.9, lng: -74.07 }, matched: [THEATRE_A] }),
      near: () => [{ ...THEATRE_A, distanceMiles: 0 }, { ...THEATRE_B, distanceMiles: 2.4 }],
    }));
    expect(r.theatres.map((t) => t.distanceMiles)).toEqual([0, 2.4]);
    expect(r.resolvedLocation).toMatchObject({ input: "paramus", matchedBy: "city", radiusMiles: 25 });
  });

  it("reports a place with no AMC presence rather than guessing", () => {
    const r = resolveTheatres({ ...place, input: "nowhereville" }, idx());
    expect(r.theatres).toEqual([]);
    expect(r.unresolved[0].message).toMatch(/did not match any AMC/i);
    expect(r.resolvedLocation).toBeNull();
  });

  it("says the radius when a place resolves but nothing is close enough", () => {
    const r = resolveTheatres(place, idx({
      resolvePlace: () => ({ matchedBy: "city", centre: { lat: 0, lng: 0 }, matched: [] }),
      near: () => [],
    }));
    expect(r.theatres).toEqual([]);
    expect(r.unresolved[0].message).toMatch(/within 25 miles/);
    expect(r.unresolved[0].message).toMatch(/larger radius/);
  });

  it("ignores radius for a state match, so a large state still returns theatres", () => {
    const near = vi.fn(() => []);
    const nearestFrom = vi.fn(() => [{ ...THEATRE_A, distanceMiles: 30 }]);
    const r = resolveTheatres(place, idx({
      resolvePlace: () => ({ matchedBy: "state", centre: { lat: 40, lng: -74 }, matched: [THEATRE_A] }),
      near,
      nearestFrom,
    }));
    expect(near).not.toHaveBeenCalled();
    expect(nearestFrom).toHaveBeenCalled();
    expect(r.theatres).toHaveLength(1);
    expect(r.resolvedLocation?.radiusMiles).toBeNull();
  });
});

// ------------------------------------------------------------------ filtering

describe("after / before filtering", () => {
  const q = (qs: string) => okQuery(`theatre=100&${qs}`);

  it("includes a showtime exactly at the boundary", () => {
    const p = build({
      query: q("after=19:00"),
      outcomes: outcome(100, [show(`${DATE}T19:00:00`)]),
    });
    expect(allShows(p)).toHaveLength(1);
  });

  it("excludes a showtime one second before the boundary", () => {
    const p = build({
      query: q("after=19:00"),
      outcomes: outcome(100, [show(`${DATE}T18:59:59`)]),
    });
    expect(allShows(p)).toHaveLength(0);
    expect(p.theatres[0].status).toBe("filtered-empty");
  });

  it("uses the theatre's own local now for after=now", () => {
    const p = build({
      query: q("after=now"),
      outcomes: outcome(100, [show(`${DATE}T18:00:00`), show(`${DATE}T20:00:00`)]),
    });
    expect(allShows(p).map((s) => s.time)).toEqual(["8:00 PM"]);
  });

  it("keeps past showtimes with after=none, flagged as passed and unbookable", () => {
    const p = build({
      query: q("after=none"),
      outcomes: outcome(100, [show(`${DATE}T14:00:00`)]),
    });
    const s = allShows(p)[0];
    expect(s.passed).toBe(true);
    expect(s.bookable).toBe(false);
    expect(s.bookUrl).toBeNull();
  });

  it("applies before as an inclusive upper bound", () => {
    const p = build({
      query: q("after=none&before=20:00"),
      outcomes: outcome(100, [show(`${DATE}T20:00:00`), show(`${DATE}T20:00:01`)]),
    });
    expect(allShows(p)).toHaveLength(1);
  });

  it("filters by format", () => {
    const p = build({
      query: q("after=none&format=IMAX"),
      outcomes: outcome(100, [
        show(`${DATE}T20:00:00`, { attributes: [{ code: "IMAX" }] }),
        show(`${DATE}T21:00:00`),
      ]),
    });
    expect(allShows(p).map((s) => s.format)).toEqual(["IMAX"]);
  });

  it("filters by movie title, case-insensitively", () => {
    const p = build({
      query: q("after=none&movie=dune"),
      outcomes: outcome(100, [
        show(`${DATE}T20:00:00`, { movieId: 1, movieName: "Dune Part Three" }),
        show(`${DATE}T21:00:00`, { movieId: 2, movieName: "Other Film" }),
      ]),
    });
    expect(allShows(p)).toHaveLength(1);
  });

  it("drops canceled showtimes and does not count them as available", () => {
    const p = build({
      query: q("after=none"),
      outcomes: outcome(100, [show(`${DATE}T20:00:00`, { isCanceled: true })]),
    });
    expect(allShows(p)).toHaveLength(0);
    expect(p.theatres[0].counts.beforeFilters).toBe(0);
    expect(p.theatres[0].status).toBe("no-showtimes");
  });
});

describe("computed showtime fields", () => {
  it("computes startsInMinutes for today so the model never does the arithmetic", () => {
    const p = build({
      query: okQuery("theatre=100&after=none"),
      outcomes: outcome(100, [show(`${DATE}T19:11:00`)]),
    });
    expect(allShows(p)[0].startsInMinutes).toBe(11);
  });

  it("leaves startsInMinutes null for a date that is not today", () => {
    const p = build({
      query: okQuery("theatre=100&after=none"),
      dates: ["2026-08-28"],
      outcomes: outcome(100, [show("2026-08-28T19:00:00")]),
    });
    expect(allShows(p)[0].startsInMinutes).toBeNull();
  });

  it("marks a sold-out show unbookable and withholds its link", () => {
    const p = build({
      query: okQuery("theatre=100&after=none"),
      outcomes: outcome(100, [show(`${DATE}T20:00:00`, { isSoldOut: true })]),
    });
    const s = allShows(p)[0];
    expect(s.soldOut).toBe(true);
    expect(s.bookable).toBe(false);
    expect(s.bookUrl).toBeNull();
  });

  it("withholds the link once online sales have closed", () => {
    const p = build({
      query: okQuery("theatre=100&after=none"),
      outcomes: outcome(100, [show(`${DATE}T20:00:00`, { sellUntilDateTimeUtc: "2026-08-26T22:00:00Z" })]),
    });
    expect(allShows(p)[0].bookable).toBe(false);
  });

  it("gives a bookable future show a real link", () => {
    const p = build({ outcomes: outcome(100, [show(`${DATE}T20:00:00`)]) });
    const s = allShows(p)[0];
    expect(s.bookable).toBe(true);
    expect(s.bookUrl).toMatch(/^https:\/\/www\.amctheatres\.com\//);
  });

  it("strips compact mode down to the fields that carry information", () => {
    const p = build({
      query: okQuery("theatre=100&compact=1"),
      outcomes: outcome(100, [show(`${DATE}T20:00:00`)]),
    });
    const s = allShows(p)[0];
    // Present: what you cannot derive.
    expect(s).toMatchObject({ time: "8:00 PM", format: "STANDARD", bookable: true });
    expect(s.startsInMinutes).toBe(60);
    // Absent: derivable, or false and therefore not notable.
    expect(s).not.toHaveProperty("bookUrl");
    expect(s).not.toHaveProperty("iso");
    expect(s).not.toHaveProperty("formatLabel");
    expect(s).not.toHaveProperty("auditorium");
    expect(s).not.toHaveProperty("soldOut");
    expect(s).not.toHaveProperty("passed");
  });

  it("keeps sold-out and passed flags in compact mode, since those change the answer", () => {
    const p = build({
      query: okQuery("theatre=100&compact=1&after=none"),
      outcomes: outcome(100, [
        show(`${DATE}T20:00:00`, { isSoldOut: true }),
        show(`${DATE}T14:00:00`),
      ]),
    });
    const shows = allShows(p);
    expect(shows.find((s) => s.time === "8:00 PM")).toMatchObject({ soldOut: true, bookable: false });
    expect(shows.find((s) => s.time === "2:00 PM")).toMatchObject({ passed: true, bookable: false });
  });

  it("keeps every field in full mode", () => {
    const s = allShows(build({ outcomes: outcome(100, [show(`${DATE}T20:00:00`)]) }))[0];
    expect(s.iso).toBe(`${DATE}T20:00:00`);
    expect(s.formatLabel).toBeTruthy();
    expect(s.auditorium).toBe(3);
    expect(s.bookUrl).toMatch(/^https:/);
  });

  it("reports unknown metadata as null rather than inventing it", () => {
    const p = build({
      outcomes: outcome(100, [
        show(`${DATE}T20:00:00`, { runTime: undefined, mpaaRating: "", genre: undefined, movieUrl: "" }),
      ]),
    });
    const m = p.theatres[0].dates[0].movies[0];
    expect(m.runtimeMinutes).toBeNull();
    expect(m.rating).toBeNull();
    expect(m.genre).toBeNull();
    expect(m.movieUrl).toBeNull();
  });
});

// ------------------------------------------------------------------ empty states

describe("empty-state discrimination", () => {
  it("distinguishes no-showtimes from filtered-empty by the counts that prove it", () => {
    const none = build({ outcomes: outcome(100, []) });
    expect(none.theatres[0].status).toBe("no-showtimes");
    expect(none.theatres[0].counts.beforeFilters).toBe(0);

    const filtered = build({
      query: okQuery("theatre=100&after=23:00"),
      outcomes: outcome(100, [show(`${DATE}T14:00:00`), show(`${DATE}T17:00:00`)]),
    });
    expect(filtered.theatres[0].status).toBe("filtered-empty");
    expect(filtered.theatres[0].counts.beforeFilters).toBe(2);
    expect(filtered.theatres[0].counts.returned).toBe(0);
    expect(filtered.theatres[0].statusDetail).toMatch(/removed all of them/);
  });

  it("reports an AMC failure as error, never as no-showtimes", () => {
    const p = build({
      outcomes: new Map<number, ShowtimesOutcome>([
        [100, { ok: false, status: 503, message: "the AMC API returned 503 for this theatre" }],
      ]),
    });
    expect(p.theatres[0].status).toBe("error");
    expect(p.theatres[0].statusDetail).toMatch(/503/);
    expect(p.theatres[0].statusDetail).toMatch(/Do not guess/);
  });

  it("reports a closed theatre as closed", () => {
    const p = build({
      theatres: [resolved(THEATRE_CLOSED)],
      outcomes: outcome(300, []),
    });
    expect(p.theatres[0].status).toBe("closed");
  });

  it("never lists an unresolved input among the theatres", () => {
    const p = build({
      theatres: [],
      outcomes: new Map(),
      unresolved: [{ input: "plaza", status: "ambiguous", message: "8 match", candidates: [] }],
    });
    expect(p.theatres).toEqual([]);
    expect(p.summary.theatresResolved).toBe(0);
    expect(p.summary.theatresAmbiguous).toBe(1);
    expect(p.unresolvedInput).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ caps

describe("caps", () => {
  it("truncates per movie and flags it", () => {
    const shows = Array.from({ length: 20 }, (_, i) => show(`${DATE}T${String(10 + i % 12).padStart(2, "0")}:00:00`));
    const p = build({ query: okQuery("theatre=100&after=none&maxPerMovie=5"), outcomes: outcome(100, shows) });
    const m = p.theatres[0].dates[0].movies[0];
    expect(m.showtimes).toHaveLength(5);
    expect(m.showtimesTruncated).toBe(true);
    expect(p.summary.truncated).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/size cap/);
  });

  it("enforces the global cap across movies", () => {
    const shows = [
      ...Array.from({ length: 5 }, () => show(`${DATE}T20:00:00`, { movieId: 1, movieName: "A" })),
      ...Array.from({ length: 5 }, () => show(`${DATE}T21:00:00`, { movieId: 2, movieName: "B" })),
    ];
    const p = build({ query: okQuery("theatre=100&after=none&maxShowtimes=6"), outcomes: outcome(100, shows) });
    expect(p.summary.showtimes).toBeLessThanOrEqual(6);
    expect(p.summary.truncated).toBe(true);
  });

  it("does not flag truncation when everything fits", () => {
    const p = build({ outcomes: outcome(100, [show(`${DATE}T20:00:00`)]) });
    expect(p.summary.truncated).toBe(false);
    expect(p.warnings).toEqual([]);
  });
});

// ------------------------------------------------------------------ summary + text

describe("summary", () => {
  it("counts movies and showtimes across theatres", () => {
    const p = build({
      query: okQuery("theatre=100,200&after=none"),
      theatres: [resolved(THEATRE_A), resolved(THEATRE_B)],
      nowByTheatre: new Map([[100, NOW_LOCAL], [200, NOW_LOCAL]]),
      outcomes: new Map<number, ShowtimesOutcome>([
        [100, { ok: true, showtimes: [show(`${DATE}T20:00:00`, { movieId: 1, movieName: "A" })] }],
        [200, { ok: true, showtimes: [show(`${DATE}T21:00:00`, { movieId: 1, movieName: "A" }), show(`${DATE}T22:00:00`, { movieId: 2, movieName: "B" })] }],
      ]),
    });
    expect(p.summary.theatresResolved).toBe(2);
    expect(p.summary.showtimes).toBe(3);
    expect(p.summary.movies).toBe(2); // movie 1 counted once across both theatres
  });

  it("echoes the effective query, not the raw one", () => {
    const p = build({ query: okQuery("theatre=100&after=17:00&format=IMAX") });
    expect(p.query).toMatchObject({ after: "17:00", formats: ["IMAX"] });
    expect(p.disclaimer).toMatch(/Nothing is inferred/);
    expect(p.source).toMatch(/amctheatres\.com/);
  });
});

describe("renderShowtimesText", () => {
  const rich = () =>
    build({
      query: okQuery("theatre=100,200&after=none"),
      theatres: [resolved(THEATRE_A), resolved(THEATRE_B, { matchedInput: "200" })],
      nowByTheatre: new Map([[100, NOW_LOCAL], [200, NOW_LOCAL]]),
      unresolved: [
        {
          input: "plaza",
          status: "ambiguous",
          message: '2 AMC theatres match "plaza". No showtimes were fetched for it — ask the user which one they mean.',
          candidates: [{ id: 100, name: "AMC Test Alpha 10", city: "PARAMUS", state: "NJ" }],
        },
      ],
      outcomes: new Map<number, ShowtimesOutcome>([
        [100, { ok: true, showtimes: [show(`${DATE}T20:00:00`), show(`${DATE}T22:30:00`, { isSoldOut: true })] }],
        [200, { ok: false, status: 503, message: "the AMC API returned 503 for this theatre" }],
      ]),
    });

  it("leads with the date and the data freshness", () => {
    const text = renderShowtimesText(rich());
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^AMC SHOWTIMES — Wed Aug 26/);
    expect(text).toMatch(/Data as of Wed Aug 26 · 7:00 PM/);
  });

  it("never emits a booking URL, so the text view cannot leak a stale link", () => {
    expect(renderShowtimesText(rich())).not.toMatch(/https?:\/\//);
  });

  it("renders the error theatre as prose that forbids guessing", () => {
    const text = renderShowtimesText(rich());
    expect(text).toMatch(/ERROR: the AMC API returned 503/);
    expect(text).toMatch(/Do not guess/);
  });

  it("surfaces ambiguity with candidates and an instruction to ask", () => {
    const text = renderShowtimesText(rich());
    expect(text).toMatch(/COULD NOT RESOLVE/);
    expect(text).toMatch(/100 {2}AMC Test Alpha 10 — PARAMUS, NJ/);
    expect(text).toMatch(/Ask the user which one\. Do not choose for them\./);
  });

  it("marks sold-out showtimes inline", () => {
    expect(renderShowtimesText(rich())).toMatch(/10:30 PM \(SOLD OUT\)/);
  });

  it("closes with a provenance line", () => {
    const last = renderShowtimesText(rich()).split("\n").at(-1)!;
    expect(last).toMatch(/verbatim from the AMC API as of/);
    expect(last).toMatch(/Nothing is inferred\./);
  });

  it("states an empty result plainly rather than leaving a bare heading", () => {
    const text = renderShowtimesText(build({ outcomes: outcome(100, []) }));
    expect(text).toMatch(/AMC listed no showtimes/);
  });
});

describe("after cutoff is stated concretely, never left as the word 'now'", () => {
  it("resolves now to a wall-clock time in the query echo", () => {
    const p = build({ query: okQuery("theatre=100&after=now") });
    expect(p.query.afterResolved).toBe("19:00");
  });

  it("echoes an explicit time unchanged", () => {
    expect(build({ query: okQuery("theatre=100&after=17:00") }).query.afterResolved).toBe("17:00");
  });

  it("is null when no cutoff applies", () => {
    expect(build({ query: okQuery("theatre=100&after=none") }).query.afterResolved).toBeNull();
  });

  it("prints the concrete time in the text view", () => {
    const text = renderShowtimesText(build({ query: okQuery("theatre=100&after=now") }));
    expect(text).toMatch(/start time at or after 19:00 \(now\)/);
    expect(text).not.toMatch(/at or after now/);
  });

  it("names a before cutoff too", () => {
    const text = renderShowtimesText(build({ query: okQuery("theatre=100&after=none&before=22:00") }));
    expect(text).toMatch(/ending by 22:00/);
  });
});
