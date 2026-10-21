-- ---------------------------------------------------------------------------
-- Make the Admissions Office Head a superset of the Staff lane.
--
-- The original split (20261024000000) limited the Head to approval and release.
-- The Head now has full office authority: they may run every Staff preparation
-- stage (intake, document verification, the endorsement hand-off, interviews,
-- and the sub-committee recommendation) IN ADDITION to approval and release.
-- Staff remain limited to the preparation stages and still cannot approve or
-- release.
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------

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

-- The Head may update any live preparation or decision row; the trigger above
-- still decides which status moves are legal.
drop policy if exists "admissions_head_applications_update" on public.applications;
create policy "admissions_head_applications_update" on public.applications
for update using (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected')
);

-- Document Vault verification is part of the preparation workflow, so both
-- Admissions Office lanes may verify or reject a file.
drop policy if exists "admissions_staff_documents_update" on public.documents;
drop policy if exists "admissions_office_documents_update" on public.documents;
create policy "admissions_office_documents_update" on public.documents
for update using (public.is_admissions_office())
with check (public.is_admissions_office());

notify pgrst, 'reload schema';
