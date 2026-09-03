-- Emergency escalation: one emergency contact per family (not a login),
-- plus the alert / acknowledgment / final-tier markers on the task.
-- Run in the Supabase SQL editor.

alter table public.families
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_info text;

alter table public.tasks
  add column if not exists emergency_alerted_at  timestamptz,
  add column if not exists emergency_ack_token   text,
  add column if not exists emergency_acked_at    timestamptz,
  add column if not exists emergency_final_at    timestamptz;   -- contact never responded

create index if not exists idx_tasks_emergency  on public.tasks(emergency_alerted_at);
create index if not exists idx_tasks_ack_token  on public.tasks(emergency_ack_token);
