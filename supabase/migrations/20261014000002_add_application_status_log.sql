-- ---------------------------------------------------------------------------
-- Append-only application status log (RQ2 audit trail).
--
-- The browser writes `applications.timeline` (JSON) with a role label as the
-- actor, and Admissions Office staff have `for all` access to applications, so
-- the timeline is not a trustworthy record of who changed a status. This table
-- records every status change from an AFTER UPDATE trigger instead:
--   * actor_id is auth.uid() and actor_role comes from current_profile_role();
--   * a system move (service role / scheduled job) carries a null actor_id and
--     actor_role 'system';
--   * nothing may update or delete a row, and only the trigger inserts.
-- ---------------------------------------------------------------------------
create table if not exists public.application_status_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  from_status text,
  to_status text not null,
  actor_id uuid,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists application_status_log_application_id_idx
  on public.application_status_log (application_id, created_at);

create or replace function public.log_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.status is distinct from old.status then
    -- Best-effort reason: the newest timeline note recorded for the new status.
    select e.value ->> 'note'
      into v_reason
      from jsonb_array_elements(coalesce(new.timeline, '[]'::jsonb)) with ordinality as e(value, ord)
      where e.value ->> 'stage' = new.status
      order by e.ord desc
      limit 1;

    insert into public.application_status_log (application_id, from_status, to_status, actor_id, actor_role, reason)
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      coalesce(public.current_profile_role(), 'system'),
      v_reason
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_application_status_change on public.applications;
create trigger log_application_status_change
  after update on public.applications
  for each row execute function public.log_application_status_change();

alter table public.application_status_log enable row level security;

-- Staff read; the Admissions Office sees every row, a Chair only rows for
-- applications from their own department.
drop policy if exists "status_log_staff_read" on public.application_status_log;
create policy "status_log_staff_read" on public.application_status_log
for select using (
  public.current_profile_role() = 'admissions_office'
  or (
    public.current_profile_role() = 'department_chair'
    and exists (
      select 1 from public.applications a
      join public.profiles p on p.user_id = a.student_id
      where a.id = application_status_log.application_id
        and p.department = public.current_profile_department()
    )
  )
);

-- A student reads only their own applications' history.
drop policy if exists "status_log_student_read" on public.application_status_log;
create policy "status_log_student_read" on public.application_status_log
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_status_log.application_id
      and a.student_id = auth.uid()
  )
);

-- No insert/update/delete policies: rows are written only by the
-- security-definer trigger, and can never be edited or removed.
