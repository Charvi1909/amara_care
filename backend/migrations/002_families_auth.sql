-- Multi-family support + Supabase Auth linkage (hackathon-simple: no RLS).
--
-- Run this in the Supabase SQL editor.
-- ALSO: Authentication -> Providers -> Email -> turn OFF "Confirm email",
-- otherwise demo signups cannot log in until they click an email link.

-- 1. families -------------------------------------------------------------
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

-- 2. users: family membership + auth linkage ----------------------------
alter table public.users
  add column if not exists family_id uuid references public.families(id) on delete set null,
  add column if not exists auth_id   uuid unique references auth.users(id) on delete cascade;

-- 3. tasks: family_id (needed to scope UNASSIGNED tasks, which have no user)
alter table public.tasks
  add column if not exists family_id uuid references public.families(id) on delete cascade;

-- 4. (removed) — there is no seed family. Every family is created by a real
--    signup. Any pre-existing user/task with a NULL family_id is stale test
--    data and should be deleted, not adopted. See migrations/005_cleanup.sql.

-- 5. indexes -----------------------------------------------------------
create index if not exists idx_users_family on public.users(family_id);
create index if not exists idx_users_auth   on public.users(auth_id);
create index if not exists idx_tasks_family on public.tasks(family_id);
