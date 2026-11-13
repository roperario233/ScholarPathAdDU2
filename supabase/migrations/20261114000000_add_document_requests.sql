-- Document requests: the Admissions Office Admin asks a student for more files
-- (or one more document) while the application is at For Verification.
--
-- Until now the Admin's only tool at verification was "Revert for resubmission",
-- a one-for-one swap of a Rejected file. The Admin could not ask for something the
-- catalog never required, or for more of something it did (a second set of
-- residence photos, for example), and a student cannot write to a submitted
-- application. This adds a request record and the narrow writes around it:
--
--   1. application_document_requests holds the request. Three kinds:
--        more_files   - more files for a catalog requirement (a count is asked)
--        new_document - one document type the catalog did not require
--        free_text    - the Admin describes it; the student attaches any file
--      The note is shown to the student (like a document's revert reason), so it
--      must never carry anything confidential.
--   2. request_application_documents() / cancel_document_request() are Admin-only.
--      fulfill_document_request() is the owning student's only write to a
--      submitted application: it links the chosen vault files (arriving Pending)
--      and closes the request in one transaction. It never touches the
--      application row, so enforce_student_application_update is unaffected.
--   3. The application does not change stage. An Open request blocks the move out
--      of For Verification (enforce_document_verification_before_progress), so a
--      student who attached nothing cannot slip past the "every attached file is
--      Verified" gate. The Admin can cancel a request that cannot be met.
--
-- Notices are in-app only and generic (no note text), written inside the RPCs, so
-- no Edge Function or outbox change is needed.

create table if not exists public.application_document_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null check (kind in ('more_files', 'new_document', 'free_text')),
  requirement_id text,
  document_types text[] not null default '{}',
  label text not null check (char_length(btrim(label)) between 1 and 120),
  note text not null check (char_length(btrim(note)) between 1 and 500),
  min_files integer not null default 1 check (min_files between 1 and 10),
  status text not null default 'Open' check (status in ('Open', 'Fulfilled', 'Cancelled')),
  requested_by uuid references public.profiles(user_id) on delete set null,
  requested_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300)
);

create index if not exists application_document_requests_application_idx
  on public.application_document_requests (application_id);
create index if not exists application_document_requests_open_idx
  on public.application_document_requests (application_id) where status = 'Open';
create index if not exists application_document_requests_updated_at_idx
  on public.application_document_requests (updated_at, id);
create index if not exists application_document_requests_requested_by_idx
  on public.application_document_requests (requested_by);

drop trigger if exists touch_application_document_requests_updated_at on public.application_document_requests;
create trigger touch_application_document_requests_updated_at
  before update on public.application_document_requests
  for each row execute function public.touch_updated_at();

alter table public.application_document_requests enable row level security;

-- Reads only. Every write goes through the security definer functions below.
drop policy if exists "document_requests_student_read" on public.application_document_requests;
create policy "document_requests_student_read" on public.application_document_requests
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_document_requests.application_id
      and a.student_id = auth.uid()
  )
);

drop policy if exists "document_requests_office_read" on public.application_document_requests;
create policy "document_requests_office_read" on public.application_document_requests
for select using (public.is_admissions_office());

drop policy if exists "document_requests_reviewer_read" on public.application_document_requests;
create policy "document_requests_reviewer_read" on public.application_document_requests
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and exists (
    select 1 from public.applications a
    where a.id = application_document_requests.application_id
      and public.reviewer_scopes_to_student(a.student_id)
  )
);

revoke all on public.application_document_requests from public, anon;
grant select on public.application_document_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: ask the student for documents
-- ---------------------------------------------------------------------------
create or replace function public.request_application_documents(
  p_application_id uuid,
  p_kind text,
  p_requirement_id text,
  p_document_types text[],
  p_label text,
  p_note text,
  p_min_files integer
)
returns public.application_document_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_types text[] := coalesce(p_document_types, '{}');
  v_min integer := coalesce(p_min_files, 1);
  v_app public.applications;
  v_scholarship public.scholarships;
  v_requirement jsonb;
  v_row public.application_document_requests;
