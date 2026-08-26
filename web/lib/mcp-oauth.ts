// Minimal no-op OAuth 2.0 authorization server, self-hosted at this app's origin.
//
// Why this exists: claude.ai's "Add custom connector" flow unconditionally attempts OAuth
// Dynamic Client Registration against any server URL entered, even ones that need no auth, and
// fails with "Couldn't register with sign-in service" instead of falling back to anonymous access
// — a confirmed, currently open bug (see e.g. github.com/anthropics/claude-ai-mcp issues #402,
// #435, #697 — "Custom connector fails to register with authless ... MCP server"). This module
// exists purely to give that probe something real to register against.
//
// It is NOT a real security boundary. /api/mcp never checks the tokens this issues — the
// underlying data (public AMC showtimes) has nothing to protect. Every authorize request is
// auto-approved; there is no login, no user, no consent decision beyond a single click. PKCE is
// still verified because the client is required to send it and a malformed/garbage code_verifier
// should fail cleanly like a real OAuth server would — not because anything here is actually
// gated by it.
//
// Codes and tokens are self-contained signed strings (payload + HMAC-SHA256), so this needs no
// database or KV store — consistent with the rest of this app's stateless, public API design.
// The signing key is a fixed constant, not an env-sourced secret: nothing downstream trusts a
// valid signature for anything security-sensitive, so there is no secret worth protecting here —
// it only keeps the code/token format internally consistent (expiry, PKCE binding).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SIGNING_KEY = "amc-showtimes-noop-oauth-v1";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes — standard authorization_code lifetime
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", SIGNING_KEY).update(body).digest());
  return `${body}.${sig}`;
}

function verify<T extends { exp?: number }>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = createHmac("sha256", SIGNING_KEY).update(body).digest();
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as T;
    if (typeof payload.exp === "number" && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueClientId(): string {
  return `client_${b64url(randomBytes(16))}`;
}

type CodePayload = {
  cc: string; // code_challenge from the authorize request
  cid: string; // client_id
  ru: string; // redirect_uri, re-checked at token exchange per RFC 6749
  exp: number;
};

export function issueAuthorizationCode(input: { codeChallenge: string; clientId: string; redirectUri: string }): string {
  const payload: CodePayload = {
    cc: input.codeChallenge,
    cid: input.clientId,
    ru: input.redirectUri,
    exp: Date.now() + CODE_TTL_MS,
  };
  return sign(payload);
}

export function consumeAuthorizationCode(code: string): CodePayload | null {
  return verify<CodePayload>(code);
}

/** RFC 7636 S256: code_challenge == base64url(SHA256(code_verifier)). */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = b64url(createHash("sha256").update(codeVerifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueAccessToken(): { accessToken: string; refreshToken: string; expiresIn: number } {
  const accessToken = sign({ typ: "access", exp: Date.now() + TOKEN_TTL_MS });
  const refreshToken = sign({ typ: "refresh", exp: Date.now() + REFRESH_TTL_MS });
  return { accessToken, refreshToken, expiresIn: Math.floor(TOKEN_TTL_MS / 1000) };
}

export function verifyRefreshToken(token: string): boolean {
  const payload = verify<{ typ: string; exp: number }>(token);
  return payload?.typ === "refresh";
}
