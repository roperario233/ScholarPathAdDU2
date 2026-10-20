-- ---------------------------------------------------------------------------
-- Require a recorded reason when a Document Vault file is rejected.
--
-- The Admissions Office could mark a document Rejected without any context, so
-- the student saw only a red badge. The reason now lives on the document row,
-- is required whenever a file moves into Rejected, and is cleared once the file
-- leaves that state. Like the other review fields it belongs to the staff, so
-- protect_document_review_fields stops a student from writing it.
--
-- The check runs on the transition only, so a file rejected before this column
-- existed stays editable without a backfilled reason.
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists rejection_reason text;

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
    new.rejection_reason := null;
    new.uploaded_at := now();
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
    or new.rejection_reason is distinct from old.rejection_reason
    or new.linked_attributes is distinct from old.linked_attributes
    or new.attested_values is distinct from old.attested_values
    or new.uploaded_at is distinct from old.uploaded_at
    or new.owner_id is distinct from old.owner_id then
    raise exception 'Document review fields can only be changed by the Admissions Office.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.require_document_rejection_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.verification_status is distinct from 'Rejected' then
    new.rejection_reason := null;
    return new;
  end if;
  new.rejection_reason := nullif(btrim(new.rejection_reason), '');
  if old.verification_status is distinct from 'Rejected' and new.rejection_reason is null then
    raise exception 'A reason is required to reject a document.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists require_document_rejection_reason on public.documents;
create trigger require_document_rejection_reason
  before update on public.documents
  for each row execute function public.require_document_rejection_reason();
