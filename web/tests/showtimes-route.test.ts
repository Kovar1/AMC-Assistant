import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Showtime } from "@/lib/amc-logic";
import type { ShowtimesOutcome } from "@/lib/amc";
import { resetRateLimits } from "@/lib/rate-limit";

// The route pulls showtimes through lib/amc; stub it so no test touches the network or needs a key.
const getShowtimes = vi.fn<(ids: number[], dates: string[]) => Promise<Map<number, ShowtimesOutcome>>>();
vi.mock("@/lib/amc", () => ({
  fetchShowtimesDetailed: (ids: number[], dates: string[]) => getShowtimes(ids, dates),
}));

const { GET, OPTIONS } = await import("@/app/api/showtimes/route");
const { getShowtimesPayload } = await import("@/lib/showtimes-service");
const { parseShowtimesQuery } = await import("@/lib/showtimes-api");

// Real ids from the bundled index.
const GSP = 2253; // AMC Garden State Plaza 16, Paramus NJ
const RIVERSIDE = 557; // AMC DINE-IN Shops at Riverside 9, Hackensack NJ

let nextId = 1;
function show(local: string, over: Partial<Showtime> = {}): Showtime {
  return {
    id: nextId++,
    movieId: 900,
    movieName: "Test Movie",
    showDateTimeLocal: local,
    auditorium: 1,
    purchaseUrl: "https://www.amctheatres.com/showtimes/all/x/1",
    runTime: 100,
    mpaaRating: "PG13",
    ...over,
  };
}

/** Showtimes on whatever date the service asks for, so tests never depend on the wall clock. */
function respondWith(build: (date: string) => Showtime[]) {
  getShowtimes.mockImplementation(async (ids, dates) => {
    const map = new Map<number, ShowtimesOutcome>();
    for (const id of ids) map.set(id, { ok: true, showtimes: dates.flatMap(build) });
    return map;
  });
}

function req(qs: string, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/showtimes?${qs}`, { headers });
}

beforeEach(() => {
  resetRateLimits();
  getShowtimes.mockReset();
  respondWith(() => []);
});

describe("GET /api/showtimes — contract", () => {
  it("returns JSON with CORS and a cacheable window", async () => {
    const res = await GET(req(`theatre=${GSP}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=\d+/);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.source).toMatch(/amctheatres\.com/);
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves a plain-text view", async () => {
    const res = await GET(req(`theatre=${GSP}&view=text`));
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toMatch(/^AMC SHOWTIMES/);
  });

  it("uses a short cache window when the answer is pinned to now", async () => {
    const now = await GET(req(`theatre=${GSP}&after=now`));
    expect(now.headers.get("cache-control")).toMatch(/s-maxage=60/);
    const fixed = await GET(req(`theatre=${GSP}&after=none`));
    expect(fixed.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });

  it("answers a CORS preflight with the allowed methods", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
  });

  it("400s a malformed query with both an error and a hint, uncached", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.hint).toMatch(/theatre=/);
  });

  it("400s an unknown format rather than pretending to filter", async () => {
    const res = await GET(req(`theatre=${GSP}&format=imax3d`));
    expect(res.status).toBe(400);
    expect((await res.json()).hint).toMatch(/IMAX/);
  });

  it("rate limits a caller in a loop", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    let last = 200;
    for (let i = 0; i < 40; i++) last = (await GET(req(`theatre=${GSP}`, headers))).status;
    expect(last).toBe(429);
    const res = await GET(req(`theatre=${GSP}`, headers));
    expect(res.headers.get("retry-after")).toBeTruthy();
    // A different caller is unaffected.
    const other = await GET(req(`theatre=${GSP}`, { "x-forwarded-for": "198.51.100.4" }));
    expect(other.status).toBe(200);
  });
});

