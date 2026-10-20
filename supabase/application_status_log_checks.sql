-- ---------------------------------------------------------------------------
-- Read-only checks for the append-only application status log (RQ2).
--
-- Run these after applying 20261014000002_add_application_status_log.sql. None of
-- them modify data; they only surface what a reviewer should look at.
-- ---------------------------------------------------------------------------

-- 1. A status change with no recorded human actor. Only the scheduled/system
--    path should ever store actor_role 'system' with a null actor_id.
select *
from public.application_status_log
where actor_role is null
   or (actor_role <> 'system' and actor_id is null);

-- 2. A live application that has advanced past Draft but has no log row at all
--    (its history was never captured, e.g. it predates the trigger).
select a.id, a.status, a.updated_at
from public.applications a
where a.status <> 'Draft'
  and not exists (
    select 1 from public.application_status_log l where l.application_id = a.id
  );

-- 3. The application's current status disagrees with its newest log row.
select a.id, a.status, l.to_status, l.created_at
from public.applications a
join lateral (
  select to_status, created_at
  from public.application_status_log
  where application_id = a.id
  order by created_at desc
  limit 1
) l on true
where l.to_status <> a.status;

-- 4. RLS sanity: the log must expose SELECT only (no INSERT/UPDATE/DELETE
--    policies; inserts happen through the security-definer trigger).
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'application_status_log'
order by policyname;
