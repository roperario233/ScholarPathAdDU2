-- Recorded grant amount per application.
--
-- The school's approving level (approval_levels, SOP step 7) records how much of
-- the grant an applicant receives while the case is at Recommended or Approved:
-- a coverage percent, a peso amount per semester, or both, plus a note. It is a
-- recorded award figure only. The system does not disburse anything.
--
--   1. The figure lives in its own table. A student reads their own applications
--      row with select *, so a column there could not be hidden before release.
--   2. Reads: the Admissions Office (Staff and Admin), the scoped approving level,
--      and the owning student only once a results_releases row covers the
--      application (the same rule that lifts the "Under deliberation" hold).
--   3. Writes: set_application_grant_amount() only. It is security definer and
--      re-checks that the caller holds the level approver_role_for_student()
--      resolves for the applicant, that the applicant is in the caller's scope,
--      and that the case is still Recommended or Approved. There is no client
--      write policy. The Admin and Staff read only.

create table if not exists public.application_grant_amounts (
  application_id uuid primary key references public.applications(id) on delete cascade,
  coverage_percent numeric(5, 2) check (coverage_percent is null or (coverage_percent >= 0 and coverage_percent <= 100)),
  amount_per_semester numeric(12, 2) check (amount_per_semester is null or amount_per_semester >= 0),
  note text check (note is null or char_length(note) <= 500),
  set_by uuid references public.profiles(user_id) on delete set null,
  set_by_role text,
  updated_at timestamptz not null default now(),
  constraint application_grant_amounts_value_check
    check (coverage_percent is not null or amount_per_semester is not null)
);

alter table public.application_grant_amounts enable row level security;

drop policy if exists "grant_amounts_office_read" on public.application_grant_amounts;
create policy "grant_amounts_office_read" on public.application_grant_amounts
for select using (public.is_admissions_office());

drop policy if exists "grant_amounts_approver_read" on public.application_grant_amounts;
create policy "grant_amounts_approver_read" on public.application_grant_amounts
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and exists (
    select 1 from public.applications a
    where a.id = application_grant_amounts.application_id
      and public.reviewer_scopes_to_student(a.student_id)
      and public.current_profile_role() = public.approver_role_for_student(a.student_id)
  )
);

drop policy if exists "grant_amounts_student_released_read" on public.application_grant_amounts;
create policy "grant_amounts_student_released_read" on public.application_grant_amounts
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_grant_amounts.application_id
      and a.student_id = auth.uid()
      and exists (
        select 1 from public.results_releases r
        where application_grant_amounts.application_id = any (r.application_ids)
      )
  )
);

create or replace function public.set_application_grant_amount(
  p_application_id uuid,
  p_coverage_percent numeric,
  p_amount numeric,
  p_note text
)
returns public.application_grant_amounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_application public.applications;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.application_grant_amounts;
begin
  if v_actor is null or v_role not in ('dean', 'assistant_dean', 'department_chair') then
    raise exception 'Only the approving level can record a grant amount.'
      using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'The application id is missing.';
  end if;

  select * into v_application from public.applications where id = p_application_id;
  if not found then
    raise exception 'The application was not found.';
  end if;

  if not public.reviewer_scopes_to_student(v_application.student_id)
     or v_role is distinct from public.approver_role_for_student(v_application.student_id) then
    raise exception 'Only the approving level for this applicant can record a grant amount.'
      using errcode = '42501';
  end if;

  if v_application.status not in ('Recommended', 'Approved') then
    raise exception 'A grant amount can be recorded only while the application is Recommended or Approved.'
      using errcode = '42501';
  end if;

  if p_coverage_percent is null and p_amount is null then
    raise exception 'Enter a coverage percent, an amount per semester, or both.';
  end if;
  if p_coverage_percent is not null and (p_coverage_percent < 0 or p_coverage_percent > 100) then
    raise exception 'Coverage must be between 0 and 100 percent.';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'The amount per semester cannot be negative.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note can be at most 500 characters.';
  end if;

  insert into public.application_grant_amounts as g
    (application_id, coverage_percent, amount_per_semester, note, set_by, set_by_role, updated_at)
  values
    (p_application_id, p_coverage_percent, p_amount, v_note, v_actor, v_role, now())
  on conflict (application_id) do update
    set coverage_percent = excluded.coverage_percent,
        amount_per_semester = excluded.amount_per_semester,
        note = excluded.note,
        set_by = excluded.set_by,
        set_by_role = excluded.set_by_role,
        updated_at = excluded.updated_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_application_grant_amount(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.set_application_grant_amount(uuid, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
