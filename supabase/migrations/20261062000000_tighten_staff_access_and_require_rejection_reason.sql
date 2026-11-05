-- ---------------------------------------------------------------------------
-- Security audit fixes (A4, A8).
--
-- A4. The Reject dialog requires a reason, but the database did not: an Admin
--     (or the approving level) could move an application to Rejected through a
--     direct API call with no recorded reason. The app records the reason in the
--     staff-only application_review_comments thread first
--     ("Rejection reason — …", APPLICATION_REJECTION_REASON_PREFIX) and then
--     moves the stage, so the database now refuses a staff move into Rejected
--     unless the caller recorded that note after the application's last status
--     change. Not covered: a service-role job (no profile role), and a
--     Waitlisted case closed by close_results_round(), which is a round closing
--     rather than a decision a reviewer reasons about.
--
-- A8. Two policies were broader than the lane they serve.
--     1. staff_application_documents_access was FOR ALL for the two Admissions
--        Office lanes and every Chairperson, so staff could add or remove the
--        document links of any application. Links are written only by the owning
--        student while the application is a Draft (and by the replace-in-place
--        RPC, which is security definer), so staff keep a read-only policy. The
--        Chairperson reads through staff_application_documents_reviewer_read,
--        which is scoped through reviewer_scopes_to_student().
--     2. staff_read_profiles gave every Chairperson a read of every profile,
--        household income included. The Chairperson now reads through
--        reviewer_scoped_profiles_read like the Dean, Assistant Dean, and
--        interviewer: in-scope students plus the staff directory. A Chairperson
--        with no assigned department keeps the legacy school-wide read that
--        reviewer_scopes_to_student() already grants.
--
-- Additive; safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. application_documents: staff read, never write.
drop policy if exists "staff_application_documents_access" on public.application_documents;
drop policy if exists "staff_application_documents_read" on public.application_documents;
create policy "staff_application_documents_read" on public.application_documents
for select using (public.is_admissions_office());

-- 2. profiles: the Chairperson joins the scoped reviewer read.
drop policy if exists "staff_read_profiles" on public.profiles;
create policy "staff_read_profiles" on public.profiles
for select using (public.is_admissions_office());

drop policy if exists "reviewer_scoped_profiles_read" on public.profiles;
create policy "reviewer_scoped_profiles_read" on public.profiles
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and (profiles.role <> 'student' or public.reviewer_scopes_to_student(profiles.user_id))
);

-- 3. A rejection needs a recorded reason.
create or replace function public.require_application_rejection_reason()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'Rejection reason — ';
  v_caller_role text := public.current_profile_role();
  v_last_change timestamptz;
begin
  if new.status is not distinct from old.status or new.status <> 'Rejected' then
    return new;
  end if;

  -- Service-role jobs and students are governed elsewhere; a waitlist closed by
  -- close_results_round() carries no reviewer reason.
  if v_caller_role is null or v_caller_role = 'student' or old.status = 'Waitlisted' then
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
    raise exception 'Record the reason for the rejection before rejecting this application.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_application_rejection_reason() from public;
revoke all on function public.require_application_rejection_reason() from anon, authenticated;

drop trigger if exists require_application_rejection_reason on public.applications;
create trigger require_application_rejection_reason
  before update on public.applications
  for each row execute function public.require_application_rejection_reason();

notify pgrst, 'reload schema';
