-- Link each task to the dependent it is care for. Nullable: a task with no
-- dependent (e.g. a household errand) is still fine.
-- Run in the Supabase SQL editor (after 003).

alter table public.tasks
  add column if not exists dependent_id uuid references public.dependents(id) on delete set null;

create index if not exists idx_tasks_dependent on public.tasks(dependent_id);
