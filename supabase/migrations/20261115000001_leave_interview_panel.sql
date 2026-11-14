-- Leave an interview panel.
--
-- The counterpart of join_interview_panel() (20261115000000): a reviewer who joined
-- by mistake, or no longer needs the seat, takes it back without a reschedule.
-- Removing a panelist any other way is a reschedule, which bumps the revision and
-- tells the applicant and the panel the interview changed.
--
--   * Self-service only, and only for the four reviewer roles; the caller can only
--     remove their own active seat.
--   * Only while the application is at Interview. The panel is closed once the
--     recommendation is recorded, so a seat cannot be dropped to rewrite who sat on
--     the evaluation afterwards.
--   * The lead cannot leave: the panel must keep exactly one lead, and the lead is
--     only changed by rescheduling.
--   * A reviewer who has recorded a note on the interview stays on the panel. The
--     notes are append-only and name their author, so the seat has to keep matching
--     them.
--   * It is a soft removal (removed_at), like every other panel change, so who sat
--     on the panel stays on record. It never touches applications.interview, so the
--     revision does not change and nobody is notified.

create or replace function public.leave_interview_panel(p_application_id uuid)
returns public.application_interview_panelists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_profile_role();
  v_status text;
  v_row public.application_interview_panelists;
begin
  if auth.uid() is null
    or v_role is null
    or v_role not in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    raise exception 'Only an interviewer, Chairperson, Assistant Dean, or Dean can leave an interview panel.'
      using errcode = '42501';
  end if;

  -- A share lock keeps a recommendation that is being recorded at the same moment
  -- from moving the case out of Interview between this check and the removal.
  select status into v_status
    from public.applications
    where id = p_application_id
    for share;

  if not found then
    raise exception 'The application could not be found.'
      using errcode = 'P0002';
  end if;

  if v_status <> 'Interview' then
    raise exception 'An interview panel can only be left while the application is at the interview stage.'
      using errcode = '23514';
  end if;

  select * into v_row
    from public.application_interview_panelists
    where application_id = p_application_id
      and profile_id = auth.uid()
      and removed_at is null
    for update;

  if not found then
    raise exception 'You are not on this interview panel.'
      using errcode = 'P0002';
  end if;

  if v_row.is_lead then
    raise exception 'The panel lead cannot leave. The lead is changed by rescheduling the interview.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.application_interview_notes
    where application_id = p_application_id
      and author_id = auth.uid()
  ) then
    raise exception 'You recorded a note on this interview, so you stay on the panel.'
      using errcode = '23514';
  end if;

  update public.application_interview_panelists
    set removed_at = now()
    where id = v_row.id
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.leave_interview_panel(uuid) from public, anon;
grant execute on function public.leave_interview_panel(uuid) to authenticated;

notify pgrst, 'reload schema';
