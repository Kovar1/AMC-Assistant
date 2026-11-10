export type AuthState = { error?: string; message?: string } | null;

const PUBLIC = ["/login", "/signup", "/reset", "/update-password", "/auth"];

// Routes that authenticate themselves (or need no auth at all) and never read a Supabase session,
// so the proxy can skip its getUser() call entirely for them. That call is a network round-trip to
// Supabase on every request — pure latency and load here, since /api/showtimes and /api/mcp are
// public, /api/cron and /api/telegram run on their own shared secret plus the service role, and
// /.well-known + /oauth are the no-op OAuth shim (see lib/mcp-oauth.ts) that anonymous MCP clients
// hit before they have any session to carry.
//
// This list also stands in for isPublicPath() for these paths: authRedirect() only special-cases
// `/api/` unconditionally, so without this early bypass an anonymous request to /oauth/authorize
// would otherwise get redirected to /login.
//
// /api/theatres is deliberately NOT in this list: it calls getUser() itself and relies on the
// proxy to keep the session cookie fresh.
const SESSIONLESS_PATHS = ["/api/showtimes", "/api/mcp", "/api/cron", "/api/telegram", "/.well-known", "/oauth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** True for routes that need no Supabase session, so the proxy can pass them straight through. */
export function isSessionlessPath(pathname: string): boolean {
  return SESSIONLESS_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** A same-site path to go to after a login link, or "/" for anything else (stops open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/**
 * Supabase sends a password-reset link back to the redirect address only when that address is on
 * its allowed list. Otherwise it falls back to the project's Site URL, so the one-time `?code=` can
 * land on any page here, where the login guard would drop it. This returns where to forward such a
 * code (the confirm route, which exchanges it), or null when there's nothing to forward.
 * Sessionless paths (the OAuth shim uses its own `code`) never reach this.
 */
export function strayAuthCode(pathname: string, params: URLSearchParams): string | null {
  const code = params.get("code");
  if (!code || pathname === "/auth/confirm") return null;
  // Reset emails are the only email links this app sends (sign-up needs no confirmation),
  // so a code that lost its `next` is a reset.
  const next = safeNext(params.get("next") ?? "/update-password");
  return `/auth/confirm?${new URLSearchParams({ code, next })}`;
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
