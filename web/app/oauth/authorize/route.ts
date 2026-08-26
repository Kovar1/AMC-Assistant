// Authorization endpoint for the no-op OAuth shim (see lib/mcp-oauth.ts). GET renders a one-click
// consent page — there's no login and no account, so "consent" just means acknowledging the
// connection; POST issues a signed code and redirects back to the caller.
import { issueAuthorizationCode } from "@/lib/mcp-oauth";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function readAuthParams(url: URL) {
  return {
    responseType: url.searchParams.get("response_type") ?? "",
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    state: url.searchParams.get("state") ?? "",
    codeChallenge: url.searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "",
  };
}

function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const p = readAuthParams(new URL(request.url));
  if (p.responseType !== "code") return badRequest("Only response_type=code is supported.");
  if (!isAllowedRedirect(p.redirectUri)) return badRequest("redirect_uri must be an https:// URL (or localhost).");
  if (!p.codeChallenge || p.codeChallengeMethod !== "S256") {
    return badRequest("A code_challenge with code_challenge_method=S256 (PKCE) is required.");
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to AMC Showtimes</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 440px; margin: 15vh auto 0; padding: 0 24px; color: #1a1a1a; }
  h1 { font-size: 1.2rem; margin-bottom: 0.5rem; }
  p { color: #555; line-height: 1.55; font-size: 0.95rem; }
  button { background: #d64526; color: #fff; border: 0; border-radius: 8px; padding: 12px 22px; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
  button:hover { background: #b83a1f; }
</style>
</head>
<body>
<h1>Connect to AMC Showtimes</h1>
<p>This lets the connecting app look up live AMC movie showtimes on your behalf. The data is
public — AMC's own showtime listings — so there's no account, no password, and nothing personal
involved. Clicking Allow just completes the connection.</p>
<form method="POST">
  <input type="hidden" name="client_id" value="${escapeHtml(p.clientId)}">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirectUri)}">
  <input type="hidden" name="state" value="${escapeHtml(p.state)}">
  <input type="hidden" name="code_challenge" value="${escapeHtml(p.codeChallenge)}">
  <button type="submit">Allow</button>
</form>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");

  if (!isAllowedRedirect(redirectUri) || !codeChallenge) {
    return badRequest("Missing or invalid redirect_uri/code_challenge.");
  }

  const code = issueAuthorizationCode({ codeChallenge, clientId, redirectUri });
  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  return Response.redirect(dest.toString(), 302);
}
