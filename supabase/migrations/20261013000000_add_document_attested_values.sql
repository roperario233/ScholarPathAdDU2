-- Outdated Document Vault proofs.
--
-- A proof document now records the declared value it was uploaded to prove,
-- keyed by attribute (for example `{"qpi": 3.2}`), using the normalized form
-- from normalizeAttestedValue() in src/lib/profile.js. The client derives an
-- attribute as `Outdated` when every linked proof attests a value that no longer
-- matches the profile, or when an annual proof (QPI, household income) was
-- uploaded in an earlier academic year (see src/lib/verification.js). The
-- document's own verification status is left untouched, and verification stays
-- informational: it never blocks eligibility matching or applying.
--
-- Additive: existing rows default to an empty object and are treated as current,
-- so verifications already granted do not flip.
alter table public.documents add column if not exists attested_values jsonb not null default '{}'::jsonb;

-- Students own their vault rows (documents_self_access is FOR ALL), but the
-- review fields belong to the Admissions Office. Without this guard a student
-- could mark their own file Verified, relink it to another attribute, rewrite
-- the value it attests, or backdate it into the current academic year.
create or replace function public.protect_document_review_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Staff and the service role (no profile, so a null role) pass through.
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'Pending';
    new.uploaded_at := now();
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
    or new.linked_attributes is distinct from old.linked_attributes
    or new.attested_values is distinct from old.attested_values
    or new.uploaded_at is distinct from old.uploaded_at
    or new.owner_id is distinct from old.owner_id then
    raise exception 'Document review fields can only be changed by the Admissions Office.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_document_review_fields on public.documents;
create trigger protect_document_review_fields
  before insert or update on public.documents
  for each row execute function public.protect_document_review_fields();

-- Ask PostgREST to pick up the new column immediately.
notify pgrst, 'reload schema';
