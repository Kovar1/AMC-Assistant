import { describe, it, expect, beforeEach } from "vitest";
import { clientKey, rateLimit, resetRateLimits } from "@/lib/rate-limit";

const LIMIT = 3;
const WINDOW = 60_000;

beforeEach(resetRateLimits);

describe("rateLimit", () => {
  it("allows up to the limit then refuses", () => {
    const t = 1_000_000;
    for (let i = 0; i < LIMIT; i++) {
      expect(rateLimit("a", LIMIT, WINDOW, t).allowed).toBe(true);
    }
    expect(rateLimit("a", LIMIT, WINDOW, t).allowed).toBe(false);
  });

  it("reports how long to wait", () => {
    const t = 1_000_000;
    for (let i = 0; i < LIMIT; i++) rateLimit("a", LIMIT, WINDOW, t);
    const res = rateLimit("a", LIMIT, WINDOW, t + 15_000);
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.retryAfterSeconds).toBe(45);
  });

  it("lets the window roll over", () => {
    const t = 1_000_000;
    for (let i = 0; i < LIMIT; i++) rateLimit("a", LIMIT, WINDOW, t);
    expect(rateLimit("a", LIMIT, WINDOW, t + WINDOW + 1).allowed).toBe(true);
  });

  it("expires hits individually rather than all at once", () => {
    // Three hits spread across the window; only the oldest should age out first.
    rateLimit("a", LIMIT, WINDOW, 1000);
    rateLimit("a", LIMIT, WINDOW, 30_000);
    rateLimit("a", LIMIT, WINDOW, 50_000);
    expect(rateLimit("a", LIMIT, WINDOW, 55_000).allowed).toBe(false);
    // At 61_001 the first hit (t=1000) has aged out, freeing one slot.
    expect(rateLimit("a", LIMIT, WINDOW, 61_001).allowed).toBe(true);
  });

  it("keys callers independently", () => {
    const t = 1_000_000;
    for (let i = 0; i < LIMIT; i++) rateLimit("a", LIMIT, WINDOW, t);
    expect(rateLimit("a", LIMIT, WINDOW, t).allowed).toBe(false);
    expect(rateLimit("b", LIMIT, WINDOW, t).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
