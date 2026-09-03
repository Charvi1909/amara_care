-- Handoff requests: scope to a family, track who has declined.
-- Table public.handoff_requests already exists (id, task_id, requested_by,
-- candidate_ids, status, created_at). Run in the SQL editor.

alter table public.handoff_requests
  add column if not exists family_id   uuid references public.families(id) on delete cascade,
  add column if not exists declined_by uuid[] not null default '{}';

alter table public.handoff_requests disable row level security;

create index if not exists idx_handoff_family on public.handoff_requests(family_id);
create index if not exists idx_handoff_status on public.handoff_requests(status);
