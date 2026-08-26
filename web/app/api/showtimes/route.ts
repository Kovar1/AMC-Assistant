// Public, unauthenticated, stateless AMC showtimes API. Serves only public AMC data — no Supabase,
// no session, no user rows — so it is safe to call from anywhere, which is the point: a Claude
// Skill fetches it and answers from the payload instead of from memory.
//
// NOTE: deliberately no `export const dynamic` here. The sibling cron and webhook routes set
// "force-dynamic", so it looks like the house pattern, but per the Next docs that is equivalent to
// setting every fetch to { cache: 'no-store', next: { revalidate: 0 } } — it would disable the
// Data Cache in lib/amc.ts and hit AMC on every single request. The Data Cache is this endpoint's
// only shield for the vendor key's quota, so it must stay on.
import { NextResponse } from "next/server";
import { parseShowtimesQuery, renderShowtimesText } from "@/lib/showtimes-api";
import { getShowtimesPayload } from "@/lib/showtimes-service";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const maxDuration = 30;

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Robots-Tag": "noindex",
};

function errorResponse(status: number, error: string, hint: string, extra: HeadersInit = {}) {
  return NextResponse.json(
    { ok: false, error, hint },
    { status, headers: { ...CORS, "Cache-Control": "no-store", ...extra } },
  );
}

export async function GET(request: Request) {
  const limited = rateLimit(clientKey(request.headers), RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.allowed) {
    return errorResponse(
      429,
      `Rate limit exceeded (${RATE_LIMIT} requests per minute).`,
      `Wait ${limited.retryAfterSeconds}s and try again.`,
      { "Retry-After": String(limited.retryAfterSeconds) },
    );
  }

  const parsed = parseShowtimesQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return errorResponse(400, parsed.error, parsed.hint);

  let result;
  try {
    result = await getShowtimesPayload(parsed.query);
  } catch (e) {
    return errorResponse(500, (e as Error).message, "This is a server-side failure, not an empty result. Do not report it as 'no showtimes'.");
  }
  if (!result.ok) return errorResponse(400, result.error, result.hint);

  const { payload } = result;
  // A response pinned to "now" goes stale within the minute; a fixed window can sit longer.
  const fresh = payload.query.after === "now";
  const headers = {
    ...CORS,
    "Cache-Control": fresh
      ? "public, s-maxage=60, stale-while-revalidate=120"
      : "public, s-maxage=300, stale-while-revalidate=900",
  };

  if (parsed.query.view === "text") {
    return new Response(renderShowtimesText(payload), {
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(payload, { headers });
}

// Next auto-implements OPTIONS when absent, but emits only `Allow` — no CORS headers. A browser or
// sandbox that adds a header would preflight and fail without this.
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
