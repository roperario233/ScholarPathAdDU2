create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  full_name text not null,
  role text not null check (role in ('student', 'admissions_office', 'department_chair')),
  email text,
  phone text,
  department text,
  degree_program text,
  qpi numeric(3, 2),
  household_income numeric(12, 2),
  has_active_government_grant boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles add column if not exists student_number text;
alter table profiles drop constraint if exists profiles_role_check;
update profiles set role = 'admissions_office' where role = 'osa_admin';
alter table profiles add constraint profiles_role_check
  check (role in ('student', 'admissions_office', 'department_chair'));

-- Server-side mirror of the notification center settings (see
-- src/lib/demoState.js `notificationPreferences`). Required so the scheduled
-- reminder Edge Function can honor the Email Notifications toggle and the
-- 7-day / 3-day / 1-day reminder choices, which otherwise live only in the
-- browser's localStorage. Shape: { smsEnabled, emailEnabled, inAppEnabled,
-- deadlineReminders: { oneWeekBefore, threeDaysBefore, dayBefore } }.
alter table profiles add column if not exists notification_preferences jsonb not null default '{}'::jsonb;

-- My Profile details (see migrations/20261005140000_add_profile_details.sql):
-- a short bio and the extended Smart Eligibility Checker attributes listed in
-- src/lib/profile.js (ELIGIBILITY_ATTRIBUTE_KEYS).
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists eligibility_attributes jsonb not null default '{}'::jsonb;
alter table profiles drop constraint if exists profiles_bio_length_check;
alter table profiles add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 280);

-- Descriptive My Profile fields that are not eligibility inputs (see
-- migrations/20261008000000_add_profile_details_json.sql): religion, civil
-- status, address, country, family details, and the scholarship essay. The field
-- keys mirror PROFILE_DETAIL_KEYS in src/lib/profile.js.
alter table profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;

create table if not exists scholarships (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  origin text not null,
  coverage_type text not null,
  coverage text not null,
  minimum_qpi numeric(3, 2),
  maximum_income numeric(12, 2),
  eligible_degrees text[] not null default '{}'::text[],
  allows_multiple_grants boolean not null default true,
  department_scope text,
  deadline date,
  is_active boolean not null default true,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique title so seed upserts (on_conflict=title) are idempotent.
create unique index if not exists scholarships_title_key on scholarships (title);

-- Manuscript-only metadata used by the eligibility engine and UI.
alter table scholarships add column if not exists rule_family text;
alter table scholarships add column if not exists gov_program text;
alter table scholarships add column if not exists is_matchable boolean not null default true;
alter table scholarships add column if not exists application_route text;
alter table scholarships add column if not exists is_external boolean not null default false;
alter table scholarships add column if not exists appendix_number integer;
-- Incoming first-years have no collegiate QPI, so the general pool gates them on
-- their senior high school general average instead (see getAcademicRequirement
-- in src/lib/eligibility.js). NULL falls back to GENERAL_POOL_SHS_AVERAGE_FLOOR.
alter table scholarships add column if not exists minimum_shs_average numeric(5, 2);
-- Documents a student must attach before submitting (see
-- migrations/20261012000000_add_application_requirements.sql for the default
-- lists and src/lib/applicationRequirements.js for the client mirror). Each item:
-- { id, label, documentTypes: [vault document types], standing: 'all' | 'incoming' | 'continuing' }.
alter table scholarships add column if not exists required_documents jsonb not null default '[]'::jsonb;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(user_id) on delete cascade,
  title text not null,
  file_name text not null,
  document_type text not null,
  verification_status text not null default 'Pending' check (verification_status in ('Pending', 'Verified', 'Rejected')),
  storage_path text,
  shared_with text[] not null default '{}'::text[],
  uploaded_at timestamptz not null default now()
);

