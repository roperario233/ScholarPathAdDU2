-- ---------------------------------------------------------------------------
-- Remove interview attendance tracking.
--
-- Attendance used to be recorded through record_interview_outcome, which moved
-- `applications.interview.state` to `completed` or `no_show`. The interview
-- stage now records only the schedule: `scheduled` or `cancelled`. Rows recorded
-- before this migration keep their state so the history stays readable, but no
-- new `completed` / `no_show` state is written and the app never asks for one.
--
-- The Recommend gate (SOP step 5 -> 6) therefore only refuses a live schedule.
-- App.jsx cancels a `scheduled` record before it writes the recommendation, so a
-- calendar invitation or Meet link can never outlive the stage. The renamed
-- trigger says exactly that, and still grandfathers a record scheduled before
-- the structured-interview overhaul (no `version`). Rejected is always allowed.
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------

drop function if exists public.record_interview_outcome(uuid, text);

drop trigger if exists enforce_interview_outcome_before_recommendation on public.applications;
drop function if exists public.enforce_interview_outcome_before_recommendation();

create or replace function public.enforce_interview_closed_before_recommendation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Interview'
    and new.status = 'Recommended'
    and (new.interview ? 'version')
    and coalesce(new.interview ->> 'state', '') = 'scheduled' then
    raise exception 'The interview schedule must be closed before the recommendation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_interview_closed_before_recommendation on public.applications;
create trigger enforce_interview_closed_before_recommendation
  before update on public.applications
  for each row execute function public.enforce_interview_closed_before_recommendation();

revoke all on function public.enforce_interview_closed_before_recommendation() from public;
revoke all on function public.enforce_interview_closed_before_recommendation() from anon, authenticated;

notify pgrst, 'reload schema';
