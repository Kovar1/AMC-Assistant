// Public MCP server exposing live AMC showtimes as a tool. No auth — same "public, stateless,
// factual data only" design as /api/showtimes.
//
// Why this exists alongside /api/showtimes: a Claude Skill on claude.ai cannot call a
// parameterized URL. Its web_fetch tool refuses any URL Claude constructs itself — only URLs that
// already appeared verbatim in the conversation, a deliberate anti-exfiltration restriction (see
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool#url-validation).
// An MCP tool call is a structured function call, not a URL, so that restriction doesn't apply —
// this is the mechanism Anthropic actually built for "let Claude call my API with real
// parameters." Add this server's URL under claude.ai -> Settings -> Connectors.
//
// The tool wraps the exact same parseShowtimesQuery -> getShowtimesPayload -> renderShowtimesText
// pipeline the HTTP endpoint uses, via a URLSearchParams built from the typed MCP arguments, so
// the two surfaces can never diverge in behavior.
import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { parseShowtimesQuery, renderShowtimesText } from "@/lib/showtimes-api";
import { getShowtimesPayload } from "@/lib/showtimes-service";
import { FORMAT_ORDER } from "@/lib/amc-logic";

const inputSchema = z.object({
  theatre: z
    .string()
    .optional()
    .describe('AMC theatre id(s), slug(s), or name(s), comma-separated (e.g. "2253" or "riverside9,gardenstate"). Mutually exclusive with near/city/zip.'),
  near: z
    .string()
    .optional()
    .describe('A place name ("brooklyn", "downtown chicago") or "lat,lng". Mutually exclusive with theatre/city/zip.'),
  city: z.string().optional().describe("A city, market, or state name. Mutually exclusive with theatre/near/zip."),
  zip: z.string().optional().describe("A 5-digit US zip code. Mutually exclusive with theatre/near/city."),
  radius: z.number().int().min(1).max(100).optional().describe("Search radius in miles for near/city/zip. Default 25."),
  limit: z.number().int().min(1).max(5).optional().describe("Max theatres to return from a location search. Default 3."),
  date: z
    .string()
    .optional()
    .describe('"today" (default), "tomorrow", a weekday name ("friday"), or YYYY-MM-DD. A weekday name means its next occurrence, counting today.'),
  days: z.number().int().min(1).max(7).optional().describe("Number of consecutive days starting at date. Default 1."),
  after: z
    .string()
    .optional()
    .describe(
      '"now", "HH:MM" (24h), or "none". Defaults to "now" only when the range is exactly today — otherwise defaults to "none". IMPORTANT: "now" means the literal current moment, not "this evening" — for "tonight" pass after="17:00" explicitly, or a 2pm request will surface 3pm matinees.',
    ),
  before: z.string().optional().describe('"HH:MM" (24h) or "none". Upper bound on start time.'),
  format: z.string().optional().describe(`Comma subset of ${FORMAT_ORDER.join(",")}. Omit for all formats.`),
  movie: z.string().optional().describe("Filter to showtimes whose title contains this substring, case-insensitive."),
  compact: z.boolean().optional().describe("When true, omit derivable/false-valued fields to shrink the response. Default false."),
});

function toSearchParams(args: z.infer<typeof inputSchema>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  return sp;
}

const TOOL_DESCRIPTION = `Get real, current AMC movie showtimes near a location or at specific theatres, from the live AMC Theatres API. Use whenever the user asks what's playing, what's on tonight/tomorrow/this weekend, what's showing at a specific AMC, what time a film plays, or wants help picking a movie.

RULES — this tool exists specifically so you never have to guess:
- Report only what the result contains. A null/absent field means AMC didn't provide it — say "not listed," never fill it in. There is no plot, cast, or review data anywhere in this tool; decline those or clearly separate them from the live data.
- Never construct or guess a booking URL. Only paste a bookUrl that appears verbatim in the result. No bookUrl means the show is not bookable (sold out, started, or sales closed) — say which, using the soldOut/passed fields.
- If nothing is set for theatre/near/city/zip, or if the user hasn't said where they are and you have no saved location for them, ASK where they are first. Do not guess a city. Once they answer, remember it for later turns/sessions.
- "tonight" is NOT after="now" — see the after parameter's description. Getting this wrong surfaces matinees as "tonight's options."
- If the result lists unresolvedInput with status "ambiguous", show the candidates and ask which theatre they mean. Never pick one yourself.
- The four theatre statuses (no-showtimes / filtered-empty / closed / error) mean different things — read statusDetail and say which applies. "error" means the AMC call failed; never report that as "nothing is playing."
- If the tool call itself fails, say so. Do not fall back to training data for showtimes.`;

const SERVER_INSTRUCTIONS = `This server has one tool, get_showtimes, backed by the live AMC Theatres API (api.amctheatres.com) via a snapshot of all AMC theatre locations for name/city/zip/distance resolution. Every value it returns is a fact from that API at the moment of the call — nothing is inferred, and the tool's own description explains exactly what to do with ambiguous or missing data. Prefer this tool's data over anything you already believe about current showtimes, which cannot be current.`;

const handler = createMcpHandler((server) => {
  server.registerTool(
    "get_showtimes",
    {
      title: "AMC Showtimes",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    async (args) => {
      const parsed = parseShowtimesQuery(toSearchParams(args));
      if (!parsed.ok) {
        return {
          content: [{ type: "text" as const, text: `${parsed.error}\n\n${parsed.hint}` }],
          isError: true,
        };
      }

      let result;
      try {
        result = await getShowtimesPayload(parsed.query);
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `The showtimes lookup failed: ${(e as Error).message}. This is a tool failure, not an empty result — do not report it as "no showtimes."`,
            },
          ],
          isError: true,
        };
      }
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: `${result.error}\n\n${result.hint}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: renderShowtimesText(result.payload) }] };
    },
  );
}, {
  serverInfo: { name: "amc-showtimes", version: "1.0.0" },
  instructions: SERVER_INSTRUCTIONS,
});

export { handler as GET, handler as POST, handler as DELETE };