-- Profile-attribute proof links: which profile attribute(s) a vault document
-- proves (see src/lib/verification.js and VERIFIABLE_ATTRIBUTE_OPTIONS in
-- src/lib/profile.js). Additive so existing rows keep working.
alter table documents add column if not exists linked_attributes text[] not null default '{}'::text[];
-- The normalized declared value each linked attribute had at upload (e.g.
-- `{"qpi": 3.2}`); a proof whose value no longer matches the profile, or an
-- annual proof from an earlier academic year, reads as Outdated.
alter table documents add column if not exists attested_values jsonb not null default '{}'::jsonb;
-- Why the Admissions Office rejected the file; required on the move into
-- Rejected and cleared when the file leaves it
-- (see 20261020000000_add_document_rejection_reason.sql).
alter table documents add column if not exists rejection_reason text;
-- When the current verification decision was made; keys the per-decision
-- student notification (see 20261021000000_replace_rejected_application_documents.sql).
alter table documents add column if not exists verification_decided_at timestamptz;

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(user_id) on delete cascade,
  scholarship_id uuid not null references scholarships(id) on delete cascade,
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Under Review', 'For Verification', 'Approved', 'Rejected')),
  document_status text not null default 'Pending' check (document_status in ('Pending', 'Verified', 'Rejected')),
  notes text,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Standard Procedure stage records (endorsement, interview, deliberation,
-- release) and the event timeline live on applications as JSON payloads. Keep
-- these alters after table creation so this reference schema works on a fresh DB.
alter table applications add column if not exists endorsement jsonb;
alter table applications add column if not exists interview jsonb;
alter table applications add column if not exists deliberation jsonb;
alter table applications add column if not exists release jsonb;
alter table applications add column if not exists timeline jsonb not null default '[]'::jsonb;
-- The application statement, the self-reported profile values frozen at submit,
-- and the student's certification (see the submit gate trigger below).
alter table applications add column if not exists statement text;
alter table applications add column if not exists profile_snapshot jsonb;
alter table applications add column if not exists certified_at timestamptz;

-- Widen the application status check to cover the SOP stage sequence
-- (Endorsed, Interview, Recommended, Released) additively.
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check
  check (status in ('Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'));

