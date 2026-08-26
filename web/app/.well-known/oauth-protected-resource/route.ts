// RFC 9728 protected resource metadata, generic path. Served at both this path and the
// resource-specific .well-known/oauth-protected-resource/api/mcp (see that route) since it's
// undocumented which one claude.ai's connector-setup probe checks — see lib/mcp-oauth.ts for why
// this whole shim exists. /api/mcp itself never actually checks a token; this only exists so the
// probe finds a real authorization server to register against.
import { protectedResourceHandler, metadataCorsOptionsRequestHandler, getPublicOrigin } from "mcp-handler";

function handler(request: Request) {
  const origin = getPublicOrigin(request);
  return protectedResourceHandler({ authServerUrls: [origin], resourceUrl: `${origin}/api/mcp` })(request);
}

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
