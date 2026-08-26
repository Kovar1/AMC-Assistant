// Sliding-window rate limiter for the public showtimes endpoint.
//
// This is a speed bump, not a wall: the counter lives in the process, and Vercel runs many
// instances, so the real ceiling is roughly (limit x instances). The actual protection against
// hammering AMC is the Next fetch Data Cache in lib/amc.ts — this just stops one caller in a loop
// from being obnoxious. If a hard guarantee is ever needed it has to move to shared storage.

type Window = { hits: number[] };

const WINDOWS = new Map<string, Window>();
const SWEEP_AFTER = 5000; // entries; keeps an idle process from growing without bound

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;

  if (WINDOWS.size > SWEEP_AFTER) {
    for (const [k, w] of WINDOWS) {
      if (w.hits.length === 0 || w.hits[w.hits.length - 1] < cutoff) WINDOWS.delete(k);
    }
  }

  const win = WINDOWS.get(key) ?? { hits: [] };
  win.hits = win.hits.filter((t) => t > cutoff);

  if (win.hits.length >= limit) {
    WINDOWS.set(key, win);
    const retryAfterSeconds = Math.max(1, Math.ceil((win.hits[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  win.hits.push(now);
  WINDOWS.set(key, win);
  return { allowed: true };
}

/** Caller identity: the first hop of x-forwarded-for, which on Vercel is the real client. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Test seam — the module-level map would otherwise leak state between test files. */
export function resetRateLimits(): void {
  WINDOWS.clear();
}
