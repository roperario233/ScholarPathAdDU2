-- Stage authority by role, following the process Ma'am Devi described at
-- Consultation 2 (Oct 27):
--
--   Admissions Office Head  Submitted -> Under Review -> For Verification, verifies
--                           every file, then forwards the case straight to the
--                           interviewer (For Verification -> Endorsed; the separate
--                           endorsement hand-off is retired). Superset override on
--                           the interview and approval moves. Final check and
--                           release (Approved -> Released), or Approved -> Rejected
--                           when the final check finds a sibling already on a grant
--                           or a pending case.
--   Admissions Office Staff no stage moves; a read-only office view.
--   Interviewer, and any    Endorsed -> Interview (scheduling) and, once on the
--   ladder level in scope   panel, Interview -> Recommended. An interviewer never
--                           rejects: "Not recommended" is a recommendation level.
--   Approver                Recommended -> Approved / Rejected, when the caller's
--                           role is approver_role_for_student() for the applicant.
--
-- src/lib/constants.js `getNextApplicationStatuses()` mirrors this map.
-- The legacy For Endorsement -> Endorsed move stays with the Head so rows sent to
-- endorsement before this migration can still leave that stage.

create or replace function public.enforce_admissions_office_lane_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
  v_allowed boolean := false;
begin
  -- Students (enforce_student_application_update) and service-role jobs are
  -- governed elsewhere.
  if caller_role is null or caller_role = 'student' then
    return new;
  end if;

  -- A scoped reviewer writes the interview and deliberation stage payloads only;
  -- the submitted record, the office's endorsement and release records stay as
  -- they were.
  if caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if new.student_id is distinct from old.student_id
      or new.scholarship_id is distinct from old.scholarship_id
      or new.statement is distinct from old.statement
      or new.profile_snapshot is distinct from old.profile_snapshot
      or new.certified_at is distinct from old.certified_at
      or new.submitted_at is distinct from old.submitted_at
      or new.endorsement is distinct from old.endorsement
      or new.release is distinct from old.release then
      raise exception 'A reviewer can only record the interview and the recommendation on an application.'
        using errcode = '42501';
    end if;
  end if;

  -- Staff have no update policy any more, so a non-status write by them never
  -- reaches this trigger; a status move is refused below.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_head' then
    v_allowed := (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Rejected'))
      or (old.status = 'Approved' and new.status in ('Released', 'Rejected'));
  elsif caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if public.reviewer_scopes_to_student(new.student_id) then
      v_allowed := (old.status = 'Endorsed' and new.status = 'Interview')
        or (
          old.status = 'Interview' and new.status = 'Recommended'
          and public.is_interview_panelist(new.id)
        )
        or (
          caller_role <> 'interviewer'
          and old.status = 'Recommended' and new.status in ('Approved', 'Rejected')
          and caller_role = public.approver_role_for_student(new.student_id)
        );
    end if;
  end if;

  if not v_allowed then
    raise exception 'Your role cannot move this application from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admissions_office_lane_transitions on public.applications;
create trigger enforce_admissions_office_lane_transitions
  before update on public.applications
  for each row execute function public.enforce_admissions_office_lane_transitions();

revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

-- Row access for the writes above. The trigger decides which status move is
-- allowed; these policies decide which rows each role may touch at all.
drop policy if exists "admissions_staff_applications_update" on public.applications;

drop policy if exists "admissions_head_applications_update" on public.applications;
create policy "admissions_head_applications_update" on public.applications
for update using (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected')
);

drop policy if exists "reviewer_applications_update" on public.applications;
create policy "reviewer_applications_update" on public.applications
for update using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended')
) with check (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended', 'Approved', 'Rejected')
);

-- The case-officer roster is no longer how work is routed (an applicant reaches
-- the interviewers of its scope automatically), so only the Head opens a case
-- into review. `join_application_review` still checks the caller itself; the
-- trigger above refuses a Staff status move.
