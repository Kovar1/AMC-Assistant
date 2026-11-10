import { describe, expect, it } from "vitest";
import {
  buildBoard,
  buildDigest,
  buildMovieDetail,
  buildWatch,
  buildCatalog,
  fmt,
  isRerelease,
  matches,
  posterUrl,
  relevanceScore,
  showRow,
  todaysLineup,
  type Digest,
  type Lineup,
  type LineupSeen,
  type Movie,
  type Prefs,
  type Showtime,
  type Theatre,
} from "./amc-logic";

function show(over: Partial<Showtime> = {}): Showtime {
  return {
    id: over.id ?? 999,
    movieId: over.movieId ?? 1,
    movieName: over.movieName ?? "Movie",
    showDateTimeLocal: over.showDateTimeLocal ?? "2030-01-01T19:00:00", // Tuesday
    attributes: over.attributes ?? [],
    auditorium: 1,
    purchaseUrl: "https://amc/book",
    ...over,
  };
}

function prefs(over: Partial<Prefs> = {}): Prefs {
  return {
    theatres: over.theatres ?? [{ id: 2253, name: "GSP" }],
    formats: over.formats ?? [],
    earliestHour: over.earliestHour ?? 18,
    weekendsOnly: over.weekendsOnly ?? false,
    partySize: 2,
    lookaheadDays: 7,
    onboarded: true,
  };
}

const movie = (over: Partial<Movie>): Movie => ({ id: 1, name: "M", ...over });

describe("fmt", () => {
  it("detects each format", () => {
    expect(fmt(show({ attributes: [{ code: "IMAX" }] }))).toBe("IMAX");
    expect(fmt(show({ attributes: [{ code: "IMAXWITHLASERATAMC" }] }))).toBe("IMAX");
    expect(fmt(show({ attributes: [{ code: "DOLBYCINEMAATAMCPRIME" }] }))).toBe("DOLBY");
    expect(fmt(show({ attributes: [{ code: "XL" }] }))).toBe("XL");
    expect(fmt(show({ attributes: [{ code: "LASERATAMC" }] }))).toBe("LASER");
    expect(fmt(show({ attributes: [] }))).toBe("STANDARD");
    expect(fmt(show({ attributes: [{ code: "CLOSEDCAPTION" }] }))).toBe("STANDARD");
  });
});

describe("matches", () => {
  it("format, time, and cancel", () => {
    const p = prefs();
    expect(matches(show({ attributes: [{ code: "IMAX" }], showDateTimeLocal: "2030-01-01T19:00:00" }), p)).toBe(true);
    expect(matches(show({ showDateTimeLocal: "2030-01-01T17:00:00" }), p)).toBe(false); // before earliest
    expect(matches(show({ isCanceled: true }), p)).toBe(false);
    const pf = prefs({ formats: ["IMAX"] });
    expect(matches(show({ attributes: [{ code: "IMAX" }] }), pf)).toBe(true);
    expect(matches(show({ attributes: [{ code: "LASERATAMC" }] }), pf)).toBe(false);
  });

  it("weekends-only and malformed", () => {
    const p = prefs({ weekendsOnly: true });
    expect(matches(show({ showDateTimeLocal: "2030-01-01T19:00:00" }), p)).toBe(false); // Tuesday
    expect(matches(show({ showDateTimeLocal: "2030-01-05T19:00:00" }), p)).toBe(true); // Saturday
    expect(matches(show({ showDateTimeLocal: "bad" }), prefs())).toBe(false);
  });
});

describe("posterUrl", () => {
  it("resizes cloudinary only", () => {
    expect(posterUrl("https://amc-theatres-res.cloudinary.com/v1/x.jpg", 300)).toBe(
      "https://amc-theatres-res.cloudinary.com/w_300,f_auto,q_auto/v1/x.jpg",
    );
    expect(posterUrl("https://example.com/x.jpg", 300)).toBe("https://example.com/x.jpg");
    expect(posterUrl("", 300)).toBe("");
    expect(posterUrl(null, 300)).toBe("");
  });
});

