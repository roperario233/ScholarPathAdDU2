-- ---------------------------------------------------------------------------
-- Enforce the document-verification gate at the database.
--
-- Manuscript Section 3.3.3: "Scholarship applications linked to documents with
-- a verification status of Pending or Rejected cannot proceed to interview or
-- subcommittee evaluation." The Admissions Office role has `for all` access to
-- applications, so the rule cannot live in the UI alone: any forward transition
-- (Endorsed, Interview, Recommended, Approved, Released) is rejected while an
-- attached Document Vault file is not Verified. Rejection is always allowed.
--
-- This mirrors `isApplicationVerifiedForEndorsement()` in
-- src/lib/applicationRequirements.js, which the reviewer UI reads.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_document_verification_before_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding integer;
begin
  -- Only a forward status change is gated; editing other fields is unaffected.
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('Endorsed', 'Interview', 'Recommended', 'Approved', 'Released') then
    return new;
  end if;

  select count(*)
    into v_outstanding
    from public.application_documents ad
    join public.documents d on d.id = ad.document_id
    where ad.application_id = new.id
      and d.verification_status <> 'Verified';

  if v_outstanding > 0 then
    raise exception 'All attached documents must be verified before this application can be endorsed or advance to a later stage. % document(s) still need verification.', v_outstanding
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_document_verification_before_progress on public.applications;
create trigger enforce_document_verification_before_progress
  before update on public.applications
  for each row execute function public.enforce_document_verification_before_progress();
