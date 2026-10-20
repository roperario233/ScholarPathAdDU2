-- ---------------------------------------------------------------------------
-- Add the endorsement hand-off stage (SOP step 4).
--
-- The Admissions Office finishes document verification and explicitly sends the
-- application to the Department Chair with `For Endorsement`; only then does the
-- Chair record the endorsement (`Endorsed`). Before this stage the Chair could
-- endorse straight out of `For Verification`, so the hand-off was implicit.
--
-- Additive and safe to re-run against a project that already has the earlier
-- migrations (20261010000001, 20261014000000, 20261014000004).
-- ---------------------------------------------------------------------------

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in (
    'Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement',
    'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'
  ));

-- The Chair endorses only an application the Admissions Office sent over.
drop policy if exists "chair_applications_endorse" on public.applications;
create policy "chair_applications_endorse" on public.applications
for update using (
  public.current_profile_role() = 'department_chair'
  and status = 'For Endorsement'
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
) with check (
  public.current_profile_role() = 'department_chair'
  and status = 'Endorsed'
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
);

-- The hand-off itself is forward progress, so it needs every attached file
-- Verified, exactly like endorsement and the later stages.
create or replace function public.enforce_document_verification_before_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding integer;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released') then
    return new;
  end if;

  select count(*)
    into v_outstanding
    from public.application_documents ad
    join public.documents d on d.id = ad.document_id
    where ad.application_id = new.id
      and d.verification_status <> 'Verified';

  if v_outstanding > 0 then
    raise exception 'All attached documents must be verified before this application can be sent to endorsement or advance to a later stage. % document(s) still need verification.', v_outstanding
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_verified_documents_on_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.verification_status = 'Verified' and new.verification_status is distinct from 'Verified' then
    if exists (
      select 1
      from public.application_documents ad
      join public.applications a on a.id = ad.application_id
      where ad.document_id = new.id
        and a.status in ('For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released')
    ) then
      raise exception 'This document is verified and an application that relies on it has already advanced. Revert that application before changing its verification status.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
