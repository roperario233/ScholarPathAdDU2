-- Connected application flow: per-scholarship required documents, the
-- application statement / profile snapshot / certification, and a server-side
-- submit gate. The client mirror of these rules is src/lib/applicationRequirements.js;
-- keep the default lists below identical to DEFAULT_REQUIRED_DOCUMENTS there.

-- ---------------------------------------------------------------------------
-- Columns (additive).
-- ---------------------------------------------------------------------------
-- Each item: { id, label, documentTypes: [vault document types], standing: 'all' | 'incoming' | 'continuing' }.
alter table public.scholarships add column if not exists required_documents jsonb not null default '[]'::jsonb;

alter table public.applications add column if not exists statement text;
alter table public.applications add column if not exists profile_snapshot jsonb;
alter table public.applications add column if not exists certified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Default requirements (Standard Procedure step 2), only where an entry has none.
-- ---------------------------------------------------------------------------
update public.scholarships set required_documents = '[
  {"id": "application-form", "label": "Application Form", "documentTypes": ["Application Form"], "standing": "all"},
  {"id": "entrance-exam", "label": "Entrance exam result with ACCEPTED remark", "documentTypes": ["Entrance Exam Result"], "standing": "incoming"},
  {"id": "hs-report-card", "label": "Senior high school report card with at least 85% average", "documentTypes": ["HS Report Card"], "standing": "incoming"},
  {"id": "college-grades", "label": "Latest grade report or transcript", "documentTypes": ["Grade Report", "Transcript"], "standing": "continuing"},
  {"id": "recommendation", "label": "Recommendation from Homeroom Moderator", "documentTypes": ["Recommendation Letter"], "standing": "incoming"},
  {"id": "income-proof", "label": "Financial income documents of parents / legal guardians", "documentTypes": ["Income Proof", "Certificate of Indigency"], "standing": "all"},
  {"id": "residence-photos", "label": "Photos of residence", "documentTypes": ["Photos of Residence"], "standing": "all"},
  {"id": "good-moral", "label": "Certificate of Good Moral Character", "documentTypes": ["Good Moral Character"], "standing": "all"}
]'::jsonb
where rule_family = 'general-pool' and required_documents = '[]'::jsonb;

update public.scholarships set required_documents = '[
  {"id": "application-form", "label": "Application Form", "documentTypes": ["Application Form"], "standing": "all"},
  {"id": "certificate-of-award", "label": "Certificate of Award as Rank 1 or 2", "documentTypes": ["Certificate of Award"], "standing": "all"},
  {"id": "hs-report-card", "label": "Senior high school report card", "documentTypes": ["HS Report Card"], "standing": "incoming"},
  {"id": "college-grades", "label": "Latest grade report or transcript", "documentTypes": ["Grade Report", "Transcript"], "standing": "continuing"},
  {"id": "good-moral", "label": "Certificate of Good Moral Character", "documentTypes": ["Good Moral Character"], "standing": "all"}
]'::jsonb
where rule_family = 'honors' and required_documents = '[]'::jsonb;

update public.scholarships set required_documents = '[
  {"id": "application-form", "label": "Application Form", "documentTypes": ["Application Form"], "standing": "all"},
  {"id": "income-proof", "label": "Financial income documents of parents / legal guardians", "documentTypes": ["Income Proof", "Certificate of Indigency"], "standing": "all"},
  {"id": "hs-report-card", "label": "Senior high school report card", "documentTypes": ["HS Report Card"], "standing": "incoming"},
  {"id": "college-grades", "label": "Latest grade report or transcript", "documentTypes": ["Grade Report", "Transcript"], "standing": "continuing"},
  {"id": "good-moral", "label": "Certificate of Good Moral Character", "documentTypes": ["Good Moral Character"], "standing": "all"}
]'::jsonb
where rule_family = 'work-study' and required_documents = '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Student submit gate. Staff transitions keep their own RLS policies; this
-- trigger only constrains the student, whose self-access policy otherwise
-- allows any column change on their own rows:
--   * a student creates applications only as Draft;
--   * a student edits only Draft rows, and may move them only to Submitted;
--   * submission needs an AdDU internal scholarship that is still open, a
--     certification, a statement, and a non-rejected vault file attached for
--     every required document that applies to the student's year standing.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_student_application_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_is_incoming boolean;
  v_item jsonb;
