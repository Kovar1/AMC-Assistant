# AMC Personal Showtime Assistant

A single-user, AMC-styled app for your own theatres. Browse tonight's board, mark movies
you want to see, and get a Telegram ping the moment showtimes drop in your preferred
formats and times — with a one-tap link straight to AMC's booking page for that showtime.

Two halves share one `state.json`:

- **`app.py`** — a small Flask web UI (run on demand). Onboarding, the movie board, the
  poster grid where you pick movies, your watchlist, and settings.
- **`assistant.py`** — the cron job. Refreshes movie feeds, drops stale movies, and sends
  Telegram drop-alerts. No UI.

Built on AMC's read-only catalog/showtime API (no ticketing/seating access needed).

## Files

| File | Job |
| --- | --- |
| `amc.py` | Read-only AMC API client (theatres, showtimes, movie views, theatre search). |
| `core.py` | Shared state + logic: prefs, formats, board/watchlist building, movie lifecycle. |
| `app.py` | Flask web UI. |
| `assistant.py` | Cron entrypoint (Telegram alerts). |
| `templates/`, `static/style.css` | AMC-themed UI (dark, red `#fb0102`, real posters). |
| `state.json` | All your config + memory. Created on first run. |

## Setup

1. Put your key in `.env`:

   ```text
   AMC_VENDOR_KEY=your-key-here
   ```

2. Install Flask: `pip install flask`

3. (Optional, for pings) create a Telegram bot via [@BotFather](https://t.me/BotFather) and add:

   ```text
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=your-numeric-chat-id
   ```

   Without these, alerts print to the console instead of sending.

## Use the app

```powershell
python app.py
```

Open <http://localhost:5000>. First visit walks you through **onboarding** (search your
theatres, pick formats/time/party size). Then:

- **Tonight** — movies playing tonight at your theatres, grouped by theatre, with Book links.
- **Movies** — poster grid of now-playing + coming-soon. Tap a ♥ to watch a movie (works
  for upcoming titles too). Change your mind anytime by tapping again.
- **Watchlist** — your watched movies and whether matching showtimes have dropped yet.
- **Settings** — edit preferences whenever.

## Run the alerter on a schedule

```powershell
python assistant.py        # one cycle: refresh, drop stale, alert on NEW matches
```

It's idempotent (alerts only on showtimes it hasn't sent before, tracked in `state.json`).
Schedule it with Windows Task Scheduler, e.g. every 30 minutes:

```powershell
schtasks /create /tn "AMC Assistant" /tr "python `"$PWD\assistant.py`" run" /sc minute /mo 30 /st 09:00
```

## How the watchlist lifecycle works

- Marking a movie sets `watch` on its entry in `state.json`.
- Every cycle, each movie currently in AMC's coming-soon / now-playing / advance feeds gets
  its `last_seen` stamped to today.
- Any movie that hasn't appeared in **any** feed for **7 days** is dropped entirely — from
  the watchlist, the cache, and the alert memory. Nothing lingers forever.

## Roadmap

- **Now:** AMC-styled board, poster picker with watch toggles, format/time-filtered Telegram
  drop-alerts, one-tap booking, 7-day auto-cleanup.
- **Next:** seat-preference hierarchy + best-seat pre-selection — activates automatically if
  your key gains AMC Seating API access (currently returns 404).
