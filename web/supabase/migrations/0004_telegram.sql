-- Phase 8a: Telegram linking + alert tables. Idempotent (safe to re-run).

-- ===== profiles.telegram_chat_id already exists (0001). Guard the role column. =====
-- profiles_update_own lets a user update their own row; without this they could set
-- role='admin'. Block role changes that come in through the authenticated (API) role.
-- SECURITY INVOKER (the default): the trigger only raises, so it needs no elevated rights —
-- and crucially, under SECURITY DEFINER `current_user` would be the owner, not the caller,
-- so the role check would never fire.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and current_user = 'authenticated' then
    raise exception 'changing role is not allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ===== link tokens (single-use deep link: t.me/<bot>?start=<token>) =====
create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.telegram_link_tokens enable row level security;

drop policy if exists tlt_insert_own on public.telegram_link_tokens;
create policy tlt_insert_own on public.telegram_link_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists tlt_select_own on public.telegram_link_tokens;
create policy tlt_select_own on public.telegram_link_tokens
  for select using (auth.uid() = user_id);

grant select, insert on public.telegram_link_tokens to authenticated;
-- The webhook consumes tokens via the service role (RLS bypassed).

-- ===== notified (per-user dedupe memory; service-role only) =====
create table if not exists public.notified (
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id int not null,
  theatre_id int not null,
  showtime_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id, theatre_id, showtime_id)
);
alter table public.notified enable row level security;
-- RLS on, no policies, no grants => only the service role touches it (like allowed_users).

-- ===== alerts (sent-alert log; service-role writes, owner reads) =====
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id int,
  movie_name text,
  theatre_name text,
  shows text[] not null default '{}',
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts (user_id, created_at desc);
alter table public.alerts enable row level security;

drop policy if exists alerts_select_own on public.alerts;
create policy alerts_select_own on public.alerts
  for select using (auth.uid() = user_id);

grant select on public.alerts to authenticated;

-- ===== service_role backend grants =====
-- The webhook and the alert cron act as service_role (it bypasses RLS) but still need table
-- privileges — raw migrations don't grant them the way the dashboard would. Without this every
-- service_role query fails "permission denied". Granted after all tables exist so it covers them.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

notify pgrst, 'reload schema';
