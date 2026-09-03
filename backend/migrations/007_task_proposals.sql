-- Family votes on deleting or rescheduling a task. Run in the SQL editor.

create table if not exists public.task_proposals (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  proposed_by uuid not null references public.users(id) on delete cascade,
  kind        text not null,          -- 'delete' | 'reschedule'
  new_date    date,                   -- a specific reschedule target
  new_window  text,                   -- 'today'|'tomorrow'|'this_week'|'next_week'|'this_month'
  votes       jsonb not null default '{}'::jsonb,   -- { "<userId>": "approve" | "reject" }
  status      text not null default 'open',         -- 'open'|'approved'|'rejected'|'cancelled'
  created_at  timestamptz not null default now()
);

alter table public.task_proposals disable row level security;

create index if not exists idx_proposals_family on public.task_proposals(family_id);
create index if not exists idx_proposals_status on public.task_proposals(status);
