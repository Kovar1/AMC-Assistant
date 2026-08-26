import { describe, expect, it } from "vitest";
import { authRedirect, isPublicPath, isSessionlessPath } from "./auth-routes";

describe("authRedirect", () => {
  it("sends logged-out users from protected pages to /login", () => {
    expect(authRedirect("/", false)).toBe("/login");
    expect(authRedirect("/watchlist", false)).toBe("/login");
    expect(authRedirect("/movie/123", false)).toBe("/login");
  });

  it("lets logged-out users reach auth pages", () => {
    expect(authRedirect("/login", false)).toBeNull();
    expect(authRedirect("/signup", false)).toBeNull();
    expect(authRedirect("/auth/confirm", false)).toBeNull();
  });

  it("sends logged-in users away from login/signup", () => {
    expect(authRedirect("/login", true)).toBe("/");
    expect(authRedirect("/signup", true)).toBe("/");
  });

  it("lets logged-in users use the app", () => {
    expect(authRedirect("/", true)).toBeNull();
    expect(authRedirect("/watchlist", true)).toBeNull();
  });

  it("never redirects API routes (they do their own auth)", () => {
    // both branches: a webhook/cron call has no session, an in-app fetch does
    expect(authRedirect("/api/cron/alerts", false)).toBeNull();
    expect(authRedirect("/api/telegram/webhook", false)).toBeNull();
    expect(authRedirect("/api/theatres", false)).toBeNull();
    expect(authRedirect("/api/theatres", true)).toBeNull();
  });

  it("matches public prefixes on path boundaries only", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/whatever")).toBe(true);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });
});

describe("isSessionlessPath", () => {
  it("covers the routes that authenticate themselves", () => {
    expect(isSessionlessPath("/api/showtimes")).toBe(true);
    expect(isSessionlessPath("/api/mcp")).toBe(true);
    expect(isSessionlessPath("/api/cron/alerts")).toBe(true);
    expect(isSessionlessPath("/api/telegram/webhook")).toBe(true);
  });

  it("covers the no-op OAuth shim, so anonymous MCP clients aren't redirected to /login", () => {
    expect(isSessionlessPath("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isSessionlessPath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isSessionlessPath("/.well-known/oauth-protected-resource/api/mcp")).toBe(true);
    expect(isSessionlessPath("/oauth/register")).toBe(true);
    expect(isSessionlessPath("/oauth/authorize")).toBe(true);
    expect(isSessionlessPath("/oauth/token")).toBe(true);
  });

  it("excludes /api/theatres, which reads the session and needs the cookie refreshed", () => {
    expect(isSessionlessPath("/api/theatres")).toBe(false);
  });

  it("excludes page routes", () => {
    expect(isSessionlessPath("/")).toBe(false);
    expect(isSessionlessPath("/settings")).toBe(false);
  });

  it("matches on a path boundary, not a bare prefix", () => {
    expect(isSessionlessPath("/api/showtimes-private")).toBe(false);
    expect(isSessionlessPath("/api/showtimes/anything")).toBe(true);
    expect(isSessionlessPath("/oauthx")).toBe(false);
  });

  it("never contradicts authRedirect, which already passes all /api through", () => {
    for (const p of ["/api/showtimes", "/api/mcp", "/api/cron/alerts", "/api/telegram/webhook"]) {
      expect(authRedirect(p, false)).toBeNull();
    }
  });

  it("would otherwise be redirected by authRedirect — the bypass is load-bearing for /oauth and /.well-known", () => {
    // authRedirect only special-cases /api/ unconditionally; without the isSessionlessPath bypass
    // in the proxy, an anonymous request to these paths falls through to the logged-out redirect.
    expect(authRedirect("/oauth/authorize", false)).toBe("/login");
    expect(authRedirect("/.well-known/oauth-authorization-server", false)).toBe("/login");
  });
});
