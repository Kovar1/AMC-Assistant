# amc-showtimes — Claude Skill

Lets Claude answer "what's playing tonight?" from live AMC data instead of from training data.
Nothing about it is user-specific: it asks where you are the first time, remembers the answer, and
works for anyone in range of an AMC.

## Install on claude.ai

1. Build the zip (`SKILL.md` has to sit at the archive root, which this handles):

   ```bash
   npm --prefix web run skill:zip
   ```

   Output: `skills/amc-showtimes.zip`.

2. claude.ai → Settings → Capabilities → Skills → **Upload skill** → pick the zip.
3. Ask *"feeling a movie tonight, what's on near me?"*

## What it depends on

The public endpoint at `https://amc-assistant.vercel.app/api/showtimes`, served by this repo's
`web/` app. No key, no auth — the skill just fetches a URL.

If you fork this, change the base URL in `SKILL.md` and `references/api.md` to your own deployment.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | Trigger description, the location-then-remember flow, and the rules that keep answers grounded |
| `references/api.md` | Full query contract and every response field |
| `references/finding-theatres.md` | How locations and names resolve; what to do when ambiguous |

## The design in one line

The endpoint is stateless and factual; the skill is where personalization lives. That split is why
the same skill works for everybody, and why an answer can always be traced back to a payload field.

## Checking it behaves

Worth testing after any edit to `SKILL.md`:

1. "What's on tonight?" with no saved location → must **ask** where you are, not guess a city.
2. Answer with a city → should call `after=17:00` (not `after=now`) and lead with the data
   timestamp.
3. New conversation, same question → should reuse the remembered location and say which it used.
4. Name an ambiguous theatre ("plaza") → must list candidates and ask, not pick.
5. "Get me tickets for the 9:45" → must paste a link that appears verbatim in the payload.
6. Ask for a film's plot or whether it's good → must not present training data as AMC data.
7. Somewhere with no nearby AMC → must say so and offer a wider radius, not invent a theatre.
