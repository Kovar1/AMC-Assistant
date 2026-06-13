# AMC Assistant

Multi-user AMC showtime app: browse tonight's board at your theatres, heart movies into a
watchlist, and book showtimes in your preferred formats and times.

**The app lives in [`web/`](web/README.md)** — Next.js on Vercel, Supabase for auth and
per-user data (Postgres + row-level security), invite-only signup enforced in the database.
Setup, testing, and deployment docs are in [web/README.md](web/README.md).

## Legacy

The Python files at the repo root (`app.py`, `assistant.py`, `core.py`, `amc.py`, …) are the
original single-user Flask version, replaced by `web/`. They're kept temporarily because
`web/scripts/import-state.mjs` reads `state.json` for the one-time data import; once that
import is done they can be deleted (history keeps them).
