-- Phase 5: invite-only signup, enforced at the DB layer. Idempotent (safe to re-run).

-- Emails are compared case-insensitively everywhere; normalize anything already present.
update public.allowed_users set email = lower(email) where email <> lower(email);

-- Friendly pre-check for the signup form. SECURITY DEFINER so the anon role can ask
-- "is this email invited?" without having any read access to allowed_users itself.
-- (Originally named is_email_allowed; renamed because PostgREST permanently cached a
-- stale "no execute" ACL for that name and 403'd it even after schema reloads.)
drop function if exists public.is_email_allowed(text);
create or replace function public.invite_check(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users where email = lower(trim(check_email))
  );
$$;
-- NOTE: do NOT revoke PUBLIC execute on this function. Supabase's PostgREST rejects the
-- RPC with 403 "permission denied" when only anon/authenticated hold grants, even though
-- Postgres itself allows the call (verified empirically). PUBLIC execute is fine here:
-- the function exposes nothing beyond the boolean that anon is meant to receive.
grant execute on function public.invite_check(text) to public, anon, authenticated;

-- Hard enforcement: block the INSERT into auth.users itself, so every signup path
-- (SDK, REST, anything) is gated server-side — no client can bypass it.
create or replace function public.enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_users constant int := 25; -- hard cap on total accounts
begin
  if not exists (select 1 from public.allowed_users where email = lower(new.email)) then
    raise exception 'signup not allowed: % is not on the invite list', new.email;
  end if;
  if (select count(*) from auth.users) >= max_users then
    raise exception 'signup not allowed: user cap reached';
  end if;
  update public.allowed_users
    set accepted_at = now()
    where email = lower(new.email) and accepted_at is null;
  return new;
end;
$$;

drop trigger if exists before_user_invite_check on auth.users;
create trigger before_user_invite_check
  before insert on auth.users
  for each row execute function public.enforce_invite_only();

-- PostgREST caches the schema; without this, rpc('is_email_allowed') 404s until restart.
notify pgrst, 'reload schema';
