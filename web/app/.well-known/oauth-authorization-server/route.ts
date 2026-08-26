// RFC 8414 authorization server metadata for the no-op OAuth shim — see lib/mcp-oauth.ts for why
// this exists. Origin is derived from the request (via getPublicOrigin), not an env var, so it's
// correct regardless of how NEXT_PUBLIC_SITE_URL happens to be formatted.
import { NextResponse } from "next/server";
import { getPublicOrigin } from "mcp-handler";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [],
    },
    { headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