describe("relevanceScore", () => {
  it("local first, then score with fan-fave/intl adjustments", () => {
    const cat = buildCatalog([
      [
        movie({ id: 1, score: 0.1 }),
        movie({ id: 2, score: 0.0, attributes: [{ code: "FANFAVES" }] }),
        movie({ id: 3, score: 0.05, attributes: [{ code: "INTFILMS" }] }),
        movie({ id: 4, score: 0.01 }),
      ],
    ]);
    const local = new Set([4]);
    const order = [1, 2, 3, 4].sort((a, b) => relevanceScore(cat.get(b), b, local) - relevanceScore(cat.get(a), a, local));
    expect(order).toEqual([4, 2, 1, 3]); // local; then fan-fave .15 > .10 > intl -.10
  });
});

describe("showRow.passed", () => {
  it("flags past showtimes vs a reference time", () => {
    expect(showRow(show({ showDateTimeLocal: "2020-01-01T10:00:00" }), { now: "2020-01-01T12:00:00" }).passed).toBe(true);
    expect(showRow(show({ showDateTimeLocal: "2099-01-01T10:00:00" }), { now: "2020-01-01T12:00:00" }).passed).toBe(false);
    expect(showRow(show({ showDateTimeLocal: "2020-01-01T10:00:00" }), {}).passed).toBe(false);
  });
});

describe("buildBoard", () => {
  it("groups, filters by earliest_hour, and ranks by popularity", () => {
    const p = prefs({ theatres: [{ id: 2253, name: "GSP" }] });
    const cat = buildCatalog([[
      movie({ id: 10, score: 0.1 }),
      movie({ id: 20, score: 0, attributes: [{ code: "FANFAVES" }], releaseDateUtc: "2010-01-01T00:00:00" }),
    ]]);
    const day = "2030-01-01";
    const data = new Map<number, Showtime[]>([
      [2253, [
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: `${day}T19:00:00` }),
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: `${day}T21:00:00` }),
        show({ movieId: 20, movieName: "Beta", showDateTimeLocal: `${day}T20:00:00` }),
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: `${day}T16:00:00` }), // before 18 -> excluded
      ]],
    ]);
    const board = buildBoard(p, data, cat, day, "2030-01-01T18:30:00");
    expect(board).toHaveLength(1);
    expect(board[0].movies.map((m) => m.title)).toEqual(["Beta", "Alpha"]); // fan-fave .15 > .10
    const alpha = board[0].movies.find((m) => m.title === "Alpha")!;
    expect(alpha.shows).toHaveLength(2); // 16:00 excluded
    expect(board[0].movies.find((m) => m.title === "Beta")!.rerelease).toBe(true);
  });
});

describe("buildWatch", () => {
  it("only watched movies with matching showtimes", () => {
    const p = prefs({ theatres: [{ id: 2253, name: "GSP" }] });
    const cat = buildCatalog([[movie({ id: 10, name: "Alpha", score: 0.1 }), movie({ id: 20, name: "Beta", score: 0.2 })]]);
    const data = new Map<number, Showtime[]>([
      [2253, [
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: "2030-01-04T19:00:00" }),
        show({ movieId: 20, movieName: "Beta", showDateTimeLocal: "2030-01-04T19:00:00" }),
      ]],
    ]);
    const watch = buildWatch(p, [10], data, cat, "2030-01-01T00:00:00");
    expect(watch.map((w) => w.title)).toEqual(["Alpha"]);
    expect(watch[0].matches).toBe(1);
  });
});

