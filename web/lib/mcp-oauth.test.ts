import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  issueClientId,
  issueAuthorizationCode,
  consumeAuthorizationCode,
  verifyPkce,
  issueAccessToken,
  verifyRefreshToken,
} from "@/lib/mcp-oauth";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("issueClientId", () => {
  it("produces distinct, prefixed ids", () => {
    const a = issueClientId();
    const b = issueClientId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^client_/);
  });
});

describe("authorization code round trip", () => {
  const args = { codeChallenge: "abc123", clientId: "client_x", redirectUri: "https://claude.ai/api/mcp/auth_callback" };

  it("consumes a freshly issued code and returns exactly what was embedded", () => {
    const code = issueAuthorizationCode(args);
    const payload = consumeAuthorizationCode(code);
    expect(payload).toMatchObject({ cc: args.codeChallenge, cid: args.clientId, ru: args.redirectUri });
  });

  it("rejects a tampered code", () => {
    const code = issueAuthorizationCode(args);
    const tampered = code.slice(0, -2) + (code.at(-2) === "a" ? "b" : "a") + code.at(-1);
    expect(consumeAuthorizationCode(tampered)).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(consumeAuthorizationCode("not-a-real-code")).toBeNull();
    expect(consumeAuthorizationCode("")).toBeNull();
    expect(consumeAuthorizationCode("a.b.c")).toBeNull();
  });

  it("rejects an expired code", () => {
    const real = Date.now;
    Date.now = () => real() - 11 * 60 * 1000; // issue as if 11 minutes ago (TTL is 10 min)
    const code = issueAuthorizationCode(args);
    Date.now = real;
    expect(consumeAuthorizationCode(code)).toBeNull();
  });

  it("is single-shot only insofar as callers must not replay it themselves — the module itself is stateless", () => {
    // Documents the design: the same code decodes successfully every time it's presented, because
    // there is no server-side store marking it used. This is fine here (nothing sensitive is
    // gated), but would NOT be fine for a real OAuth server — replay protection is intentionally
    // out of scope.
    const code = issueAuthorizationCode(args);
    expect(consumeAuthorizationCode(code)).not.toBeNull();
    expect(consumeAuthorizationCode(code)).not.toBeNull();
  });
});

describe("verifyPkce", () => {
  it("accepts the correct verifier for a challenge", () => {
    const verifier = "a-random-verifier-string-that-is-long-enough";
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a mismatched verifier", () => {
    const challenge = b64url(createHash("sha256").update("real-verifier").digest());
    expect(verifyPkce("wrong-verifier", challenge)).toBe(false);
  });

  it("rejects an empty verifier", () => {
    const challenge = b64url(createHash("sha256").update("real-verifier").digest());
    expect(verifyPkce("", challenge)).toBe(false);
  });
});

describe("access/refresh tokens", () => {
  it("issues a token pair with a sane expiry", () => {
    const { accessToken, refreshToken, expiresIn } = issueAccessToken();
    expect(accessToken).not.toBe(refreshToken);
    expect(expiresIn).toBe(3600);
  });

  it("verifies a real refresh token", () => {
    const { refreshToken } = issueAccessToken();
    expect(verifyRefreshToken(refreshToken)).toBe(true);
  });

  it("rejects an access token presented as a refresh token", () => {
    const { accessToken } = issueAccessToken();
    expect(verifyRefreshToken(accessToken)).toBe(false);
  });

  it("rejects garbage and expired refresh tokens", () => {
    expect(verifyRefreshToken("garbage")).toBe(false);
    const real = Date.now;
    Date.now = () => real() - 31 * 24 * 60 * 60 * 1000; // 31 days ago (TTL is 30 days)
    const { refreshToken } = issueAccessToken();
    Date.now = real;
    expect(verifyRefreshToken(refreshToken)).toBe(false);
  });
});
