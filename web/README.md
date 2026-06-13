# AMC Assistant (web)

Multi-user AMC showtime app: browse tonight's board at your theatres, heart movies into a
watchlist, and book showtimes in your preferred formats and times. Next.js (App Router) on
Vercel, Supabase for auth + per-user data (Postgres with row-level security), invite-only
signup enforced in the database.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in (Supabase dashboard → Settings → API,
   plus your AMC vendor key). Never commit real values.
3. Apply migrations and verify the schema, RLS, and triggers:

   ```powershell
   npm run db:setup
   ```

4. Invite yourself (signup is closed to everyone else):

   ```powershell
   node --env-file=.env.local scripts/invite.mjs you@example.com
   ```

5. `npm run dev` → <http://localhost:3000> → sign up, then onboarding asks for your
   theatres and formats.

One-time import of the old single-user `state.json` (after you've signed up):

```powershell
node --env-file=.env.local scripts/import-state.mjs you@example.com
```

## Checks

| Command | What |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests + live security suite (invite gate, RLS cross-user isolation). The live suite runs against the Supabase project in `.env.local` and skips itself when those vars are absent (e.g. CI). |
| `npm run build` | Production build |

CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests on every push and PR.

## Security model

- **Auth**: Supabase email/password; cookie sessions via `@supabase/ssr`; `proxy.ts`
  refreshes the session and redirects logged-out users to `/login`.
- **Isolation**: RLS on `profiles` / `preferences` / `watchlist` — every policy is
  `auth.uid()`-scoped, so a user can only touch their own rows even if they hit the REST
  API directly. `tests/rls.test.ts` proves this with real id-swap attempts.
- **Invite gate**: a `BEFORE INSERT` trigger on `auth.users` rejects emails not in
  `allowed_users` (plus a hard account cap), so no client can bypass it. The
  `allowed_users` table has no grants and no policies — unreadable from the API; the
  signup form's friendly pre-check goes through the SECURITY DEFINER `invite_check()` RPC.
- **Secrets**: only in `.env.local` locally and Vercel env vars in production.
  `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are never used by app routes — scripts
  and (later) the alert cron only.

## Deploying to Vercel

1. Vercel → Add New Project → import this GitHub repo.
2. **Root Directory: `web`** (Framework preset: Next.js — auto-detected).
3. Environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `AMC_VENDOR_KEY`
   - `NEXT_PUBLIC_SITE_URL` = your production URL (e.g. `https://yourapp.vercel.app`)
   - (`SUPABASE_SERVICE_ROLE_KEY` not needed until the Phase 8 alerter)
4. Supabase dashboard → Authentication → URL Configuration: set **Site URL** to the same
   production URL and add `https://yourapp.vercel.app/auth/confirm` to **Redirect URLs**
   (password-reset emails link through there).
5. Migrations are applied from your machine via `npm run db:setup` — run it **before**
   deploying any change that needs new schema.
6. Production deploys from `main`; every PR gets a preview URL. Preview deploys share the
   production Supabase project — signup stays invite-gated there too.

## Phase 8 (planned)

Per-user Telegram alerts: a `t.me` deep-link flow stores each user's chat id in
`profiles.telegram_chat_id`, and a scheduled job (Vercel Cron or Supabase Edge Function,
service role) sends drop-alerts per user. Replaces the old single-user GitHub Actions cron.
