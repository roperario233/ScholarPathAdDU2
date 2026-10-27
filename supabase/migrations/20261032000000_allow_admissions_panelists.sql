-- The interview panel may include the Admissions Office.
--
-- SOP 5a draws the Department Chairs from the school where the applicant's
-- program belongs, and 20261029000000 enforced exactly that: an account panelist
-- had to be a Department Chair of the applicant's school. The Admissions Office
-- coordinates the interview (SOP step 5), so its two lanes — Staff and Head — may
-- join any panel.
--
-- The lead is not restricted here: `is_lead` belongs to whichever member the
-- office marks, and `validateInterviewSchedule` keeps exactly one lead per panel
-- while allowing the panel itself to be empty until it is settled.

create or replace function public.validate_interview_panelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school text;
  v_member_role text;
  v_member_school text;
begin
  if new.profile_id is null then
    return new;
  end if;
  select p.department into v_school
    from public.applications a
    join public.profiles p on p.user_id = a.student_id
    where a.id = new.application_id;
  select role, department into v_member_role, v_member_school
    from public.profiles
    where user_id = new.profile_id;
  -- Either Admissions Office lane may sit on any panel.
  if v_member_role in ('admissions_office', 'admissions_head') then
    return new;
  end if;
  if v_member_role is distinct from 'department_chair'
    or nullif(btrim(coalesce(v_school, '')), '') is null
    or v_member_school is distinct from v_school then
    raise exception 'Interview panelists must come from the school where the applicant''s program belongs (SOP 5a), or from the Admissions Office.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_interview_panelist() from public;
revoke all on function public.validate_interview_panelist() from anon, authenticated;

comment on function public.validate_interview_panelist() is
  'Keeps an account panelist to a Department Chair of the applicant''s school (SOP 5a) or an Admissions Office Staff/Head account; the lead may be any member.';