create table if not exists application_documents (
  application_id uuid not null references applications(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  primary key (application_id, document_id)
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null,
  created_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(user_id) on delete cascade,
  title text not null,
  body text not null,
  channel text not null check (channel in ('SMS', 'Email', 'In-app')),
  status text not null default 'Unread' check (status in ('Unread', 'Read')),
  source_key text,
  created_at timestamptz not null default now()
);
alter table notifications add column if not exists source_key text;
create unique index if not exists notifications_profile_source_key_unique
  on notifications (profile_id, source_key);

create table if not exists academic_programs (
  id uuid primary key default gen_random_uuid(),
  value text not null unique,
  label text not null,
  department text not null,
  category text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists department_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  reviewer_id uuid not null references profiles(user_id) on delete cascade,
  student_name text not null,
  department text not null,
  qpi numeric(3, 2) not null,
  household_income numeric(12, 2) not null,
  status text not null,
  recommendation text,
  created_at timestamptz not null default now()
);
alter table department_reviews add column if not exists application_id uuid references applications(id) on delete cascade;
create unique index if not exists department_reviews_application_reviewer_unique
  on department_reviews (application_id, reviewer_id);

alter table profiles enable row level security;
alter table scholarships enable row level security;
alter table documents enable row level security;
alter table applications enable row level security;
alter table application_documents enable row level security;
alter table announcements enable row level security;
alter table notifications enable row level security;
alter table department_reviews enable row level security;
alter table academic_programs enable row level security;

-- Role helpers are security-definer functions so RLS checks do not recurse
-- through the profiles table. The role is still stored in profiles and is
-- never accepted from the browser for authorization decisions.
create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$ select role from public.profiles where user_id = auth.uid() limit 1 $$;

create or replace function public.current_profile_department()
returns text
language sql
security definer
set search_path = public
stable
as $$ select department from public.profiles where user_id = auth.uid() limit 1 $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, role, email, student_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'ScholarPath user'),
    -- Public registration cannot grant privileged roles. Assign Admissions Office
    -- or Department Chair only after verifying the account in Supabase.
    'student',
    new.email,
    nullif(new.raw_user_meta_data->>'student_id', '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop policy if exists "profiles_self_read_write" on profiles;
drop policy if exists "staff_read_profiles" on profiles;
drop policy if exists "scholarships_read_all" on scholarships;
drop policy if exists "admissions_office_scholarships_manage" on scholarships;
drop policy if exists "documents_self_access" on documents;
drop policy if exists "osa_documents_access" on documents;
drop policy if exists "admissions_office_documents_access" on documents;
drop policy if exists "chair_documents_read" on documents;
drop policy if exists "applications_self_access" on applications;
drop policy if exists "osa_applications_access" on applications;
drop policy if exists "admissions_office_applications_access" on applications;
drop policy if exists "chair_applications_read" on applications;
drop policy if exists "chair_applications_status" on applications;
drop policy if exists "chair_applications_flag_for_validation" on applications;
drop policy if exists "chair_applications_endorse" on applications;
drop policy if exists "application_documents_self_access" on application_documents;
drop policy if exists "application_documents_self_read" on application_documents;
drop policy if exists "application_documents_self_draft_insert" on application_documents;
drop policy if exists "application_documents_self_draft_delete" on application_documents;
drop policy if exists "staff_application_documents_access" on application_documents;
drop policy if exists "announcements_read_all" on announcements;
drop policy if exists "osa_announcements_manage" on announcements;
drop policy if exists "admissions_office_announcements_manage" on announcements;
drop policy if exists "notifications_self_access" on notifications;
drop policy if exists "department_reviews_restricted" on department_reviews;
drop policy if exists "chair_department_reviews_access" on department_reviews;
drop policy if exists "academic_programs_read_all" on academic_programs;
drop policy if exists "osa_academic_programs_manage" on academic_programs;
drop policy if exists "admissions_office_academic_programs_manage" on academic_programs;

create policy "profiles_self_read_write" on profiles
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_read_profiles" on profiles
for select using (public.current_profile_role() in ('admissions_office', 'department_chair'));

create policy "scholarships_read_all" on scholarships
for select using (true);
create policy "admissions_office_scholarships_manage" on scholarships
for all using (
  public.current_profile_role() = 'admissions_office'
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
) with check (
  public.current_profile_role() = 'admissions_office'
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
);
create policy "documents_self_access" on documents
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "admissions_office_documents_access" on documents
for all using (public.current_profile_role() = 'admissions_office') with check (public.current_profile_role() = 'admissions_office');
create policy "chair_documents_read" on documents
for select using (
  public.current_profile_role() = 'department_chair'
  and exists (select 1 from profiles p where p.user_id = documents.owner_id and p.department = public.current_profile_department())
);
create policy "applications_self_access" on applications
for all using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "admissions_office_applications_access" on applications
for all using (public.current_profile_role() = 'admissions_office') with check (public.current_profile_role() = 'admissions_office');
create policy "chair_applications_read" on applications
for select using (
  public.current_profile_role() = 'department_chair'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
);
create policy "chair_applications_flag_for_validation" on applications
for update using (
  public.current_profile_role() = 'department_chair'
  and status in ('Submitted', 'Under Review')
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
) with check (
  public.current_profile_role() = 'department_chair'
  and status = 'For Verification'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
);
create policy "chair_applications_endorse" on applications
for update using (
  public.current_profile_role() = 'department_chair'
  and status = 'For Endorsement'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
) with check (
  public.current_profile_role() = 'department_chair'
  and status = 'Endorsed'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
);
-- Students attach or detach only their own vault files, and only while the
-- application is still a Draft.
create policy "application_documents_self_read" on application_documents
for select using (
  exists (select 1 from applications a where a.id = application_id and a.student_id = auth.uid())
);
create policy "application_documents_self_draft_insert" on application_documents
for insert with check (
  exists (select 1 from applications a where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft')
  and exists (select 1 from documents d where d.id = document_id and d.owner_id = auth.uid())
);
create policy "application_documents_self_draft_delete" on application_documents
for delete using (
  exists (select 1 from applications a where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft')
);
create policy "staff_application_documents_access" on application_documents
for all using (public.current_profile_role() in ('admissions_office', 'department_chair'))
with check (public.current_profile_role() in ('admissions_office', 'department_chair'));
create policy "announcements_read_all" on announcements
for select using (true);
create policy "admissions_office_announcements_manage" on announcements
for insert with check (public.current_profile_role() = 'admissions_office' and created_by = auth.uid());
create policy "notifications_self_access" on notifications
for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "department_reviews_restricted" on department_reviews
for select using (auth.uid() = reviewer_id);
create policy "chair_department_reviews_access" on department_reviews
for all using (public.current_profile_role() = 'department_chair' and auth.uid() = reviewer_id)
with check (public.current_profile_role() = 'department_chair' and auth.uid() = reviewer_id);
create policy "academic_programs_read_all" on academic_programs
for select using (true);
create policy "admissions_office_academic_programs_manage" on academic_programs
for all using (public.current_profile_role() = 'admissions_office') with check (public.current_profile_role() = 'admissions_office');

-- ---------------------------------------------------------------------------
-- Student submit gate. Staff transitions keep their own RLS policies; this
-- trigger only constrains the student, whose self-access policy otherwise
-- allows any column change on their own rows:
--   * a student creates applications only as Draft;
--   * a student edits only Draft rows, and may move them only to Submitted;
--   * submission needs an AdDU internal scholarship that is still open, a
--     certification, a statement, and a non-rejected vault file attached for
--     every required document that applies to the student's year standing.
--
-- "In scope" is decided by the scholarship *title* (is_addu_in_scope_track),
-- never by rule_family alone: other internal catalog entries can share those
-- values without being GIA, Jubilee, or SA. Mirrors isAdduInternalProgram() in
-- src/lib/eligibility.js.
-- ---------------------------------------------------------------------------
create or replace function public.is_addu_in_scope_track(p_title text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_title, ''))) ~ 'jubilee|grant[ -]?in[ -]?aid|(^|[^a-z])gia([^a-z]|$)|student assistant|working scholar';
$$;

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
    -- An internal catalog entry that is not one of the three in-scope tracks
    -- cannot even be started. External/government-linked entries are tracked
    -- only, so a Draft row there is allowed.
    select * into v_scholarship from public.scholarships where id = new.scholarship_id;
    if found
      and coalesce(v_scholarship.is_external, false) = false
      and coalesce(v_scholarship.rule_family, '') in ('general-pool', 'honors', 'work-study')
      and not public.is_addu_in_scope_track(v_scholarship.title) then
      raise exception 'Only the AdDU internal scholarship tracks are in scope: Grant-in-Aid (GIA), Jubilee, and the Student Assistant Program.' using errcode = '23514';
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
  if not public.is_addu_in_scope_track(v_scholarship.title) then
    raise exception 'Only the AdDU internal scholarship tracks are in scope: Grant-in-Aid (GIA), Jubilee, and the Student Assistant Program.' using errcode = '23514';
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

-- Manuscript Section 3.3.3: an application linked to a Pending or Rejected
-- document cannot proceed to interview or subcommittee evaluation. The
-- Admissions Office role has `for all` access to applications, so the gate is
-- enforced here and not only in the reviewer UI. Rejection is always allowed.
-- Mirrors isApplicationVerifiedForEndorsement() in
-- src/lib/applicationRequirements.js.
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
-- Append-only application status log (RQ2 audit trail).
--
-- `applications.timeline` (JSON) is browser-written with a role label as the
-- actor, and Admissions Office staff have `for all` access to applications, so
-- it is not a trustworthy record of who changed a status. Every status change
-- is recorded here from an AFTER UPDATE trigger instead: actor_id is auth.uid()
-- and actor_role comes from current_profile_role(); a system move carries a null
-- actor_id and actor_role 'system'. Nothing may update or delete a row, and only
-- the security-definer trigger inserts.
-- ---------------------------------------------------------------------------
create table if not exists public.application_status_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  from_status text,
  to_status text not null,
  actor_id uuid,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists application_status_log_application_id_idx
  on public.application_status_log (application_id, created_at);

create or replace function public.log_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.status is distinct from old.status then
    select e.value ->> 'note'
      into v_reason
      from jsonb_array_elements(coalesce(new.timeline, '[]'::jsonb)) with ordinality as e(value, ord)
      where e.value ->> 'stage' = new.status
      order by e.ord desc
      limit 1;

    insert into public.application_status_log (application_id, from_status, to_status, actor_id, actor_role, reason)
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      coalesce(public.current_profile_role(), 'system'),
      v_reason
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_application_status_change on public.applications;
create trigger log_application_status_change
  after update on public.applications
  for each row execute function public.log_application_status_change();

alter table public.application_status_log enable row level security;

drop policy if exists "status_log_staff_read" on public.application_status_log;
create policy "status_log_staff_read" on public.application_status_log
for select using (
  public.current_profile_role() = 'admissions_office'
  or (
    public.current_profile_role() = 'department_chair'
    and exists (
      select 1 from public.applications a
      join public.profiles p on p.user_id = a.student_id
      where a.id = application_status_log.application_id
        and p.department = public.current_profile_department()
    )
  )
);

drop policy if exists "status_log_student_read" on public.application_status_log;
create policy "status_log_student_read" on public.application_status_log
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_status_log.application_id
      and a.student_id = auth.uid()
  )
);

