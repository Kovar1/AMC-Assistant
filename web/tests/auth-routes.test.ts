import { describe, expect, it } from "vitest";
import { authRedirect, safeNext, strayAuthCode } from "@/lib/auth-routes";

const q = (s: string) => new URLSearchParams(s);

describe("strayAuthCode", () => {
  it("forwards a reset code that landed on the home page", () => {
    expect(strayAuthCode("/", q("code=abc123"))).toBe("/auth/confirm?code=abc123&next=%2Fupdate-password");
  });

  it("keeps a next that came along", () => {
    expect(strayAuthCode("/login", q("code=abc&next=/settings"))).toBe("/auth/confirm?code=abc&next=%2Fsettings");
  });

  it("leaves the confirm route and code-less pages alone", () => {
    expect(strayAuthCode("/auth/confirm", q("code=abc"))).toBeNull();
    expect(strayAuthCode("/", q(""))).toBeNull();
    expect(strayAuthCode("/", q("theatre=2253"))).toBeNull();
  });

  it("never forwards to another site", () => {
    expect(strayAuthCode("/", q("code=abc&next=//evil.example"))).toBe("/auth/confirm?code=abc&next=%2F");
  });
});

describe("safeNext", () => {
  it("allows same-site paths only", () => {
    expect(safeNext("/update-password")).toBe("/update-password");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("authRedirect", () => {
  it("still sends logged-out visitors to log in, and lets the confirm route through", () => {
    expect(authRedirect("/", false)).toBe("/login");
    expect(authRedirect("/auth/confirm", false)).toBeNull();
  });
});
