-- ---------------------------------------------------------------------------
-- Protect a Verified document once an application that relies on it has
-- advanced past document verification.
--
-- The document-verification gate (20261014000000) blocks Endorsed/Interview/
-- Recommended/Approved/Released while an attached file is not Verified. The
-- Admissions Office can change a document's verification status at any time, so
-- un-verifying a file that a live application already relies on would strand
-- that application (it could never be released). This trigger makes the staff
-- revert the application first, which keeps the two records consistent.
--
-- Reverting to Verified, or changing any other column, is unaffected.
-- ---------------------------------------------------------------------------
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
        and a.status in ('Endorsed', 'Interview', 'Recommended', 'Approved', 'Released')
    ) then
      raise exception 'This document is verified and an application that relies on it has already advanced. Revert that application before changing its verification status.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_verified_documents_on_progress on public.documents;
create trigger protect_verified_documents_on_progress
  before update on public.documents
  for each row execute function public.protect_verified_documents_on_progress();