-- Students own their vault rows (documents_self_access is FOR ALL), but the
-- review fields belong to the Admissions Office: a student cannot mark a file
-- Verified, relink it, rewrite the value it attests, or backdate it into the
-- current academic year (see 20261013000000_add_document_attested_values.sql).
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

drop trigger if exists protect_document_review_fields on public.documents;
create trigger protect_document_review_fields
  before insert or update on public.documents
  for each row execute function public.protect_document_review_fields();

-- A file cannot move into Rejected without a recorded reason, and the reason is
-- cleared once the file leaves Rejected. The check runs on the transition only,
-- so a file rejected before the column existed stays editable
-- (see 20261020000000_add_document_rejection_reason.sql).
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

drop trigger if exists require_document_rejection_reason on public.documents;
create trigger require_document_rejection_reason
  before update on public.documents
  for each row execute function public.require_document_rejection_reason();

-- A student may swap a Rejected file attached to their own pre-endorsement
-- application (Submitted, Under Review, For Verification) for another of their
-- non-rejected vault files of the same kind. The status does not change and the
-- new file arrives Pending. application_documents links are otherwise Draft-only
-- for students (see 20261021000000_replace_rejected_application_documents.sql;
-- mirrors replaceRejectedDocument() in src/App.jsx).
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

-- A Verified file that a live application already relies on cannot be
-- un-verified, because the document-verification gate would then strand that
-- application. The staff revert the application first.
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