begin
  if v_actor is null or not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can request documents.'
      using errcode = '42501';
  end if;
  if p_kind not in ('more_files', 'new_document', 'free_text') then
    raise exception 'Choose what kind of request this is.';
  end if;
  if v_label = '' or char_length(v_label) > 120 then
    raise exception 'Name the document in 120 characters or fewer.';
  end if;
  if v_note = '' then
    raise exception 'Tell the student what to provide.';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters or fewer.';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'This application could not be found.';
  end if;
  if v_app.status is distinct from 'For Verification' then
    raise exception 'Documents can be requested only while the application is at document verification.';
  end if;

  select * into v_scholarship from public.scholarships where id = v_app.scholarship_id;

  if p_kind = 'more_files' then
    if v_min < 1 or v_min > 10 then
      raise exception 'Ask for between 1 and 10 additional files.';
    end if;
    select item into v_requirement
    from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) as item
    where item ->> 'id' = p_requirement_id
    limit 1;
    if v_requirement is null then
      raise exception 'That requirement is not on this scholarship''s required documents.';
    end if;
    if cardinality(v_types) = 0 or exists (
      select 1 from unnest(v_types) t
      where not (coalesce(v_requirement -> 'documentTypes', '[]'::jsonb) ? t)
    ) then
      raise exception 'The document types must be ones the requirement accepts.';
    end if;
  elsif p_kind = 'new_document' then
    v_min := 1;
    if cardinality(v_types) <> 1 or btrim(v_types[1]) = '' then
      raise exception 'Choose the document type to request.';
    end if;
  else
    v_min := 1;
    v_types := '{}';
  end if;

  insert into public.application_document_requests (
    application_id, kind, requirement_id, document_types, label, note, min_files,
    requested_by, requested_by_role
  ) values (
    p_application_id,
    p_kind,
    case when p_kind = 'more_files' then p_requirement_id else null end,
    v_types,
    v_label,
    v_note,
    v_min,
    v_actor,
    public.current_profile_role()
  )
  returning * into v_row;

  update public.applications
     set timeline = public.append_application_timeline(
           timeline,
           'For Verification',
           'The Admissions Office asked for additional documents.',
           'Admissions Office')
   where id = p_application_id;

  if exists (
    select 1 from public.profiles p
    where p.user_id = v_app.student_id
      and (p.notification_preferences ->> 'inAppEnabled') is distinct from 'false'
  ) then
    insert into public.notifications (profile_id, title, body, channel, status, source_key)
    values (
      v_app.student_id,
      'Additional documents requested',
      'The Admissions Office asked for more documents for your '
        || coalesce(v_scholarship.title, 'scholarship')
        || ' application. Open Applications to see what is needed.',
      'In-app',
      'Unread',
      'documents-requested-' || v_row.id::text
    )
    on conflict (profile_id, source_key) do nothing;
  end if;

  return v_row;
end;
$$;

revoke all on function public.request_application_documents(uuid, text, text, text[], text, text, integer) from public, anon;
grant execute on function public.request_application_documents(uuid, text, text, text[], text, text, integer) to authenticated;

create or replace function public.cancel_document_request(
  p_request_id uuid,
  p_reason text
)
returns public.application_document_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.application_document_requests;
begin
  if v_actor is null or not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can cancel a document request.'
      using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Record why the request is being cancelled.';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Keep the reason to 300 characters or fewer.';
  end if;

  update public.application_document_requests
     set status = 'Cancelled',
         cancelled_by = v_actor,
         cancel_reason = v_reason
   where id = p_request_id and status = 'Open'
  returning * into v_row;
  if not found then
    raise exception 'Only an open request can be cancelled.';
  end if;
  return v_row;
end;
$$;

revoke all on function public.cancel_document_request(uuid, text) from public, anon;
grant execute on function public.cancel_document_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Student: answer a request with vault files
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_document_request(
  p_request_id uuid,
  p_document_ids uuid[]
)
returns public.application_document_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_req public.application_document_requests;
  v_app public.applications;
  v_title text;
  v_valid integer;
begin
  if v_actor is null then
    raise exception 'Sign in to answer this request.' using errcode = '42501';
  end if;

  select array_agg(distinct d) into v_ids from unnest(coalesce(p_document_ids, '{}')) d;

  select * into v_req from public.application_document_requests where id = p_request_id for update;
  if not found then
    raise exception 'This request could not be found.';
  end if;

  select * into v_app from public.applications where id = v_req.application_id for update;
  if not found or v_app.student_id is distinct from v_actor then
    raise exception 'This request could not be found.' using errcode = '42501';
  end if;
  if v_req.status <> 'Open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_app.status is distinct from 'For Verification' then
    raise exception 'Documents can be added only while the application is at document verification.';
  end if;

  if coalesce(cardinality(v_ids), 0) < v_req.min_files then
    raise exception 'Choose at least % file(s) to answer this request.', v_req.min_files;
  end if;

  select count(*) into v_valid
  from public.documents d
  where d.id = any(v_ids)
    and d.owner_id = v_actor
    and d.verification_status <> 'Rejected'
    and (v_req.kind = 'free_text' or d.document_type = any(v_req.document_types))
    and not exists (
      select 1 from public.application_documents ad
      where ad.application_id = v_req.application_id and ad.document_id = d.id
    );
  if v_valid <> cardinality(v_ids) then
    raise exception 'Each file must be your own, not reverted, not already attached, and of the type requested.';
  end if;

  insert into public.application_documents (application_id, document_id)
  select v_req.application_id, unnest(v_ids);

  update public.application_document_requests
     set status = 'Fulfilled', fulfilled_at = now()
   where id = p_request_id
  returning * into v_req;

  select title into v_title from public.scholarships where id = v_app.scholarship_id;

  insert into public.notifications (profile_id, title, body, channel, status, source_key)
  select p.user_id,
    'Requested documents received',
    'An applicant added the documents you requested for ' || coalesce(v_title, 'a scholarship')
      || '. Verify them in the review queue.',
    'In-app',
    'Unread',
    'documents-provided-' || v_req.id::text
  from public.profiles p
  where p.role = 'admissions_admin'
    and p.deactivated_at is null
    and (p.notification_preferences ->> 'inAppEnabled') is distinct from 'false'
  on conflict (profile_id, source_key) do nothing;

  return v_req;
end;
$$;

revoke all on function public.fulfill_document_request(uuid, uuid[]) from public, anon;
grant execute on function public.fulfill_document_request(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- An Open request holds the case at verification.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_document_verification_before_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding integer;
  v_open_requests integer;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released') then
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

  select count(*)
    into v_open_requests
    from public.application_document_requests r
    where r.application_id = new.id
      and r.status = 'Open';

  if v_open_requests > 0 then
    raise exception 'This application still has % open document request(s). Wait for the student''s files, or cancel the request, before it advances.', v_open_requests
      using errcode = '23514';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
