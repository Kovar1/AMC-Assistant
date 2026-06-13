-- Table privileges for the `authenticated` role. RLS decides WHICH rows a user may touch;
-- these GRANTs allow the role to access the tables at all. Raw CREATE TABLE migrations don't
-- auto-grant the way the Supabase dashboard table editor does, so without this every query
-- fails with "permission denied" even when RLS would allow the row.
grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.preferences to authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;

-- allowed_users is intentionally NOT granted to authenticated — it stays locked down so only
-- the SECURITY DEFINER signup check (Phase 5) and the service role can read it.