drop trigger if exists protect_verified_documents_on_progress on public.documents;
create trigger protect_verified_documents_on_progress
  before update on public.documents
  for each row execute function public.protect_verified_documents_on_progress();

-- ---------------------------------------------------------------------------
-- Document Vault storage.
--
-- File bytes live in a private Supabase Storage bucket (`documents`); the
-- documents table keeps the metadata and records the object path in
-- storage_path. Viewing uses short-lived signed URLs. Students manage only their
-- own folder (documents/<auth.uid()>/<documentId>/<file>); the Admissions Office
-- reads every document; a Department Chair reads documents owned by students in
-- the chair's department (the first path segment is the owner's user_id).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents_storage_owner_access" on storage.objects;
create policy "documents_storage_owner_access" on storage.objects
for all to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "documents_storage_admissions_office_read" on storage.objects;
create policy "documents_storage_admissions_office_read" on storage.objects
for select to authenticated
using (bucket_id = 'documents' and public.current_profile_role() = 'admissions_office');

drop policy if exists "documents_storage_chair_read" on storage.objects;
create policy "documents_storage_chair_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_profile_role() = 'department_chair'
  and exists (
    select 1 from public.profiles p
    where p.user_id::text = (storage.foldername(name))[1]
      and p.department = public.current_profile_department()
  )
);

-- ---------------------------------------------------------------------------
-- Server-side deadline reminder delivery ledger.
--
-- One row per delivered reminder (source_key = `deadline-reminder-<id>-<days>`
-- scoped to a user as `<sourceKey>:<userId>`; application status emails use
-- `application-status-<applicationId>-<status>`). Used by the
-- process-deadline-reminders and notify-application-status Edge Functions to
-- guarantee each reminder reaches a student at most once, regardless of how
-- often the scheduled job runs. Written only via the service role.
--
-- The email_* columns record the Resend outcome so a failed send stays
-- observable instead of silently disappearing; the sms_* columns record the
-- matching iprogSMS outcome (sms_message_id is the gateway's queue-accept id,
-- since iprogSMS has no delivery webhooks).
-- ---------------------------------------------------------------------------
create table if not exists notification_email_log (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  user_id uuid not null,
  reminder_title text,
  email_to text,
  email_status text check (email_status in ('sent', 'failed', 'skipped')),
  email_id text,
  email_error text,
  sms_to text,
  sms_status text check (sms_status in ('sent', 'failed', 'skipped')),
  sms_message_id text,
  sms_error text,
  delivered_at timestamptz not null default now(),
  unique (source_key, user_id)
);

-- ---------------------------------------------------------------------------
-- Student-created calendar deadlines, persisted so server-side reminders can
-- email them. `id` is text because the client generates `custom-<uuid>` ids and
-- keeping them verbatim makes the client and server reminder sourceKeys
-- identical, which is what lets src/lib/notificationMerge.js collapse the
-- duplicate in-app rows.
-- ---------------------------------------------------------------------------
create table if not exists custom_deadlines (
  id text primary key,
  owner_id uuid not null references profiles(user_id) on delete cascade,
  title text not null,
  deadline date not null,
  created_at timestamptz not null default now()
);