begin
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'Draft' then
      raise exception 'New applications start as drafts.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.student_id <> old.student_id or new.scholarship_id <> old.scholarship_id then
    raise exception 'An application cannot be moved to another student or scholarship.' using errcode = '42501';
  end if;
  if old.status <> 'Draft' then
    raise exception 'A submitted application can no longer be changed by the student.' using errcode = '42501';
  end if;
  if new.status = 'Draft' then
    return new;
  end if;
  if new.status <> 'Submitted' then
    raise exception 'Students can only submit a draft application.' using errcode = '42501';
  end if;

  select * into v_scholarship from public.scholarships where id = new.scholarship_id;
  if not found
    or v_scholarship.is_external
    or coalesce(v_scholarship.rule_family, '') not in ('general-pool', 'honors', 'work-study') then
    raise exception 'External programs are tracked only. Apply through the provider.' using errcode = '23514';
  end if;
  if not v_scholarship.is_active
    or (v_scholarship.deadline is not null and v_scholarship.deadline < (now() at time zone 'Asia/Manila')::date) then
    raise exception 'This scholarship is no longer accepting applications.' using errcode = '23514';
  end if;
  if new.certified_at is null then
    raise exception 'Certify that your information and documents are true and complete.' using errcode = '23514';
  end if;
  if coalesce(btrim(new.statement), '') = '' then
    raise exception 'Write your application statement.' using errcode = '23514';
  end if;

  select coalesce(p.eligibility_attributes ->> 'yearStanding', '') = 'incoming-1st'
    into v_is_incoming
    from public.profiles p
    where p.user_id = new.student_id;

  for v_item in select value from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) loop
    if (v_item ->> 'standing') = 'incoming' and not coalesce(v_is_incoming, false) then continue; end if;
    if (v_item ->> 'standing') = 'continuing' and coalesce(v_is_incoming, false) then continue; end if;
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type in (select jsonb_array_elements_text(v_item -> 'documentTypes'))
    ) then
      raise exception 'Attach the required document: %.', v_item ->> 'label' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_student_application_update on public.applications;
create trigger enforce_student_application_update
  before insert or update on public.applications
  for each row execute function public.enforce_student_application_update();

-- A student may not delete a vault file that a submitted application relies on;
-- the foreign-key cascade would otherwise silently unlink it from the review.
create or replace function public.protect_submitted_application_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_profile_role() = 'student' and exists (
    select 1
    from public.application_documents ad
    join public.applications a on a.id = ad.application_id
    where ad.document_id = old.id and a.status <> 'Draft'
  ) then
    raise exception 'This document is attached to a submitted application and cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_submitted_application_documents on public.documents;
create trigger protect_submitted_application_documents
  before delete on public.documents
  for each row execute function public.protect_submitted_application_documents();

-- ---------------------------------------------------------------------------
-- Students attach or detach only their own vault files, and only while the
-- application is still a Draft. Staff access is unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "application_documents_self_access" on public.application_documents;
drop policy if exists "application_documents_self_read" on public.application_documents;
drop policy if exists "application_documents_self_draft_insert" on public.application_documents;
drop policy if exists "application_documents_self_draft_delete" on public.application_documents;
create policy "application_documents_self_read" on public.application_documents
for select using (
  exists (select 1 from public.applications a where a.id = application_id and a.student_id = auth.uid())
);
create policy "application_documents_self_draft_insert" on public.application_documents
for insert with check (
  exists (select 1 from public.applications a where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft')
  and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid())
);
create policy "application_documents_self_draft_delete" on public.application_documents
for delete using (
  exists (select 1 from public.applications a where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft')
);

-- Ask PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';
