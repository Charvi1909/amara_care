-- One-time cleanup: remove ALL seed / test data. Every family, user, task and
-- dependent from here on must come from a real signup. Run in the SQL editor.

-- 1. detach tasks that point at a login-less (seed) user
update public.tasks set assigned_to = null
where assigned_to in (select id from public.users where auth_id is null);

-- 2. clear transient handoff rows (they reference users we're about to delete)
delete from public.handoff_requests;

-- 3. delete every user that was never linked to a login
delete from public.users where auth_id is null;

-- 4. delete families that now have no members (cascades their tasks + dependents)
delete from public.families f
where not exists (select 1 from public.users u where u.family_id = f.id);

-- 5. mop up any tasks / dependents left pointing at a deleted family
delete from public.tasks      where family_id is null or family_id not in (select id from public.families);
delete from public.dependents where family_id not in (select id from public.families);
