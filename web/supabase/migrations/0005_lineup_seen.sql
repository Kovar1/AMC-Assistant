-- Daily digest memory. Idempotent (safe to re-run).
--
-- One row per (theatre, movie) that the digest has seen playing, with the first and most recent
-- date it was seen. lib/amc-logic.ts buildDigest reports a movie as new at a theatre when it has
-- no row here or its last_seen is older than the lookback window — "wasn't playing there before",
-- not "released recently". Service-role only, like `notified`.
create table if not exists public.lineup_seen (
  theatre_id int not null,
  movie_id int not null,
  movie_name text,
  first_seen date not null,
  last_seen date not null,
  primary key (theatre_id, movie_id)
);
create index if not exists lineup_seen_theatre_idx on public.lineup_seen (theatre_id, last_seen desc);
alter table public.lineup_seen enable row level security;
-- RLS on, no policies, no grants to anon/authenticated => only the service role touches it.
-- 0004's blanket grant ran before this table existed, so grant it explicitly.
grant all on public.lineup_seen to service_role;

notify pgrst, 'reload schema';
