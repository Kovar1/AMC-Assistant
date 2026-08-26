import { describe, expect, it } from "vitest";
import { authRedirect, isPublicPath, isSessionlessApiPath } from "./auth-routes";

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

describe("isSessionlessApiPath", () => {
  it("covers the routes that authenticate themselves", () => {
    expect(isSessionlessApiPath("/api/showtimes")).toBe(true);
    expect(isSessionlessApiPath("/api/mcp")).toBe(true);
    expect(isSessionlessApiPath("/api/cron/alerts")).toBe(true);
    expect(isSessionlessApiPath("/api/telegram/webhook")).toBe(true);
  });

  it("excludes /api/theatres, which reads the session and needs the cookie refreshed", () => {
    expect(isSessionlessApiPath("/api/theatres")).toBe(false);
  });

  it("excludes page routes", () => {
    expect(isSessionlessApiPath("/")).toBe(false);
    expect(isSessionlessApiPath("/settings")).toBe(false);
  });

  it("matches on a path boundary, not a bare prefix", () => {
    expect(isSessionlessApiPath("/api/showtimes-private")).toBe(false);
    expect(isSessionlessApiPath("/api/showtimes/anything")).toBe(true);
  });

  it("never contradicts authRedirect, which already passes all /api through", () => {
    for (const p of ["/api/showtimes", "/api/mcp", "/api/cron/alerts", "/api/telegram/webhook"]) {
      expect(authRedirect(p, false)).toBeNull();
    }
  });
});
