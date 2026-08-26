// RFC 7591 Dynamic Client Registration — always succeeds. See lib/mcp-oauth.ts: this whole shim
// exists only to satisfy claude.ai's connector-setup probe; there is no real client vetting
// because there is nothing sensitive behind /api/mcp for a "client" to be trusted with.
import { NextResponse } from "next/server";
import { issueClientId } from "@/lib/mcp-oauth";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Malformed or empty body — proceed with defaults rather than reject; nothing here depends
    // on the submitted metadata being meaningful.
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];

  return NextResponse.json(
    {
      client_id: issueClientId(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
}
