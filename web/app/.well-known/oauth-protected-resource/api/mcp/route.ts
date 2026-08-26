// Resource-specific variant of ../route.ts — same content, different path. Anthropic's docs
// describe Claude probing "/.well-known/oauth-protected-resource/<mcp-path>" before falling back
// to the bare path, so both are served identically.
export { GET, OPTIONS } from "../../route";
