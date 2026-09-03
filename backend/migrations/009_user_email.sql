-- Store each member's email on public.users so the server can notify the
-- whole family on an emergency escalation (auth.users isn't reachable with
-- the anon key). Filled in at signup. Run in the Supabase SQL editor.

alter table public.users add column if not exists email text;
