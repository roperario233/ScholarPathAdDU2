-- Keep release coverage addressable by application while preventing students
-- from reading the other applicants' UUIDs stored in results_releases arrays.
create table if not exists public.results_release_applications (
  release_id uuid not null references public.results_releases(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  primary key (release_id, application_id)
);

create index if not exists results_release_applications_application_idx
  on public.results_release_applications (application_id, release_id);

alter table public.results_release_applications enable row level security;
revoke all on public.results_release_applications from public, anon, authenticated;

create index if not exists results_releases_application_ids_gin
  on public.results_releases using gin (application_ids);

create or replace function public.sync_results_release_applications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.application_ids is not distinct from old.application_ids then
    return new;
  end if;

  -- application_ids is a plain array with no foreign key, so it can still name an
  -- application that was deleted later; only existing applications are covered.
  delete from public.results_release_applications where release_id = new.id;
  insert into public.results_release_applications (release_id, application_id)
  select new.id, covered.application_id
  from unnest(coalesce(new.application_ids, '{}'::uuid[])) as covered(application_id)
  join public.applications a on a.id = covered.application_id
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.sync_results_release_applications() from public, anon, authenticated;

drop trigger if exists sync_results_release_applications on public.results_releases;
create trigger sync_results_release_applications
  after insert or update of application_ids on public.results_releases
  for each row execute function public.sync_results_release_applications();

-- Backfill the existing releases. An id in the old array whose application has
-- since been deleted (for example by the transactional-data reset) has nothing to
-- cover, so only applications that still exist are copied.
insert into public.results_release_applications (release_id, application_id)
select r.id, covered.application_id
from public.results_releases r
cross join lateral unnest(coalesce(r.application_ids, '{}'::uuid[])) as covered(application_id)
join public.applications a on a.id = covered.application_id
on conflict do nothing;

create or replace function public.can_read_application_result_release(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.results_release_applications coverage
    join public.applications a on a.id = coverage.application_id
    where coverage.application_id = p_application_id
      and (
        public.current_profile_role() in ('admissions_office', 'admissions_admin')
        or (public.current_profile_role() = 'student' and a.student_id = auth.uid())
        or (
          public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
          and public.reviewer_scopes_to_student(a.student_id)
        )
      )
  );
$$;

revoke all on function public.can_read_application_result_release(uuid) from public, anon;
grant execute on function public.can_read_application_result_release(uuid) to authenticated;

-- Same rule as 20261061000000 (a student reads the figure only for their own
-- offer, or a pre-waitlist released result, never while waitlisted); only the
-- direct results_releases read is swapped for the normalized coverage check,
-- because authenticated callers can no longer select that table.
drop policy if exists "grant_amounts_student_released_read" on public.application_grant_amounts;
create policy "grant_amounts_student_released_read" on public.application_grant_amounts
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_grant_amounts.application_id
      and a.student_id = auth.uid()
      and (
        exists (select 1 from public.scholarship_offers o where o.application_id = a.id)
        or (
          a.status = 'Released'
          and public.can_read_application_result_release(a.id)
        )
      )
  )
);

-- The table array remains for trusted internal functions, but authenticated
-- callers must use the scoped RPC below. Filtering the release row alone would
-- still disclose every UUID in its application_ids array.
drop policy if exists "results_releases_read" on public.results_releases;
revoke select on public.results_releases from public, anon, authenticated;

drop function if exists public.get_scoped_results_releases();
create function public.get_scoped_results_releases(p_since timestamptz default null)
returns table (
  id uuid,
  scholarship_id uuid,
  released_at timestamptz,
  released_by uuid,
  applicant_count integer,
  accepted_count integer,
  application_ids uuid[],
  kind text
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select auth.uid() as user_id, public.current_profile_role() as role
  )
  select
    r.id,
    r.scholarship_id,
    r.released_at,
    r.released_by,
    r.applicant_count,
    r.accepted_count,
    coalesce(visible.application_ids, '{}'::uuid[]),
    r.kind
  from public.results_releases r
  cross join caller c
  cross join lateral (
    select array_agg(coverage.application_id order by coverage.application_id) as application_ids
    from public.results_release_applications coverage
    join public.applications a on a.id = coverage.application_id
    where coverage.release_id = r.id
      and (
        c.role in ('admissions_office', 'admissions_admin')
        or (c.role = 'student' and a.student_id = c.user_id)
        or (
          c.role in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
          and public.reviewer_scopes_to_student(a.student_id)
        )
      )
  ) visible
  where (p_since is null or r.released_at > p_since)
    and (
      c.role in ('admissions_office', 'admissions_admin')
    -- Closing releases apply at scholarship level. An applicant with an offer
    -- must see that round metadata even when their own accepted application is
    -- not part of the closing coverage; the returned UUID array remains owner-
    -- scoped below.
    or (
      c.role = 'student'
      and exists (
        select 1 from public.applications own_app
        where own_app.scholarship_id = r.scholarship_id
          and own_app.student_id = c.user_id
      )
    )
    or exists (
      select 1
      from public.results_release_applications coverage
      join public.applications a on a.id = coverage.application_id
      where coverage.release_id = r.id
        and (
          (c.role = 'student' and a.student_id = c.user_id)
          or (
            c.role in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
            and public.reviewer_scopes_to_student(a.student_id)
          )
        )
    )
    )
  order by r.released_at asc;
$$;

revoke all on function public.get_scoped_results_releases(timestamptz) from public, anon;
grant execute on function public.get_scoped_results_releases(timestamptz) to authenticated;
