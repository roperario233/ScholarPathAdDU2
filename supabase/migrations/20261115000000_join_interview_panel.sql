-- Join an interview panel.
--
-- Only a panel member records evaluation notes and the recommendation, and the
-- panel is set by whoever schedules the interview. A Dean, Assistant Dean,
-- Chairperson, or interviewer whose scope covers the applicant but who was left
-- off the panel could only be added by rescheduling, which bumps the revision and
-- tells the applicant and the panel the interview changed.
--
-- join_interview_panel() lets such a reviewer add themselves:
--   * It is self-service only. The row is always the caller's own, never a lead,
--     so it cannot be used to seat anyone else or take the lead from the scheduler.
--   * It re-checks the caller's role, the review scope
--     (reviewer_scopes_to_student), and the case: the application must be at
--     Interview with a scheduled interview. Once the recommendation is recorded the
--     panel is closed, so a reviewer who is also the approving level cannot join
--     afterwards and write into an evaluation they are about to decide on.
--   * It never touches applications.interview, so the revision does not change and
--     neither the applicant nor the panel is notified, and the student-readable
--     record still never names a panelist.
--   * It is idempotent: a reviewer already on the panel gets their existing row.
--
-- The write goes through a security definer function instead of widening the
-- insert policy, which lets an in-scope reviewer seat any in-scope account.
-- validate_interview_panelist still runs on the insert.

create or replace function public.join_interview_panel(p_application_id uuid)
returns public.application_interview_panelists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_profile_role();
  v_application public.applications;
  v_row public.application_interview_panelists;
begin
  if auth.uid() is null
    or v_role is null
    or v_role not in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    raise exception 'Only an interviewer, Chairperson, Assistant Dean, or Dean can join an interview panel.'
      using errcode = '42501';
  end if;

  -- A share lock keeps a recommendation that is being recorded at the same moment
  -- from moving the case out of Interview between this check and the insert.
  select * into v_application
    from public.applications
    where id = p_application_id
    for share;

  if not found then
    raise exception 'The application could not be found.'
      using errcode = 'P0002';
  end if;

  if not public.reviewer_scopes_to_student(v_application.student_id) then
    raise exception 'This applicant is outside your review scope.'
      using errcode = '42501';
  end if;

  if v_application.status <> 'Interview'
    or coalesce(v_application.interview ->> 'state', '') <> 'scheduled' then
    raise exception 'An interview panel can only be joined while the interview is scheduled.'
      using errcode = '23514';
  end if;

  insert into public.application_interview_panelists (application_id, profile_id, is_lead, added_by)
  values (p_application_id, auth.uid(), false, auth.uid())
  on conflict (application_id, profile_id) where removed_at is null and profile_id is not null
  do nothing
  returning * into v_row;

  if not found then
    select * into v_row
      from public.application_interview_panelists
      where application_id = p_application_id
        and profile_id = auth.uid()
        and removed_at is null;
  end if;

  return v_row;
end;
$$;

revoke all on function public.join_interview_panel(uuid) from public, anon;
grant execute on function public.join_interview_panel(uuid) to authenticated;

notify pgrst, 'reload schema';
