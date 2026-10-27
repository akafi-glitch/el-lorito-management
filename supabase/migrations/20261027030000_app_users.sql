-- Phase 1: administrator accounts.
-- Passwords are NOT stored here. Supabase Auth (auth.users) keeps only a secure hash.
-- This table decides who may use the app and whether the account is turned on.

create table public.app_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  username     text not null,
  display_name text not null,
  is_active    boolean not null default true,
  created_by   uuid references public.app_users (user_id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint app_users_username_format
    check (username ~ '^[a-z0-9][a-z0-9.-]{2,31}$'),
  constraint app_users_display_name_length
    check (char_length(btrim(display_name)) between 1 and 80)
);

create unique index app_users_username_key on public.app_users (username);

comment on table public.app_users is
  'Administrator accounts allowed to sign in. Linked one-to-one to auth.users. No passwords stored here.';

-- Keep updated_at current on every change.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- Row Level Security on, with NO policies for browser roles: browsers can never read or write
-- this table directly. The Next.js server reads it with the secret key after checking the session.
alter table public.app_users enable row level security;
revoke all on table public.app_users from anon, authenticated;
