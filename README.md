# AMC Assistant

Multi-user AMC showtime app: browse tonight's board at your theatres, heart movies into a
watchlist, and book showtimes in your preferred formats and times.

**The app lives in [`web/`](web/README.md)** — Next.js on Vercel, Supabase for auth and
per-user data (Postgres + row-level security), invite-only signup enforced in the database.
Setup, testing, and deployment docs are in [web/README.md](web/README.md).

## MCP server — live showtimes for Claude

[`web/app/api/mcp`](web/app/api/mcp/route.ts) exposes a `get_showtimes` tool over MCP so Claude
can answer "what's playing tonight?" from real AMC data instead of guessing. It resolves theatres
by name, city, zip, or distance across 500+ AMC locations ([`web/lib/theatre-index.ts`](web/lib/theatre-index.ts)),
and the response shape ([`web/lib/showtimes-api.ts`](web/lib/showtimes-api.ts)) is designed so the
model reports facts instead of inventing them: unknown fields come back `null`, ambiguous theatre
names return candidates instead of a guess, and every response states its own timestamp.

Also includes a minimal OAuth 2.0 shim ([`web/lib/mcp-oauth.ts`](web/lib/mcp-oauth.ts)) built to
work around a claude.ai connector-setup bug — the underlying data needs no auth, but claude.ai's
UI insists on an OAuth handshake before it'll add any connector.

Live: `https://amc-assistant.vercel.app/api/mcp` (add as a custom connector — claude.ai →
Settings → Connectors). Same logic is also a plain HTTP API at
[`/api/showtimes`](web/app/api/showtimes/route.ts), callable with curl.

## Legacy

The Python files at the repo root (`app.py`, `assistant.py`, `core.py`, `amc.py`, …) are the
original single-user Flask version, replaced by `web/`. They're kept temporarily because
`web/scripts/import-state.mjs` reads `state.json` for the one-time data import; once that
import is done they can be deleted (history keeps them).