describe("buildMovieDetail", () => {
  it("groups by theatre and lists only present formats", () => {
    const p = prefs({ theatres: [{ id: 2253, name: "GSP" }] });
    const data = new Map<number, Showtime[]>([
      [2253, [
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: "2030-01-01T19:00:00", attributes: [{ code: "IMAX" }] }),
        show({ movieId: 10, movieName: "Alpha", showDateTimeLocal: "2030-01-01T21:00:00", attributes: [{ code: "DOLBYCINEMAATAMCPRIME" }] }),
      ]],
    ]);
    const d = buildMovieDetail(p, data, 10, new Map(), "2030-01-01T00:00:00");
    expect(d.title).toBe("Alpha"); // fallback from showtime
    expect(d.theatres).toHaveLength(1);
    expect(d.theatres[0].shows[0].hour).toBe(19);
    expect(d.formats).toEqual(["IMAX", "DOLBY"]);
  });
});

describe("isRerelease", () => {
  it("flags anything more than 365 days past its release date", () => {
    expect(isRerelease("2020-01-01T00:00:00", "2030-01-01T00:00:00")).toBe(true);
    expect(isRerelease("2029-06-01T00:00:00", "2030-01-01T00:00:00")).toBe(false);
  });
  it("is false for an unknown release date", () => {
    expect(isRerelease(undefined, "2030-01-01T00:00:00")).toBe(false);
  });
  it("is exclusive at exactly 365 days", () => {
    expect(isRerelease("2029-01-01T00:00:00", "2030-01-01T00:00:00")).toBe(false);
  });
});

describe("todaysLineup", () => {
  const theatres: Theatre[] = [
    { id: 2253, name: "GSP" },
    { id: 557, name: "Riverside 9" },
  ];
  const today = "2030-06-15";

  it("collects each theatre's movies for today, skipping canceled and other-day showtimes", () => {
    const cat = buildCatalog([[movie({ id: 1, name: "Catalog Name" })]]);
    const data = new Map<number, Showtime[]>([
      [2253, [
        show({ movieId: 1, movieName: "Feed Name", showDateTimeLocal: `${today}T19:00:00` }),
        show({ movieId: 1, movieName: "Feed Name", showDateTimeLocal: `${today}T21:00:00` }), // same movie again
        show({ movieId: 2, movieName: "Only In Feed", showDateTimeLocal: `${today}T20:00:00` }),
        show({ movieId: 3, showDateTimeLocal: `${today}T20:00:00`, isCanceled: true }),
        show({ movieId: 4, showDateTimeLocal: "2030-06-16T19:00:00" }), // tomorrow
      ]],
    ]);
    const lineup = todaysLineup(theatres, data, cat, today);
    expect([...lineup.get(2253)!]).toEqual([[1, "Catalog Name"], [2, "Only In Feed"]]);
    expect(lineup.get(557)).toEqual(new Map()); // present but empty: nothing scheduled there
  });
});

