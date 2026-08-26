// Token endpoint for the no-op OAuth shim (see lib/mcp-oauth.ts). Must accept
// application/x-www-form-urlencoded per RFC 6749 §4.1.3 — Claude sends both the initial exchange
// and refresh requests this way, unlike DCR's JSON body.
import { NextResponse } from "next/server";
import { consumeAuthorizationCode, issueAccessToken, verifyPkce, verifyRefreshToken } from "@/lib/mcp-oauth";

const CORS = { "Access-Control-Allow-Origin": "*" };

function oauthError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: CORS });
}

async function readParams(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await request.text());
  }
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) params.set(k, String(v));
    return params;
  }
  return null;
}

export async function POST(request: Request) {
  const params = await readParams(request);
  if (!params) return oauthError("unsupported content type — use application/x-www-form-urlencoded", 415);

  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code") ?? "";
    const codeVerifier = params.get("code_verifier") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";

    const payload = consumeAuthorizationCode(code);
    if (!payload) return oauthError("invalid_grant");
    if (payload.ru !== redirectUri) return oauthError("invalid_grant");
    if (!codeVerifier || !verifyPkce(codeVerifier, payload.cc)) return oauthError("invalid_grant");

    const { accessToken, refreshToken, expiresIn } = issueAccessToken();
    return NextResponse.json(
      { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, refresh_token: refreshToken },
      { headers: CORS },
    );
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token") ?? "";
    if (!verifyRefreshToken(refreshToken)) return oauthError("invalid_grant");

    const issued = issueAccessToken();
    return NextResponse.json(
      { access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, refresh_token: issued.refreshToken },
      { headers: CORS },
    );
  }

  return oauthError("unsupported_grant_type");
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
}
