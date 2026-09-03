-- A "dependent" is the person a family provides care for. One family can
-- have several dependents; several caregivers/family members share the work.
-- Run in the Supabase SQL editor.

create table if not exists public.dependents (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  name       text not null,
  relation   text,               -- free text: "Mother", "Son", ...
  created_at timestamptz not null default now()
);

alter table public.dependents disable row level security;

create index if not exists idx_dependents_family on public.dependents(family_id);

-- seed the existing demo dependent for the Demo Family
insert into public.dependents (family_id, name, relation)
select id, 'Lakshmi', 'Mother'
from public.families
where invite_code = 'AMARA-DEMO'
  and not exists (
    select 1 from public.dependents d
    where d.family_id = families.id and d.name = 'Lakshmi'
  );
