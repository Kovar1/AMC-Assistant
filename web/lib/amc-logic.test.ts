import { describe, expect, it } from "vitest";
import {
  buildBoard,
  buildMovieDetail,
  buildWatch,
  buildCatalog,
  fmt,
  matches,
  posterUrl,
  relevanceScore,
  showRow,
  type Movie,
  type Prefs,
  type Showtime,
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
