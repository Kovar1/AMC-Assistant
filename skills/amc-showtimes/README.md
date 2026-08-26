# amc-showtimes — Claude Skill

> **Status: does not work on claude.ai (consumer) for live data.** Use the [MCP
> connector](../web/README.md#mcp-connector) instead — see below for why.

## Why this Skill can't fetch showtimes on claude.ai

A Skill's bundled files run in claude.ai's code execution sandbox, which has **no internet
access at all** ([Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool#networking-and-security)).
The only way Claude can reach a URL from there is the separate `web_fetch` tool — and that tool
explicitly **refuses to fetch a URL Claude constructs itself**:

> The web fetch tool can only fetch URLs that have previously appeared in the conversation
> context... The tool cannot fetch arbitrary URLs that Claude generates.
> — [Web fetch tool docs, URL validation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool#url-validation)

This Skill's entire design was "read `SKILL.md`, build a query string like `?near=brooklyn&after=17:00`,
fetch it." That's exactly the case the restriction exists to block — it's a deliberate
anti-data-exfiltration measure, not a bug or a permissions toggle. No amount of `SKILL.md` wording
fixes it.

In practice: the Skill triggers correctly on natural-language prompts (the `description` works),
and it correctly refuses to invent showtimes rather than hallucinate — but it can't reach live
data, so it can only tell you to check amctheatres.com yourself.

**This Skill may still work in an environment where the model's URL-fetching tool doesn't carry
that restriction** (Claude Code's `WebFetch`, for instance, is a different, client-side tool) —
untested, not the goal here, and not worth pursuing further since the MCP connector is a strictly
better answer for claude.ai.

## Use the MCP connector instead

The same backend logic — theatre resolution, filtering, the anti-hallucination payload shape — is
exposed as an MCP tool at `https://amc-assistant.vercel.app/api/mcp`. MCP tool calls are structured
function calls, not URLs, so the restriction above doesn't apply.

**Setup**: claude.ai → Settings → Connectors → Add custom connector → paste the URL above. No
auth needed. Full details: [web/README.md § MCP connector](../web/README.md#mcp-connector).

## What's left in this folder

`SKILL.md` and `references/` are kept as documentation of the tool contract (query parameters,
response fields, resolution rules) — the same information now lives in the MCP tool's description
and this repo's docs, so nothing here should be uploaded to claude.ai going forward.
