-- ---------------------------------------------------------------------------
-- Allow the sub-committee recommendation without an interview outcome.
--
-- SOP step 5 → 6 normally follows an attended interview. The Admissions Office
-- may record the recommendation without one: ApplicationReviewModal warns first
-- (ProceedWithoutInterviewModal) and App.jsx cancels the live schedule before the
-- stage moves, so `applications.interview.state` is `cancelled` by the time the
-- row reaches `Recommended`. A `no_show` record carries a recorded outcome but
-- not attendance, so it needs the explicit `deliberation.interviewWaived` marker
-- the client writes. A record that is still `scheduled` keeps blocking, so the
-- stage can never move past a live invitation and its calendar event.
--
-- Rejected is always allowed, and a record scheduled before the interview
-- overhaul (no `version`) stays grandfathered.
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_interview_outcome_before_recommendation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_waived boolean;
begin
  v_state := coalesce(new.interview ->> 'state', '');
  -- The marker the client writes on the deliberation. Containment cannot raise on
  -- a hand-edited row, unlike a boolean cast of an arbitrary JSON value.
  v_waived := coalesce(new.deliberation @> '{"interviewWaived": true}'::jsonb, false);
  if old.status = 'Interview'
    and new.status = 'Recommended'
    and (new.interview ? 'version')
    and v_state <> 'completed'
    and v_state <> 'cancelled'
    and not (v_state = 'no_show' and v_waived) then
    raise exception 'The interview panel must record the applicant as attended, or the recommendation must record the interview waiver.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_interview_outcome_before_recommendation on public.applications;
create trigger enforce_interview_outcome_before_recommendation
  before update on public.applications
  for each row execute function public.enforce_interview_outcome_before_recommendation();

revoke all on function public.enforce_interview_outcome_before_recommendation() from public;
revoke all on function public.enforce_interview_outcome_before_recommendation() from anon, authenticated;

notify pgrst, 'reload schema';
