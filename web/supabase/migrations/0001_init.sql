-- Phase 2: multi-user schema + RLS + triggers. Idempotent (safe to re-run).

-- ========================= tables =========================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user',
  telegram_chat_id text,                       -- per-user Telegram link (Phase 8)
  created_at timestamptz not null default now()
);

create table if not exists public.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theatres jsonb not null default '[]'::jsonb, -- [{id, name}]
  formats text[] not null default '{}',
  earliest_hour int not null default 18,
  weekends_only boolean not null default false,
  party_size int not null default 2,
  lookahead_days int not null default 7,
  onboarded boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id int not null,
  name text,
  poster text,
  release text,
  created_at timestamptz not null default now(),
  unique (user_id, movie_id)
);
create index if not exists watchlist_user_idx on public.watchlist (user_id);

create table if not exists public.allowed_users (
  email text primary key,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- ========================= RLS =========================

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.watchlist enable row level security;
alter table public.allowed_users enable row level security;

-- profiles: a user can read/update only their own row (insert is via trigger).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- preferences: full CRUD on own row only.
drop policy if exists preferences_all_own on public.preferences;
create policy preferences_all_own on public.preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- watchlist: full CRUD on own rows only.
drop policy if exists watchlist_all_own on public.watchlist;
create policy watchlist_all_own on public.watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- allowed_users: RLS on with NO policies => denied to anon/authenticated.
-- Only the SECURITY DEFINER signup check (Phase 5) and the service role can read it.

-- ============ trigger: auto-create profile + preferences on signup ============

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
  insert into public.preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ trigger: keep preferences.updated_at fresh ============

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists preferences_touch on public.preferences;
create trigger preferences_touch
  before update on public.preferences
  for each row execute function public.touch_updated_at();

-- NOTE: invite-only enforcement (a BEFORE INSERT trigger on auth.users that checks
-- allowed_users) is added in Phase 5, after the owner email is seeded, to avoid locking
-- everyone out before the auth pages exist.
