export type AuthState = { error?: string; message?: string } | null;

const PUBLIC = ["/login", "/signup", "/reset", "/update-password", "/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
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
