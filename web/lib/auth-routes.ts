export type AuthState = { error?: string; message?: string } | null;

const PUBLIC = ["/login", "/signup", "/reset", "/update-password", "/auth"];

// API routes that authenticate themselves and never read a Supabase session, so the proxy can skip
// its getUser() call entirely for them. That call is a network round-trip to Supabase on every
// request — pure latency and load here, since /api/showtimes is public and the other two run on
// their own shared secret plus the service role.
//
// /api/theatres is deliberately NOT in this list: it calls getUser() itself and relies on the
// proxy to keep the session cookie fresh.
const SESSIONLESS_API = ["/api/showtimes", "/api/cron", "/api/telegram"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** True for API routes that need no Supabase session, so the proxy can pass them straight through. */
export function isSessionlessApiPath(pathname: string): boolean {
  return SESSIONLESS_API.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Optimistic route guard used by the proxy. Pure + dependency-free so it's unit-tested.
 * Real authorization still happens in pages/actions (proxy is not the only check).
 */
export function authRedirect(pathname: string, hasUser: boolean): string | null {
  // API routes authenticate themselves (bearer/webhook secret, or getUser() in-handler).
  // The proxy must never redirect them to /login, or external callers — the Telegram
  // webhook and the alert cron, which carry no Supabase session — get bounced (a POST
  // 307'd to /login then 405s).
  if (pathname.startsWith("/api/")) return null;
  if (!hasUser && !isPublicPath(pathname)) return "/login";
  if (hasUser && (pathname === "/login" || pathname === "/signup")) return "/";
  return null;
}
