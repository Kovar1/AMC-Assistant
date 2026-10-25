# Finding the right theatre

Resolution runs entirely against a bundled snapshot of every AMC location, so it is deterministic:
the same input always gives the same answer, and an input that could mean several theatres comes
back as a question rather than a guess.

## By location — the usual path

```
?near=brooklyn          a neighbourhood, city, or metro
?near=40.6782,-73.9442  explicit coordinates
?zip=07652              exact postal code
?city=chicago           city, market, or state
```

A place resolves in this order: coordinates → zip → city → market → state. Common nicknames work
(`nyc`, `la`, `sf`, `philly`, `vegas`, `dc`, `atl`, `chi`, `nola`, `dfw`).

Control the spread with `radius` (default 25 miles) and `limit` (default 3 theatres).

**Nothing came back?** The message will say whether the place didn't match at all, or matched but
had no theatre within the radius. For the second case, retry with `radius=50` and tell the user
you widened it. For the first, the user may be somewhere AMC doesn't operate — say so; don't
substitute a nearby city on your own.

State names are handled specially: `city=texas` returns the nearest few theatres in Texas rather
than nothing, because a state's centre point can be a hundred miles from any cinema.

## By name

```
?theatre=2253                       AMC id — always exact
?theatre=amc-garden-state-plaza-16  slug
?theatre=garden state plaza         distinctive substring
?theatre=2253,557                   up to 5
```

Order of attempts: numeric id → exact slug or full name → substring.

A substring matching **one** theatre resolves. Matching **several** returns `ambiguous` with up to
8 candidates and fetches nothing:

```json
{
  "input": "plaza",
  "status": "ambiguous",
  "message": "8 AMC theatres match \"plaza\". No showtimes were fetched for it — ask the user which one they mean.",
  "candidates": [{ "id": 63, "name": "AMC Headquarters Plaza 10", "city": "MORRISTOWN", "state": "NJ" }]
}
```

List the candidates, ask which, then re-query with that id. **Do not pick for them** — not the
first, not the nearest, not the one that seems obvious from context. Two theatres a user might
plausibly mean is exactly the case this exists to catch.

## Saving what you learn

Once the user confirms their theatres, save both the place and the resolved ids to memory, e.g.
*"Usual AMC theatres: Paramus NJ area — 2253 (Garden State Plaza 16), 557 (DINE-IN Shops at
Riverside 9), 2729 (Palisades 21)"*.

Ids are the best thing to store: they never go ambiguous, and `?theatre=2253,557,2729` skips
location resolution entirely on later queries.

If a user has more than one place they go — home and a city they visit — save them as named groups
and ask which they mean when it's unclear.

## Staleness

`indexGeneratedAt` in the response says when the theatre catalogue was captured. A theatre that
opened after that date won't resolve. If a user insists a theatre exists and it isn't found, that
is the likely reason — say so rather than telling them it doesn't exist.
