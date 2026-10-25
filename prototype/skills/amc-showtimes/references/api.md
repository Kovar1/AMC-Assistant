# `GET /api/showtimes` — full contract

Base: `https://amc-assistant.vercel.app/api/showtimes`

Public and unauthenticated. No key, no headers, CORS open. Data comes from AMC's own API; the
theatre catalogue is a bundled snapshot of all ~523 AMC locations.

## Query parameters

### Pick theatres — exactly one of these is required

| Param | Accepts | Notes |
|---|---|---|
| `theatre` (or `theater`) | comma list of AMC ids, slugs, or names | max 5 |
| `near` | a place name, or `lat,lng` | pairs with `radius` / `limit` |
| `city` | city, market, or state | |
| `zip` | 5-digit postal code | |

Passing two selectors is a 400 — the API will not choose for you.

### Everything else

| Param | Values | Default |
|---|---|---|
| `radius` | 1–100 (miles) | `25` |
| `limit` | 1–5 theatres from a location search | `3` |
| `date` | `today`, `tomorrow`, a weekday (`fri`/`friday`), or `YYYY-MM-DD` | `today` |
| `days` | 1–7, starting at `date` | `1` |
| `after` | `now`, `HH:MM` (24h), `none` | `now` if the range is exactly today, else `none` |
| `before` | `HH:MM`, `none` | `none` |
| `format` | comma subset of `IMAX,DOLBY,XL,LASER,STANDARD` | none |
| `movie` | title substring, case-insensitive | none |
| `view` | `json`, `text` | `json` |
| `compact` | `1` to drop booking links | `false` |
| `maxPerMovie` | 1–24 | `12` |
| `maxShowtimes` | 1–600 | `400` |

A weekday name resolves to its **next occurrence, counting today** — asking for "tuesday" on a
Tuesday means today.

An unknown `format` or `date` is a **400 with a hint**, never a silent no-op. If the API says it
filtered, it filtered.

## Status codes

| Code | Meaning |
|---|---|
| 200 | Query was valid. May still contain zero theatres — check `summary` and `unresolvedInput`. |
| 400 | Malformed query. Body has `error` and `hint`. |
| 429 | Rate limited (30/min). Body has `hint`; `Retry-After` header is set. |
| 500 | Server failure. **Not** an empty result — do not report it as "nothing playing". |

**A location that matched nothing is still a 200.** Read the body, not the status.

## Response

```jsonc
{
  "ok": true,
  "generatedAt": "2026-08-26T19:04:11",
  "generatedAtLabel": "Wed Aug 26 · 7:04 PM",   // quote this for freshness
  "source": "AMC Theatres public API (api.amctheatres.com)",
  "indexGeneratedAt": "2026-08-26T00:00:00Z",   // when the theatre catalogue was snapshotted
  "disclaimer": "...",
  "query": {
    "dates": ["2026-08-26"], "dateLabels": ["Wed Aug 26"],
    "timezone": "America/New_York",
    "after": "now", "afterResolved": "19:04",   // the concrete cutoff "now" meant
    "before": "none", "formats": [], "movie": null,
    "view": "json", "compact": false, "maxPerMovie": 12, "maxShowtimes": 400
  },
  "resolvedLocation": {                          // only for near/city/zip
    "input": "brooklyn", "matchedBy": "city",
    "centre": { "lat": 40.69, "lng": -73.99 }, "radiusMiles": 25
  },
  "summary": {
    "theatresRequested": 1, "theatresResolved": 3,
    "theatresAmbiguous": 0, "theatresUnresolved": 0,
    "movies": 11, "showtimes": 47, "truncated": false
  },
  "warnings": ["..."],                           // surface these to the user
  "theatres": [ /* see below */ ],
  "unresolvedInput": [ /* see below */ ]
}
```

### `theatres[]`

Only theatres that actually resolved. A failed lookup is **never** here.

| Field | Meaning |
|---|---|
| `id`, `name`, `city`, `state` | canonical AMC values |
| `timezone` | IANA zone; times below are local to it |
| `distanceMiles` | from the search centre; `null` when theatres were named directly |
| `matchedInput`, `resolvedBy` | what you asked for, and how it matched (`id`/`exact`/`name`/`near`) |
| `status` | `ok` · `no-showtimes` · `filtered-empty` · `closed` · `error` |
| `statusDetail` | a full sentence you can quote |
| `counts` | `{ beforeFilters, returned, movies }` — proves which empty state applies |
| `dates[]` | `{ date, dateLabel, movies[] }` |

### `movies[]`

`movieId`, `title`, `rating`, `runtimeMinutes`, `genre`, `movieUrl`, `showtimeCount`,
`showtimesTruncated`, `showtimes[]`. **Any of the metadata may be `null`** — that means AMC didn't
provide it. There is no plot, cast, or review data anywhere in this API.

### `showtimes[]`

| Field | Meaning |
|---|---|
| `time` | `"9:15 PM"` — quote verbatim |
| `iso` | `"2026-08-26T21:15:00"`, local to the theatre |
| `startsInMinutes` | pre-computed; `null` unless the date is today |
| `format`, `formatLabel` | `LASER` / `"Laser at AMC"` |
| `auditorium` | may be `null` |
| `soldOut`, `almostSoldOut`, `passed` | booleans from AMC |
| `bookable` | `false` when sold out, already started, or sales closed |
| `bookUrl` | the real link, or **`null` when not bookable** — never build one yourself |

In `compact=1` mode only `id`, `time`, `format` and `bookable` are always present; the rest appear
only when they carry information (see Response size below).

### `unresolvedInput[]`

| Field | Meaning |
|---|---|
| `input` | what you passed |
| `status` | `ambiguous` (several matches — ask) or `unresolved` (none) |
| `message` | a full sentence, written to be shown to the user |
| `candidates[]` | `{ id, name, city, state }`, up to 8, for ambiguous matches |

An `ambiguous` entry means **zero showtimes were fetched** for it. Ask which one and re-query with
the chosen id.

## Response size

Measured, from one suburban theatre up to three Manhattan multiplexes:

| Call | 1 theatre | 3 big-city theatres |
|---|---|---|
| `view=text` | 1.7 KB | 5.5 KB |
| `view=json&compact=1` | 6 KB | 23 KB |
| `view=json` | 13 KB | 47 KB |

**Prefer `view=text` for browsing** — it is 5–10x smaller and already formatted for quoting. Reach
for `view=json` only when you need `bookUrl`, and narrow it with `movie=` so you pull one film
rather than the whole board.

`compact=1` omits fields that are derivable, absent, or `false`: no `iso`, `formatLabel`,
`auditorium`, or `bookUrl`, and `soldOut` / `passed` appear only when true. **Absence in compact
mode means "not notable", not "unknown"** — a showtime without `soldOut` is available.