create index if not exists custom_deadlines_owner_id_idx on custom_deadlines (owner_id);

alter table custom_deadlines enable row level security;

create policy "custom_deadlines_self_access" on custom_deadlines
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

alter table notification_email_log enable row level security;

create policy "notification_email_log_self_read" on notification_email_log
for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Scheduled trigger for process-deadline-reminders (pg_cron + pg_net).
--
-- Requires the pg_cron and pg_net extensions (available on Supabase projects;
-- enable them from the dashboard if not already active). Runs daily at
-- 07:00 Asia/Manila.
--
-- Applied to the deployed project by the migration
-- supabase/migrations/20261005000001_schedule_deadline_reminders.sql; the block
-- below stays as the documented, project-ref-agnostic reference for a fresh
-- project.
--
-- Setup, in order:
--   1. Replace <project-ref> below with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> below with the same long random value you
--      set as the REMINDER_CRON_SECRET Edge Function secret. The scheduled
--      caller authenticates with it, and the function compares it by exact value
--      (failing closed when its own secret is unset). The value is bound into the
--      scheduled command because Supabase's `postgres` role cannot run
--      `alter database postgres set app.settings.reminder_cron_secret`.
--   3. Run the create extension and cron.schedule statements below.
--
-- The function deliberately runs with verify_jwt disabled: the platform-level
-- JWT check rejects the service role key, and a shared secret is compared by
-- exact value inside the function instead. Never send the anon key here — it is
-- public, and this endpoint can email every student.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'process-deadline-reminders-daily',
--   '0 23 * * *',  -- 07:00 PHT (UTC+8)
--   $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/process-deadline-reminders',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- ---------------------------------------------------------------------------
-- Database-triggered status notification (pg_net) — Chapter 3, Section 3.3.4.
--
-- Fires notify-application-status whenever applications.status changes, so the
-- alert is sent even if the browser closes between the status write and its own
-- call. The function is idempotent on `application-status-<id>-<status>`, so the
-- browser call becomes a retry.
--
-- Applied to the deployed project by the migration
-- supabase/migrations/20261014000003_notify_application_status_from_database.sql;
-- the block below stays as the documented, project-ref-agnostic reference.
--
-- Setup: replace <project-ref> and <REMINDER_CRON_SECRET> with the deployed
-- values, then run the statements. notify-application-status must be deployed
-- with verify_jwt disabled (like process-deadline-reminders): it authenticates
-- the shared secret itself and still validates a signed-in user's JWT.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_net;
--
-- create or replace function public.notify_application_status_change()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public, net
-- as $$
-- begin
--   if new.status is distinct from old.status then
--     perform net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/notify-application-status',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
--         'Content-Type', 'application/json'
--       ),
--       body := jsonb_build_object('applicationId', new.id)
--     );
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists notify_application_status_change on public.applications;
-- create trigger notify_application_status_change
--   after update on public.applications
--   for each row execute function public.notify_application_status_change();

-- ---------------------------------------------------------------------------
-- Document verification notifications from the database (pg_net).
--
-- When the Admissions Office verifies or rejects a Document Vault file, this
-- trigger calls notify-document-verification, which writes the student's in-app
-- row and, for a rejection, emails and texts the reason. The function dedupes
-- on `document-verification-<documentId>-<status>-<decidedAtEpoch>`, so the
-- browser's call after the write is a retry.
--
-- Applied to the deployed project by the migration
-- supabase/migrations/20261021000001_notify_document_verification_from_database.sql.
-- Setup: replace <project-ref> and <REMINDER_CRON_SECRET>, and deploy the
-- function with verify_jwt disabled.
-- ---------------------------------------------------------------------------
-- create or replace function public.notify_document_verification_change()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public, net
-- as $$
-- begin
--   if new.verification_status is distinct from old.verification_status
--     and new.verification_status in ('Verified', 'Rejected') then
--     perform net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/notify-document-verification',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
--         'Content-Type', 'application/json'
--       ),
--       body := jsonb_build_object('documentId', new.id)
--     );
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists notify_document_verification_change on public.documents;
-- create trigger notify_document_verification_change
--   after update on public.documents
--   for each row execute function public.notify_document_verification_change();

