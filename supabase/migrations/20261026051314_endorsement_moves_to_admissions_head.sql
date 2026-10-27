-- ---------------------------------------------------------------------------
-- Move endorsement from the Department Chair to the Office of Admissions & Aid.
--
-- SOP step 4 is now a central decision. Admissions Office Staff verify the
-- documents and hand the application to endorsement (For Verification ->
-- For Endorsement, unchanged). Only the Admissions Office Head records the
-- endorsement (For Endorsement -> Endorsed). The Department Chair keeps
-- read-only visibility of the department queue, the endorsement record, and
-- the interview panel work (attendance and evaluation notes), and loses every
-- stage move:
--   * the Chair's flag-for-validation and endorse policies are dropped;
--   * the Chair's department_reviews write policy is dropped, so the audit
--     table keeps the historical Chair decisions but gains no new ones.
--
-- Existing rows keep their stored status values. An open For Endorsement case
-- simply becomes actionable for the Head. Additive and safe to re-run.
-- ---------------------------------------------------------------------------

drop policy if exists "chair_applications_flag_for_validation" on public.applications;
drop policy if exists "chair_applications_endorse" on public.applications;
drop policy if exists "chair_department_reviews_access" on public.department_reviews;

-- The Head endorses; Staff hand off and never endorse. Staff's branch is
-- unchanged and still cannot approve, release, or endorse.
create or replace function public.enforce_admissions_office_lane_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
begin
  if caller_role is null or caller_role not in ('admissions_office', 'admissions_head') then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_office' then
    if not (
      (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('For Endorsement', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
    ) then
      raise exception 'Admissions Office Staff cannot move an application from % to %.', old.status, new.status
        using errcode = '42501';
    end if;
  else
    if not (
      (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('For Endorsement', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Rejected'))
      or (old.status = 'Approved' and new.status = 'Released')
    ) then
      raise exception 'The Admissions Office Head cannot move an application from % to %.', old.status, new.status
        using errcode = '42501';
    end if;
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

-- The Head's row access must cover the endorsement pair: For Endorsement is
-- the row the Head decides, and Endorsed is the status the Head writes.
drop policy if exists "admissions_head_applications_update" on public.applications;
create policy "admissions_head_applications_update" on public.applications
for update using (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected')
);

notify pgrst, 'reload schema';
