-- ---------------------------------------------------------------------------
-- Record who decided a Document Vault file, and when.
--
-- Verifying or rejecting a file wrote only verification_status (plus the
-- rejection reason required from 20261020000000), and
-- require_document_rejection_reason stamped verification_decided_at. Nothing
-- tied the decision to the Admissions Office account that made it, so two
-- reviewers could not be told apart afterwards and the student saw only a badge.
--
-- reviewed_by / reviewed_by_role are stamped by the same BEFORE UPDATE trigger
-- from auth.uid() and current_profile_role(), so the client never sends them and
-- cannot spoof them. A file returning to Pending clears the record: a reset is
-- not a decision. Like the other review fields they are staff-owned.
--
-- Authority is unchanged: only the Admissions Office (Staff and Head, per
-- admissions_office_documents_update) may write the decision, and a Department
-- Chair keeps read-only access (chair_documents_read). The record is visible to
-- the Chair and to the student, who sees the role and never the reviewer's name
-- (mirrors describeStatusActor / describeDocumentDecision).
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists reviewed_by uuid references public.profiles(user_id) on delete set null;
alter table public.documents add column if not exists reviewed_by_role text;

-- Covering index for the new foreign key (Supabase unindexed_foreign_keys lint),
-- so "what did this reviewer decide" and account deletion stay cheap.
create index if not exists documents_reviewed_by_idx on public.documents (reviewed_by);

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
    new.verification_decided_at := null;
    new.reviewed_by := null;
    new.reviewed_by_role := null;
    new.uploaded_at := now();
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
    or new.rejection_reason is distinct from old.rejection_reason
    or new.verification_decided_at is distinct from old.verification_decided_at
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_by_role is distinct from old.reviewed_by_role
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
  if new.verification_status is distinct from old.verification_status then
    if new.verification_status = 'Pending' then
      -- A reset returns the file to the queue, so it no longer carries a
      -- decision or a reviewer.
      new.verification_decided_at := null;
      new.reviewed_by := null;
      new.reviewed_by_role := null;
    else
      new.verification_decided_at := now();
      new.reviewed_by := auth.uid();
      new.reviewed_by_role := coalesce(public.current_profile_role(), 'system');
    end if;
  end if;
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
