-- The Admissions Office Admin may record the grant amount too.
--
-- 20261059000000 let only the school's approving level call
-- set_application_grant_amount(). The Admin now records it as well, because the
-- Admin owns the final check and the release. Staff stay read-only. The Admin is not
-- tied to a school scope or to approver_role_for_student(); the stage rule is
-- unchanged (Recommended or Approved), so a released figure stays locked.

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
  v_is_admin boolean := public.is_admissions_admin();
  v_application public.applications;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.application_grant_amounts;
begin
  if v_actor is null
     or not (v_is_admin or v_role in ('dean', 'assistant_dean', 'department_chair')) then
    raise exception 'Only the approving level or the Admissions Office Admin can record a grant amount.'
      using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'The application id is missing.';
  end if;

  select * into v_application from public.applications where id = p_application_id;
  if not found then
    raise exception 'The application was not found.';
  end if;

  if not v_is_admin and (
       not public.reviewer_scopes_to_student(v_application.student_id)
       or v_role is distinct from public.approver_role_for_student(v_application.student_id)
     ) then
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
