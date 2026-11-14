-- Approval override: a ladder level above the school's configured approver may
-- decide the recommendation in its place, with a recorded reason.
--
-- Until now only the level configured for the applicant's school (approval_levels,
-- the Chairperson by default) could approve, waitlist, or reject a Recommended
-- case; a Dean whose school configured the Chairperson could read the case and do
-- nothing, and only the Admissions Office Admin could step in. This adds the
-- hierarchical escalation:
--
--   * A Dean may decide for an Assistant Dean or a Chairperson, and an Assistant
--     Dean for a Chairperson. Never the other way, never an interviewer, and never
--     outside the account's own review scope (reviewer_scopes_to_student, the same
--     predicate as approving).
--   * The configured approver is unchanged and still decides without a reason.
--   * An override must carry a reason. It is filed in the staff-only
--     application_review_comments thread with the prefix 'Approval override — '
--     (never a student-readable column), and the move is refused without one filed
--     by the caller after the case's last status change, exactly like the rejection
--     reason (require_application_rejection_reason).
--   * The reviewer RLS policy already lets an in-scope reviewer update a Recommended
--     case, so only the lane trigger and the reason check change here. The grant
--     amount stays with the configured approver and the Admin
--     (set_application_grant_amount), and the Admin keeps its own override.

-- The ladder, narrowest first. Mirrors LADDER_RANK in src/lib/reviewScope.js.
create or replace function public.review_ladder_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'department_chair' then 1
    when 'assistant_dean' then 2
    when 'dean' then 3
    else 0
  end
$$;

-- ---------------------------------------------------------------------------
-- Stage authority (mirrors getNextApplicationStatuses in src/lib/constants.js).
-- The body is the 20261061000000 version with one change: the approving move is
-- also open to a ladder level above the configured approver.
-- ---------------------------------------------------------------------------

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
  -- Students (enforce_student_application_update and the offer RPCs) and
  -- service-role jobs are governed elsewhere.
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

  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_admin' then
    v_allowed := (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Waitlisted', 'Rejected'))
      or (old.status = 'Approved' and new.status in ('Released', 'Rejected'))
      -- The waitlist: a promotion only once the offers were released, so the
      -- waitlisted applicant already knows they were waitlisted.
      or (old.status = 'Waitlisted' and new.status in ('Rejected', 'Declined'))
      or (
        old.status = 'Waitlisted' and new.status = 'Released'
        and exists (
          select 1 from public.results_releases r
          where r.scholarship_id = new.scholarship_id and r.kind = 'offers' and new.id = any (r.application_ids)
        )
      )
      or (old.status = 'Released' and new.status = 'Declined');
  elsif caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if public.reviewer_scopes_to_student(new.student_id) then
      v_allowed := (old.status = 'Endorsed' and new.status = 'Interview')
        or (
          old.status = 'Interview' and new.status = 'Recommended'
          and public.is_interview_panelist(new.id)
        )
        or (
          caller_role <> 'interviewer'
          and old.status = 'Recommended' and new.status in ('Approved', 'Waitlisted', 'Rejected')
          -- The configured approving level, or a ladder level above it (an override,
          -- which require_approval_override_reason holds to a recorded reason).
          and public.review_ladder_rank(caller_role)
            >= public.review_ladder_rank(public.approver_role_for_student(new.student_id))
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

revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- An override needs a recorded reason.
-- ---------------------------------------------------------------------------

create or replace function public.require_approval_override_reason()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'Approval override — ';
  v_caller_role text := public.current_profile_role();
  v_last_change timestamptz;
begin
  if new.status is not distinct from old.status
    or old.status <> 'Recommended'
    or new.status not in ('Approved', 'Waitlisted', 'Rejected') then
    return new;
  end if;

  -- Only a ladder level standing in for a different configured approver overrides.
  -- The configured approver, the Admin, students, and service-role jobs decide as
  -- they always did.
  if v_caller_role is null
    or v_caller_role not in ('dean', 'assistant_dean', 'department_chair')
    or v_caller_role = public.approver_role_for_student(new.student_id) then
    return new;
  end if;

  select max(l.created_at) into v_last_change
  from public.application_status_log l
  where l.application_id = new.id;

  if not exists (
    select 1
    from public.application_review_comments c
    where c.application_id = new.id
      and c.author_id = auth.uid()
      and left(c.body, char_length(v_prefix)) = v_prefix
      and char_length(btrim(substr(c.body, char_length(v_prefix) + 1))) > 0
      and (v_last_change is null or c.created_at > v_last_change)
  ) then
    raise exception 'Record why you are deciding in place of the approving level before this recommendation is decided.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_approval_override_reason() from public;
revoke all on function public.require_approval_override_reason() from anon, authenticated;

drop trigger if exists require_approval_override_reason on public.applications;
create trigger require_approval_override_reason
  before update on public.applications
  for each row execute function public.require_approval_override_reason();

notify pgrst, 'reload schema';
