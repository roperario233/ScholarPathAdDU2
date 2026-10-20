-- ---------------------------------------------------------------------------
-- Let a student replace a rejected Document Vault file on a submitted
-- application.
--
-- A submitted application is frozen for the student (application_documents
-- links are Draft-only), so a file the Admissions Office rejected left the
-- application stranded: it could not pass the document-verification gate, and
-- the student could not swap in a corrected file. While the application is
-- still before endorsement (Submitted, Under Review, For Verification), the
-- student may now swap a Rejected attached file for another of their own
-- non-rejected vault files of the same kind. The application status does not
-- change; the new file arrives Pending for the Admissions Office to verify.
--
-- verification_decided_at records when the current verification decision was
-- made, so each decision gets its own notification key (a file rejected, reset,
-- and rejected again notifies the student twice).
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists verification_decided_at timestamptz;

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
    new.uploaded_at := now();
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
    or new.rejection_reason is distinct from old.rejection_reason
    or new.verification_decided_at is distinct from old.verification_decided_at
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
    new.verification_decided_at := now();
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

-- Swaps a Rejected file attached to the caller's own pre-endorsement
-- application for another of the caller's vault files. Mirrors
-- replaceRejectedDocument() in src/App.jsx and DOCUMENT_REPLACEMENT_STATUSES in
-- src/lib/constants.js.
create or replace function public.replace_rejected_application_document(
  p_application_id uuid,
  p_old_document_id uuid,
  p_new_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications%rowtype;
  v_old public.documents%rowtype;
  v_new public.documents%rowtype;
  v_required jsonb;
begin
  select * into v_application
    from public.applications
    where id = p_application_id and student_id = auth.uid();
  if not found then
    raise exception 'Application not found.' using errcode = '42501';
  end if;
  if v_application.status not in ('Submitted', 'Under Review', 'For Verification') then
    raise exception 'Documents can be replaced only before the application is endorsed.' using errcode = '23514';
  end if;

  select d.* into v_old
    from public.documents d
    join public.application_documents ad on ad.document_id = d.id and ad.application_id = p_application_id
    where d.id = p_old_document_id;
  if not found or v_old.verification_status <> 'Rejected' then
    raise exception 'Only a rejected document attached to this application can be replaced.' using errcode = '23514';
  end if;

  select * into v_new
    from public.documents
    where id = p_new_document_id and owner_id = auth.uid();
  if not found or v_new.verification_status = 'Rejected' then
    raise exception 'Choose a document from your vault that has not been rejected.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.application_documents
    where application_id = p_application_id and document_id = p_new_document_id
  ) then
    raise exception 'That document is already attached to this application.' using errcode = '23514';
  end if;

  if v_new.document_type is distinct from v_old.document_type then
    select coalesce(s.required_documents, '[]'::jsonb) into v_required
      from public.scholarships s
      where s.id = v_application.scholarship_id;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(v_required, '[]'::jsonb)) item
      where (item -> 'documentTypes') ? v_old.document_type
        and (item -> 'documentTypes') ? v_new.document_type
    ) then
      raise exception 'The replacement must be the same kind of document as the rejected file.' using errcode = '23514';
    end if;
  end if;

  delete from public.application_documents
    where application_id = p_application_id and document_id = p_old_document_id;
  insert into public.application_documents (application_id, document_id)
    values (p_application_id, p_new_document_id);
end;
$$;

revoke all on function public.replace_rejected_application_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_rejected_application_document(uuid, uuid, uuid) to authenticated;
