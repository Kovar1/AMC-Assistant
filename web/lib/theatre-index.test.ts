import { describe, it, expect } from "vitest";
import {
  allTheatres,
  byCity,
  byExact,
  byId,
  byName,
  byState,
  byZip,
  haversineMiles,
  near,
  nearestFrom,
  normalize,
  resolvePlace,
  INDEX_GENERATED_AT,
  THEATRE_COUNT,
} from "@/lib/theatre-index";

// Real theatres from the bundled index, used as fixtures.
const GSP = 2253; // AMC Garden State Plaza 16 — Paramus, NJ 07652
const RIVERSIDE = 557; // AMC DINE-IN Shops at Riverside 9 — Hackensack, NJ 07601

describe("index integrity", () => {
  it("is populated and stamped", () => {
    expect(THEATRE_COUNT).toBeGreaterThan(400);
    expect(INDEX_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("has unique ids", () => {
    const ids = allTheatres().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has finite coordinates everywhere, so every theatre can take part in distance search", () => {
    const bad = allTheatres().filter((t) => !Number.isFinite(t.lat) || !Number.isFinite(t.lng));
    expect(bad).toEqual([]);
  });

  it("has a 5-digit zip and an IANA timezone everywhere", () => {
    const bad = allTheatres().filter((t) => !/^\d{5}$/.test(t.zip) || !t.tz.includes("/"));
    expect(bad).toEqual([]);
  });

  it("maps Arizona to Phoenix, not Denver — Arizona does not observe DST", () => {
    const az = allTheatres().filter((t) => t.state === "AZ");
    expect(az.length).toBeGreaterThan(0);
    expect(az.every((t) => t.tz === "America/Phoenix")).toBe(true);
  });
});

describe("normalize", () => {
  it("strips case, spaces and punctuation", () => {
    expect(normalize("AMC Garden State Plaza 16")).toBe("amcgardenstateplaza16");
    expect(normalize("AMC DINE-IN Shops at Riverside 9")).toBe("amcdineinshopsatriverside9");
  });
  it("is empty for punctuation-only input", () => {
    expect(normalize("  -- ")).toBe("");
  });
});

describe("byId", () => {
  it("finds a known theatre", () => {
    expect(byId(GSP)?.name).toBe("AMC Garden State Plaza 16");
  });
  it("returns null for an unknown id rather than throwing", () => {
    expect(byId(99999999)).toBeNull();
  });
});

describe("byExact", () => {
  it("matches a full name regardless of case and punctuation", () => {
    expect(byExact("amc garden state plaza 16")?.id).toBe(GSP);
  });
  it("matches a slug", () => {
    expect(byExact("amc-garden-state-plaza-16")?.id).toBe(GSP);
  });
  it("does not match a partial name", () => {
    expect(byExact("garden state")).toBeNull();
  });
});

describe("byName", () => {
  it("finds a single theatre by a distinctive substring", () => {
    const hits = byName("garden state plaza");
    expect(hits.map((t) => t.id)).toEqual([GSP]);
  });

  it("returns every match for an ambiguous substring instead of picking one", () => {
    // "plaza" hits ~8 theatres nationwide; all of them must come back so the caller can ask.
    const hits = byName("plaza");
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.map((t) => t.id)).toContain(GSP);
  });

  it("resolves a distinctive substring uniquely", () => {
    // "riverside" happens to be unique in the catalogue, so it needs no disambiguation.
    expect(byName("riverside").map((t) => t.id)).toEqual([RIVERSIDE]);
  });

  it("is empty for nonsense and for blank input", () => {
    expect(byName("zzzznotatheatre")).toEqual([]);
    expect(byName("   ")).toEqual([]);
  });
});

describe("byZip", () => {
  it("matches exactly", () => {
    expect(byZip("07652").map((t) => t.id)).toContain(GSP);
  });
  it("tolerates ZIP+4 by using the first five digits", () => {
    expect(byZip("07652-1234").map((t) => t.id)).toContain(GSP);
  });
  it("rejects a non-zip", () => {
    expect(byZip("brooklyn")).toEqual([]);
  });
});

describe("byCity / byState", () => {
  it("matches a city exactly, case-insensitively", () => {
    expect(byCity("paramus").map((t) => t.id)).toContain(GSP);
  });
  it("does not match a city by prefix", () => {
    expect(byCity("param")).toEqual([]);
  });
  it("matches a state by code and by full name", () => {
    const byCode = byState("NJ");
    const byFull = byState("new jersey");
    expect(byCode.length).toBeGreaterThan(0);
    expect(byFull.map((t) => t.id).sort()).toEqual(byCode.map((t) => t.id).sort());
  });
});

describe("haversineMiles", () => {
  it("is zero for the same point", () => {
    expect(haversineMiles(40.9, -74.0, 40.9, -74.0)).toBe(0);
  });

  it("matches a known distance (NYC to LA is ~2445 mi)", () => {
    const d = haversineMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });

  it("matches a known short distance (Garden State Plaza to Riverside is ~2.5 mi)", () => {
    const a = byId(GSP)!;
    const b = byId(RIVERSIDE)!;
    const d = haversineMiles(a.lat, a.lng, b.lat, b.lng);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(5);
  });

  it("is symmetric", () => {
    const ab = haversineMiles(40.9, -74.0, 34.0, -118.2);
    const ba = haversineMiles(34.0, -118.2, 40.9, -74.0);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

describe("near", () => {
  const gsp = byId(GSP)!;

  it("sorts ascending by distance", () => {
    const hits = near(gsp.lat, gsp.lng, 50, 10);
    const distances = hits.map((t) => t.distanceMiles);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("puts the theatre itself first at zero miles", () => {
    const hits = near(gsp.lat, gsp.lng, 50, 10);
    expect(hits[0].id).toBe(GSP);
    expect(hits[0].distanceMiles).toBe(0);
  });

  it("respects the limit", () => {
    expect(near(gsp.lat, gsp.lng, 100, 3)).toHaveLength(3);
  });

  it("respects the radius", () => {
    const hits = near(gsp.lat, gsp.lng, 10, 50);
    expect(hits.every((t) => t.distanceMiles <= 10)).toBe(true);
  });

  it("returns empty rather than nearest-anyway when nothing is in range", () => {
    // Middle of the Pacific.
    expect(near(0, -160, 25, 5)).toEqual([]);
  });
});

describe("nearestFrom", () => {
  it("ignores radius so a large state still yields theatres", () => {
    const nj = byState("NJ");
    const hits = nearestFrom(nj, 40.9, -74.0, 3);
    expect(hits).toHaveLength(3);
    expect(hits.every((t) => t.state === "NJ")).toBe(true);
  });
});

describe("resolvePlace", () => {
  it("parses explicit coordinates", () => {
    const p = resolvePlace("40.7128,-74.0060");
    expect(p?.matchedBy).toBe("coords");
    expect(p?.centre.lat).toBeCloseTo(40.7128, 4);
  });

  it("rejects out-of-range coordinates", () => {
    expect(resolvePlace("999,999")).toBeNull();
  });

  it("resolves a zip", () => {
    const p = resolvePlace("07652");
    expect(p?.matchedBy).toBe("zip");
    expect(p?.matched.map((t) => t.id)).toContain(GSP);
  });

  it("resolves a city", () => {
    const p = resolvePlace("Paramus");
    expect(p?.matchedBy).toBe("city");
    expect(p?.matched.map((t) => t.id)).toContain(GSP);
  });

  it("resolves a metro nickname through the alias table", () => {
    const p = resolvePlace("nyc");
    expect(p).not.toBeNull();
    expect(["city", "market"]).toContain(p!.matchedBy);
    expect(p!.matched.length).toBeGreaterThan(0);
  });

  it("prefers a city over a state when both could match", () => {
    // "New York" is both a city and a state name; the city is the more useful answer.
    const p = resolvePlace("new york");
    expect(p?.matchedBy).not.toBe("state");
  });

  it("falls back to a state when no city or market matches", () => {
    const p = resolvePlace("new jersey");
    expect(p?.matchedBy).toBe("state");
    expect(p!.matched.every((t) => t.state === "NJ")).toBe(true);
  });

  it("returns null for a place with no AMC presence rather than guessing", () => {
    expect(resolvePlace("zzzznowhereville")).toBeNull();
    expect(resolvePlace("   ")).toBeNull();
  });

  it("puts the centre near the matched theatres", () => {
    const p = resolvePlace("Paramus")!;
    const gsp = byId(GSP)!;
    expect(haversineMiles(p.centre.lat, p.centre.lng, gsp.lat, gsp.lng)).toBeLessThan(10);
  });
});
