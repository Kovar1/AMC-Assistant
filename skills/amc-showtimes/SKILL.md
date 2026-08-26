---
name: amc-showtimes
description: >
  Look up real, current AMC movie showtimes near any location. Use whenever the user asks what's
  playing, what's on tonight or tomorrow or this weekend, what's showing at a specific AMC, what
  time a particular film is playing, whether a movie is still in theatres near them, or wants help
  picking a movie to go see. Also covers "feeling a movie tonight", "movie night", "anything good
  at the theatre", "showtimes", "what's on near me". Always fetches live data from the showtimes
  API; never answers from memory or training data. Do NOT use for streaming or TV availability,
  box-office numbers, reviews, plot summaries, or non-AMC cinemas.
---

# AMC Showtimes

> **Deprecated for claude.ai.** This Skill cannot actually fetch showtimes there — claude.ai's
> `web_fetch` tool refuses to fetch a URL Claude constructs from `?near=...&after=...` parameters,
> which is exactly what browsing instructions below tell it to do. Use the MCP connector at
> `https://amc-assistant.vercel.app/api/mcp` instead (claude.ai → Settings → Connectors → Add
> custom connector). See [README.md](README.md) for why. This file is kept only as documentation
> of the query contract and anti-hallucination rules, which the MCP tool description now carries.

Answer movie-showtime questions from live AMC data. **Every fact you report must come from the API
response.** If it isn't in the payload, you don't know it.

Base URL: `https://amc-assistant.vercel.app/api/showtimes`

The endpoint is public — no key, no auth, no headers. Just fetch the URL.

## The two calls you will make

**Browsing** — the default. Cheap and directly quotable:

```
{BASE}?near=brooklyn&date=today&after=17:00&view=text
```

**Booking or details** — when the user wants a link, or asks about one film:

```
{BASE}?theatre=2253&date=today&movie=dune&view=json
```

Use `view=text` unless you need `bookUrl`. It is roughly a tenth the size.

## Step 1 — figure out where they are

The API has no idea who the user is. You must give it a location.

1. **Check memory first.** If you've saved the user's location or usual theatres before, use it
   and *say which one you used* — "checking your usual theatres around Paramus, NJ" — so they can
   correct you.
2. **If nothing is saved, ask.** A city, neighbourhood, or zip is enough. Do not guess a metro from
   context, from their language, or from anything else in the conversation.
3. **Once they tell you, save it to memory** so later conversations skip the question. Save the
   place and the theatre ids that resolved, not just the raw phrasing.

Never invent a default city. "What's on tonight?" with no known location is a question you ask
back, not one you answer.

## Step 2 — map what they said to a time filter

This is the single easiest thing to get wrong. `after=now` means *right now*, so at 2pm it happily
returns 3pm matinees when the user asked about tonight.

| They say | Use |
|---|---|
| "tonight", "this evening" | `date=today&after=17:00` |
| "right now", "can I still catch something" | `date=today&after=now` |
| "tomorrow" | `date=tomorrow` (omit `after` entirely) |
| "this weekend" | `date=sat&days=2` |
| "Friday" | `date=friday` |
| a specific date | `date=2026-08-29` |

If they name a format ("IMAX", "Dolby"), add `format=IMAX` — but only the exact values
`IMAX,DOLBY,XL,LASER,STANDARD`. Anything else is a 400; ask rather than guess a mapping.

## Step 3 — read the response honestly

The payload is designed so you never have to infer. Use it literally.

**Report only what is there.**
- `runtimeMinutes`, `rating`, `genre`, `distanceMiles`, `time`, `auditorium` are grounded — quote
  them when present.
- A `null` field means "AMC didn't say". Say "not listed". Never fill it in.
- Plot, cast, reviews, whether a film is *good*, what it's similar to — **none of that is in the
  payload.** You may say you don't have it. Do not supply it from training data, even if asked
  directly, without clearly separating it from the live data. ("The API doesn't carry plot
  summaries — I can tell you what I know generally, but that's not from AMC.")

**Never construct a booking URL.** Copy `bookUrl` exactly, or give none. If `bookable` is `false`
there is no link: the show is sold out, already started, or online sales have closed. Say which,
using `soldOut` / `passed`.

**Always state freshness.** Lead with `generatedAtLabel`: "as of Wed Aug 26, 7:04 PM".

**Surface every entry in `unresolvedInput` before answering.**
- `status: "ambiguous"` — list the `candidates` and **ask which one**. Never pick. Never pick "the
  closest" or "the obvious one".
- `status: "unresolved"` — say it didn't match. If the message mentions a radius, offer to widen
  it (`radius=50`).

**Distinguish the empty states out loud** using each theatre's `status`:

| `status` | Say something like |
|---|---|
| `no-showtimes` | "AMC lists nothing at all there on that date." |
| `filtered-empty` | "Nothing after 5pm — there were N earlier showtimes." (use `counts.beforeFilters`) |
| `closed` | "That theatre is listed as closed." |
| `error` | "AMC's API failed for that theatre, so I can't tell you what's on there." |

`error` is **not** "nothing is playing". Never merge those two.

**If `summary.truncated` is true**, say the list was capped and offer a narrower query.

**If the fetch itself fails or returns a non-200**, say so plainly and stop. Do not fall back to
memory or training data for showtimes. Memory holds *where the user is* — never *what is playing*.

## Step 4 — write the answer

- Lead with the freshness line and where you looked.
- Group by theatre, then by film. Quote times verbatim (`"7:45 PM"`, not "quarter to eight").
- Mention format only when it isn't `STANDARD`.
- Keep it scannable. For a big list, lead with a few suggestions and offer the full set.
- If they seem to be deciding, it's fine to note what starts soonest (`startsInMinutes`) or what's
  nearly sold out (`almostSoldOut`) — both are in the payload.

## Reference

- `references/api.md` — the full query contract and every response field.
- `references/finding-theatres.md` — how locations and theatre names resolve, and what to do when
  one is ambiguous.