describe("the endpoint never reaches Supabase", () => {
  it("works with every Supabase env var unset", async () => {
    const saved = { ...process.env };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const res = await GET(req(`theatre=${GSP}`));
      expect(res.status).toBe(200);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});

describe("resolution reaches AMC only for theatres that resolved", () => {
  async function run(qs: string) {
    const parsed = parseShowtimesQuery(new URLSearchParams(qs));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await getShowtimesPayload(parsed.query, { getShowtimes });
    if (!r.ok) throw new Error(r.error);
    return r.payload;
  }

  it("fetches for a resolved id", async () => {
    await run(`theatre=${GSP}`);
    expect(getShowtimes).toHaveBeenCalledTimes(1);
    expect(getShowtimes.mock.calls[0][0]).toEqual([GSP]);
  });

  it("fetches nothing at all for an unknown id, and still returns 200-shaped data", async () => {
    const p = await run("theatre=99999999");
    expect(getShowtimes).not.toHaveBeenCalled();
    expect(p.theatres).toEqual([]);
    expect(p.unresolvedInput[0].status).toBe("unresolved");
    expect(p.summary.theatresResolved).toBe(0);
  });

  it("fetches nothing for an ambiguous name and asks instead of choosing", async () => {
    const p = await run("theatre=plaza");
    expect(getShowtimes).not.toHaveBeenCalled();
    expect(p.theatres).toEqual([]);
    expect(p.unresolvedInput[0].status).toBe("ambiguous");
    expect(p.unresolvedInput[0].candidates.length).toBeGreaterThan(1);
    expect(p.summary.theatresAmbiguous).toBe(1);
  });

  it("fetches only the resolved half of a mixed request", async () => {
    const p = await run(`theatre=${GSP},plaza`);
    expect(getShowtimes.mock.calls[0][0]).toEqual([GSP]);
    expect(p.theatres.map((t) => t.id)).toEqual([GSP]);
    expect(p.unresolvedInput.map((u) => u.input)).toEqual(["plaza"]);
  });

  it("deduplicates a repeated theatre into a single fetch", async () => {
    const p = await run(`theatre=${GSP},${GSP}`);
    expect(getShowtimes.mock.calls[0][0]).toEqual([GSP]);
    expect(p.theatres).toHaveLength(1);
  });

  it("resolves a real place to nearby theatres with distances", async () => {
    const p = await run("near=paramus&limit=2");
    expect(p.resolvedLocation?.matchedBy).toBe("city");
    expect(p.theatres.length).toBeGreaterThan(0);
    expect(p.theatres.every((t) => typeof t.distanceMiles === "number")).toBe(true);
    expect(p.theatres.map((t) => t.id)).toContain(GSP);
  });

  it("fetches nothing for a place with no AMC presence", async () => {
    const p = await run("near=zzzznowhereville");
    expect(getShowtimes).not.toHaveBeenCalled();
    expect(p.unresolvedInput[0].message).toMatch(/did not match any AMC/i);
  });
});

describe("date and time defaults through the full stack", () => {
  async function payload(qs: string) {
    const parsed = parseShowtimesQuery(new URLSearchParams(qs));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await getShowtimesPayload(parsed.query, { getShowtimes });
    if (!r.ok) throw new Error(r.error);
    return r.payload;
  }

  it("defaults after to now for today", async () => {
    expect((await payload(`theatre=${GSP}`)).query.after).toBe("now");
  });

  it("defaults after to none for tomorrow, so matinees are not hidden", async () => {
    expect((await payload(`theatre=${GSP}&date=tomorrow`)).query.after).toBe("none");
  });

  it("defaults after to none for a multi-day range", async () => {
    const p = await payload(`theatre=${GSP}&days=3`);
    expect(p.query.after).toBe("none");
    expect((p.query.dates as string[])).toHaveLength(3);
  });

  it("neutralises an explicit after=now on a future date and says it did", async () => {
    const p = await payload(`theatre=${GSP}&date=tomorrow&after=now`);
    expect(p.query.after).toBe("none");
    expect(p.warnings.join(" ")).toMatch(/no effect/);
  });

  it("400s an unparseable date with guidance", async () => {
    const res = await GET(req(`theatre=${GSP}&date=someday`));
    expect(res.status).toBe(400);
    expect((await res.json()).hint).toMatch(/YYYY-MM-DD/);
  });

  it("passes the resolved dates through to the AMC call", async () => {
    await payload(`theatre=${GSP}&date=2026-12-25&days=2`);
    expect(getShowtimes.mock.calls[0][1]).toEqual(["2026-12-25", "2026-12-26"]);
  });
});

describe("payload content end to end", () => {
  it("groups showtimes under the movie and reports grounded metadata", async () => {
    respondWith((date) => [
      show(`${date}T20:00:00`, { movieId: 1, movieName: "Alpha", runTime: 96, mpaaRating: "R" }),
      show(`${date}T22:00:00`, { movieId: 1, movieName: "Alpha" }),
      show(`${date}T21:00:00`, { movieId: 2, movieName: "Beta", runTime: undefined, mpaaRating: "" }),
    ]);
    const res = await GET(req(`theatre=${RIVERSIDE}&date=2026-12-25&after=none`));
    const body = await res.json();
    const movies = body.theatres[0].dates[0].movies;

    expect(movies).toHaveLength(2);
    const alpha = movies.find((m: { title: string }) => m.title === "Alpha");
    expect(alpha.runtimeMinutes).toBe(96);
    expect(alpha.rating).toBe("R");
    expect(alpha.showtimes.map((s: { time: string }) => s.time)).toEqual(["8:00 PM", "10:00 PM"]);

    const beta = movies.find((m: { title: string }) => m.title === "Beta");
    expect(beta.runtimeMinutes).toBeNull();
    expect(beta.rating).toBeNull();
  });

  it("reports an AMC failure as error, distinct from an empty listing", async () => {
    getShowtimes.mockResolvedValue(
      new Map<number, ShowtimesOutcome>([[RIVERSIDE, { ok: false, status: 503, message: "the AMC API returned 503 for this theatre" }]]),
    );
    const body = await (await GET(req(`theatre=${RIVERSIDE}`))).json();
    expect(body.theatres[0].status).toBe("error");
    expect(body.theatres[0].statusDetail).toMatch(/Do not guess/);
  });

  it("reports an empty listing as no-showtimes with a proving count", async () => {
    const body = await (await GET(req(`theatre=${RIVERSIDE}`))).json();
    expect(body.theatres[0].status).toBe("no-showtimes");
    expect(body.theatres[0].counts.beforeFilters).toBe(0);
  });
});