describe("buildDigest", () => {
  const theatres: Theatre[] = [
    { id: 2253, name: "GSP" },
    { id: 557, name: "Riverside 9" },
  ];
  const today = "2030-06-15";
  const yesterday = "2030-06-14";
  // Z-suffixed and date-only strings both parse as UTC, so the rerelease day math is deterministic
  // regardless of the test runner's local timezone.
  const now = `${today}T00:00:00Z`;
  const cat = buildCatalog([[
    movie({ id: 1, name: "Old Classic", releaseDateUtc: "2020-01-01T00:00:00" }), // rerelease
    movie({ id: 2, name: "Fresh Drop", releaseDateUtc: "2030-06-10T00:00:00" }),
    movie({ id: 3, name: "Midrun Movie", releaseDateUtc: "2030-05-01T00:00:00" }),
    movie({ id: 4, name: "Alpha Classic", releaseDateUtc: "2019-01-01T00:00:00" }), // rerelease
    movie({ id: 5, name: "Newer Drop", releaseDateUtc: "2030-06-12T00:00:00" }),
  ]]);
  const lineupOf = (byTheatre: Record<number, number[]>): Lineup =>
    new Map(Object.entries(byTheatre).map(([tid, ids]) => [Number(tid), new Map(ids.map((id) => [id, cat.get(id)!.name]))]));
  const seenOf = (byTheatre: Record<number, Record<number, string>>): LineupSeen =>
    new Map(Object.entries(byTheatre).map(([tid, m]) => [Number(tid), new Map(Object.entries(m).map(([id, d]) => [Number(id), d]))]));
  const titles = (d: Digest) => ({ rereleases: d.rereleases.map((e) => e.title), newReleases: d.newReleases.map((e) => e.title) });

  it("reports only movies that were not playing at the theatre before", () => {
    const digest = buildDigest(theatres, lineupOf({ 2253: [1, 2, 3] }), seenOf({ 2253: { 1: yesterday, 3: yesterday } }), cat, today, now, 7);
    expect(titles(digest)).toEqual({ rereleases: [], newReleases: ["Fresh Drop"] });
  });

  it("decides newness by the theatre's memory, not the release date: a mid-run movie arriving is new there", () => {
    const digest = buildDigest(theatres, lineupOf({ 2253: [3] }), seenOf({ 2253: { 1: yesterday } }), cat, today, now, 7);
    expect(titles(digest)).toEqual({ rereleases: [], newReleases: ["Midrun Movie"] });
  });

  it("splits what's new into rereleases and new arrivals", () => {
    const digest = buildDigest(theatres, lineupOf({ 2253: [1, 2] }), seenOf({ 2253: {} }), cat, today, now, 7);
    expect(titles(digest)).toEqual({ rereleases: ["Old Classic"], newReleases: ["Fresh Drop"] });
  });

  it("treats a theatre with no memory at all as a baseline and reports nothing for it", () => {
    expect(buildDigest(theatres, lineupOf({ 2253: [1, 2] }), new Map(), cat, today, now, 7)).toEqual({ rereleases: [], newReleases: [] });
    // Mixed: only the remembered theatre's additions show up, and the entry names only that theatre.
    const digest = buildDigest(theatres, lineupOf({ 2253: [2], 557: [2] }), seenOf({ 557: {} }), cat, today, now, 7);
    expect(digest.newReleases).toEqual([{ id: 2, title: "Fresh Drop", theatres: ["Riverside 9"] }]);
  });

  it("is not new while seen within the lookback window, and new again once it has been gone longer", () => {
    const run = (lastSeen: string) => buildDigest(theatres, lineupOf({ 2253: [2] }), seenOf({ 2253: { 2: lastSeen } }), cat, today, now, 7).newReleases.length;
    expect(run(today)).toBe(0); // a same-day re-run
    expect(run(yesterday)).toBe(0);
    expect(run("2030-06-08")).toBe(0); // exactly 7 days ago: still inside the window
    expect(run("2030-06-07")).toBe(1); // 8 days ago: gone long enough to count as new again
  });

  it("merges a movie new at several theatres into one entry, naming only the theatres where it is new", () => {
    const digest = buildDigest(theatres, lineupOf({ 2253: [2], 557: [2] }), seenOf({ 2253: {}, 557: {} }), cat, today, now, 7);
    expect(digest.newReleases).toEqual([{ id: 2, title: "Fresh Drop", theatres: ["GSP", "Riverside 9"] }]);
    const partial = buildDigest(theatres, lineupOf({ 2253: [2], 557: [2] }), seenOf({ 2253: { 2: yesterday }, 557: {} }), cat, today, now, 7);
    expect(partial.newReleases).toEqual([{ id: 2, title: "Fresh Drop", theatres: ["Riverside 9"] }]);
  });

  it("sorts new arrivals newest release first and rereleases alphabetically", () => {
    const digest = buildDigest(theatres, lineupOf({ 2253: [1, 2, 4, 5] }), seenOf({ 2253: {} }), cat, today, now, 7);
    expect(titles(digest)).toEqual({ rereleases: ["Alpha Classic", "Old Classic"], newReleases: ["Newer Drop", "Fresh Drop"] });
  });

  it("returns empty groups when nothing is playing", () => {
    expect(buildDigest(theatres, lineupOf({ 2253: [] }), seenOf({ 2253: { 1: yesterday } }), cat, today, now, 7)).toEqual({ rereleases: [], newReleases: [] });
  });
});
