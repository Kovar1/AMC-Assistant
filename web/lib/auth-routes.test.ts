import { describe, expect, it } from "vitest";
import { authRedirect, isPublicPath } from "./auth-routes";

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

  it("matches public prefixes on path boundaries only", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/whatever")).toBe(true);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });
});
