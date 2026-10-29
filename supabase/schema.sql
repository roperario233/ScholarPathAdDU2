create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  full_name text not null,
  role text not null check (role in ('student', 'admissions_office', 'admissions_head', 'department_chair')),
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
  check (role in ('student', 'admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair'));

-- The reviewer scope ladder: a Dean owns a School, an Assistant Dean a Cluster, and a
-- Chairperson a Department (and its degree programs). `department` still holds the
-- school label, which the legacy fallback for an unscoped Chairperson compares. See
-- supabase/migrations/20261042000001_reviewer_scope_ladder.sql and
-- src/lib/reviewScope.js.
alter table profiles add column if not exists review_school text;
alter table profiles add column if not exists review_cluster text;
alter table profiles add column if not exists review_department text;
alter table profiles drop constraint if exists profiles_review_scope_check;
alter table profiles add constraint profiles_review_scope_check check (
  (review_cluster is null or role = 'assistant_dean')
  and (review_department is null or role = 'department_chair')
  and (review_school is null or role in ('dean', 'assistant_dean', 'department_chair'))
);

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

-- The current profile photo object key in the private `avatars` bucket (see
-- migrations/20261026000000_add_profile_avatar.sql). A profile photo is
-- personal: it is shown in the signed-in user's header and My Profile only and
-- is never sent with an application.
alter table profiles add column if not exists avatar_path text;

-- Descriptive My Profile fields that are not eligibility inputs (see
-- migrations/20261008000000_add_profile_details_json.sql): religion, civil
-- status, address, country, family details, and the scholarship essay. The field
-- keys mirror PROFILE_DETAIL_KEYS in src/lib/profile.js.
alter table profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;

-- Annual QPI history (see migrations/20261047000001_add_annual_qpi_records.sql).
-- One row per student per academic year, written by updateUserProfile /
-- updateProfileFields in src/lib/auth.js whenever a QPI is saved. A student reads
-- and writes only their own rows.
create table if not exists annual_qpi_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  academic_year text not null,
  qpi numeric not null check (qpi >= 0 and qpi <= 4),
  recorded_at timestamptz not null default now(),
  unique (user_id, academic_year)
);

alter table annual_qpi_records enable row level security;

create policy "annual_qpi_records_self_access" on annual_qpi_records
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
-- Every in-scope track also asks for `applicant-photo` (Applicant Photo) and
-- `residence-photos` (Photos of Residence); existing catalog rows receive both
-- from migrations/20261026000001_add_applicant_photo_requirement.sql.
-- Every in-scope track also asks for `citizenship-proof` (Proof of Filipino
-- citizenship), backfilled by
-- migrations/20261028000000_require_current_attribute_proofs.sql, which also
-- backfills each vault file's linked_attributes from its document type.
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
-- The Admissions Office account that recorded the current decision and its
-- role, stamped by the trigger from auth.uid() / current_profile_role() and
-- cleared when the file returns to Pending
-- (see 20261027000000_add_document_decision_actor.sql).
alter table documents add column if not exists reviewed_by uuid references profiles(user_id) on delete set null;
alter table documents add column if not exists reviewed_by_role text;
-- Covering index for the new foreign key
-- (see 20261027000000_add_document_decision_actor.sql).
create index if not exists documents_reviewed_by_idx on documents (reviewed_by);

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

-- The AdDU Higher Education Unit (Jacinto Campus) undergraduate hierarchy:
--   School -> Cluster -> Department -> Degree program
-- `school` is the value `profiles.department` stores (the reviewer scope label);
-- `department` is the level the reviewer scope ladder resolves against; `cluster`
-- is null for SEA, SOE, and SON, which have no sub-clusters. `value` is the stable
-- key referenced by `profiles.degree_program` and
-- `scholarships.eligible_degrees`, so it is never renamed.
-- See supabase/migrations/20261042000000_academic_program_hierarchy.sql.
create table if not exists academic_programs (
  id uuid primary key default gen_random_uuid(),
  value text not null unique,
  label text not null,
  school text not null,
  cluster text,
  department text not null,
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

-- Internal reviewer discussion for the endorsement workflow. Staff-only,
-- append-only, and department-scoped for Department Chairs
-- (see 20261023000000_add_application_review_comments.sql).
create table if not exists application_review_comments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id uuid not null references profiles(user_id) on delete cascade,
  author_role text not null check (author_role in ('admissions_office', 'admissions_head', 'department_chair')),
  author_name text not null,
  kind text not null default 'note' check (kind in ('note', 'question', 'decision')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists application_review_comments_application_idx
  on application_review_comments (application_id, created_at);

-- The roster of Admissions Office accounts that have opened a case
-- (see 20261027043147_add_application_case_officers.sql). Staff-only: the
-- student never learns which officer holds their application, so this never
-- becomes a column on applications.
create table if not exists application_case_officers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  officer_id uuid references profiles(user_id) on delete set null,
  officer_name text not null,
  officer_role text not null check (officer_role in ('admissions_office', 'admissions_head')),
  joined_at timestamptz not null default now(),
  added_by uuid references profiles(user_id) on delete set null,
  left_at timestamptz,
  left_reason text
);
create unique index if not exists application_case_officers_active_unique
  on application_case_officers (application_id, officer_id)
  where left_at is null;
create index if not exists application_case_officers_officer_idx
  on application_case_officers (officer_id)
  where left_at is null;
create index if not exists application_case_officers_application_idx
  on application_case_officers (application_id);

alter table profiles enable row level security;
alter table scholarships enable row level security;
alter table documents enable row level security;
alter table applications enable row level security;
alter table application_documents enable row level security;
alter table announcements enable row level security;
alter table notifications enable row level security;
alter table department_reviews enable row level security;
alter table application_review_comments enable row level security;
alter table application_case_officers enable row level security;
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

-- The single access predicate behind every academic-reviewer policy. Mirrors
-- src/lib/reviewScope.js; see 20261042000001_reviewer_scope_ladder.sql.
create or replace function public.reviewer_scopes_to_student(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles s
    join public.profiles c on c.user_id = auth.uid()
    left join public.academic_programs ap on ap.value = s.degree_program
    where s.user_id = p_student_id
      and (
        (
          c.role = 'department_chair'
          and (
            (
              nullif(btrim(coalesce(c.review_department, '')), '') is not null
              and ap.department is not null
              and ap.department = c.review_department
            )
            or (
              nullif(btrim(coalesce(c.review_department, '')), '') is null
              and nullif(btrim(coalesce(c.department, '')), '') is not null
              and s.department = c.department
            )
          )
        )
        or (
          c.role = 'assistant_dean'
          and nullif(btrim(coalesce(c.review_school, '')), '') is not null
          and ap.school = c.review_school
          and (nullif(btrim(coalesce(c.review_cluster, '')), '') is null or ap.cluster = c.review_cluster)
        )
        or (
          c.role = 'dean'
          and nullif(btrim(coalesce(c.review_school, '')), '') is not null
          and ap.school = c.review_school
        )
      )
  )
$$;
revoke all on function public.reviewer_scopes_to_student(uuid) from public, anon;
grant execute on function public.reviewer_scopes_to_student(uuid) to authenticated;

create or replace function public.current_profile_department()
returns text
language sql
security definer
set search_path = public
stable
as $$ select department from public.profiles where user_id = auth.uid() limit 1 $$;

-- Admissions Office lanes (see 20261024000000_split_admissions_office_head_and_staff.sql).
-- `admissions_office` is Staff (intake, verification, hand-off, interviews,
-- recommendation); `admissions_head` decides approval and release and owns the
-- catalog and announcement surfaces.
create or replace function public.is_admissions_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_profile_role() = 'admissions_office' $$;

create or replace function public.is_admissions_head()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_profile_role() = 'admissions_head' $$;

create or replace function public.is_admissions_office()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_profile_role() in ('admissions_office', 'admissions_head') $$;

-- The role-scoped transition map, repeated in the database because RLS cannot
-- compare a row's old and new status. Students, Chairs, and service-role writes
-- are exempt.
create or replace function public.enforce_admissions_office_lane_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
begin
  if caller_role is null or caller_role not in ('admissions_office', 'admissions_head') then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_office' then
    if not (
      (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('For Endorsement', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
    ) then
      raise exception 'Admissions Office Staff cannot move an application from % to %.', old.status, new.status
        using errcode = '42501';
    end if;
  else
    if not (
      (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('For Endorsement', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Rejected'))
      or (old.status = 'Approved' and new.status = 'Released')
    ) then
      raise exception 'The Admissions Office Head cannot move an application from % to %.', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admissions_office_lane_transitions on public.applications;
create trigger enforce_admissions_office_lane_transitions
  before update on public.applications
  for each row execute function public.enforce_admissions_office_lane_transitions();

revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

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
drop policy if exists "admissions_office_documents_read" on documents;
drop policy if exists "admissions_staff_documents_update" on documents;
drop policy if exists "admissions_office_documents_update" on documents;
drop policy if exists "chair_documents_read" on documents;
drop policy if exists "applications_self_access" on applications;
drop policy if exists "osa_applications_access" on applications;
drop policy if exists "admissions_office_applications_access" on applications;
drop policy if exists "admissions_office_applications_read" on applications;
drop policy if exists "admissions_staff_applications_update" on applications;
drop policy if exists "admissions_head_applications_update" on applications;
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
for select using (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'));

create policy "scholarships_read_all" on scholarships
for select using (true);

-- "In scope" is decided by the scholarship *title* (is_addu_in_scope_track),
-- never by rule_family alone: other internal catalog entries can share those
-- values without being GIA, Jubilee, or SA. Mirrors isAdduInternalProgram() in
-- src/lib/eligibility.js. Defined here because the catalog policy below reads it.
create or replace function public.is_addu_in_scope_track(p_title text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_title, ''))) ~ 'jubilee|grant[ -]?in[ -]?aid|(^|[^a-z])gia([^a-z]|$)|student assistant|working scholar';
$$;

create policy "admissions_office_scholarships_manage" on scholarships
for all using (
  public.is_admissions_head()
  and public.is_addu_in_scope_track(title)
) with check (
  public.is_admissions_head()
  and public.is_addu_in_scope_track(title)
);
create policy "documents_self_access" on documents
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "admissions_office_documents_read" on documents
for select using (public.is_admissions_office());
create policy "admissions_office_documents_update" on documents
for update using (public.is_admissions_office()) with check (public.is_admissions_office());
create policy "chair_documents_read" on documents
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and public.reviewer_scopes_to_student(documents.owner_id)
);
create policy "applications_self_access" on applications
for all using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "admissions_office_applications_read" on applications
for select using (public.is_admissions_office());
create policy "admissions_staff_applications_update" on applications
for update using (
  public.is_admissions_staff()
  and status in ('Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview')
) with check (
  public.is_admissions_staff()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Interview', 'Recommended', 'Rejected')
);
create policy "admissions_head_applications_update" on applications
for update using (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected')
);
create policy "chair_applications_read" on applications
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and public.reviewer_scopes_to_student(applications.student_id)
);
-- The Department Chair has read-only department visibility (chair_applications_read
-- above) plus SOP 5a panel work. Endorsement moved to the Office of Admissions &
-- Aid: Staff hand off (For Endorsement) and the Head records the decision
-- (Endorsed), so the Chair has no stage-move policy.
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
for all using (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'))
with check (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'));
create policy "announcements_read_all" on announcements
for select using (true);
create policy "admissions_office_announcements_manage" on announcements
for insert with check (public.is_admissions_head() and created_by = auth.uid());
create policy "notifications_self_access" on notifications
for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "department_reviews_restricted" on department_reviews
for select using (auth.uid() = reviewer_id);
-- Historical Chair endorsement rows stay readable through
-- department_reviews_restricted above. Endorsement is now recorded on the
-- application itself, so the Chair no longer writes audit rows here.
create policy "staff_review_comments_read" on application_review_comments
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
    and exists (
      select 1 from applications a
      where a.id = application_review_comments.application_id
        and public.reviewer_scopes_to_student(a.student_id)
    )
  )
);
create policy "staff_review_comments_insert" on application_review_comments
for insert with check (
  author_id = auth.uid()
  and author_role = public.current_profile_role()
  and (
    public.is_admissions_office()
    or (
      public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
      and exists (
        select 1 from applications a
        where a.id = application_id
          and public.reviewer_scopes_to_student(a.student_id)
      )
    )
  )
);
drop policy if exists "staff_application_case_officers_read" on application_case_officers;
create policy "staff_application_case_officers_read" on application_case_officers
for select using (public.is_admissions_office());
-- Membership is written only by join_application_review / leave_application_review,
-- so no insert, update, or delete policy exists here (see
-- 20261027043147_add_application_case_officers.sql).
create policy "academic_programs_read_all" on academic_programs
for select using (true);
create policy "admissions_office_academic_programs_manage" on academic_programs
for all using (public.is_admissions_head()) with check (public.is_admissions_head());

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
-- "In scope" is decided by the scholarship *title* (is_addu_in_scope_track,
-- defined above with the catalog policies), never by rule_family alone: other
-- internal catalog entries can share those values without being GIA, Jubilee,
-- or SA.
-- ---------------------------------------------------------------------------

-- The profile-completeness and current-proof gates below come from
-- migrations/20261028000000_require_current_attribute_proofs.sql.
-- A valid year standing value, or '' when unset.
create or replace function public.profile_year_standing(p_profile jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_profile ->> 'yearStanding', '') in ('incoming-1st', '1st', '2nd', '3rd', '4th', '5th')
      then p_profile ->> 'yearStanding'
    else ''
  end;
$$;

-- The profile attributes a document type proves for a year standing. Mirrors
-- getProvenAttributes() and VERIFIABLE_ATTRIBUTE_OPTIONS in src/lib/profile.js:
-- a type scoped to one standing applies to that standing or to an unset one.
create or replace function public.document_type_attributes(p_type text, p_year_standing text)
returns text[]
language sql
immutable
as $$
  with standing as (
    select
      coalesce(p_year_standing, '') = 'incoming-1st' as is_incoming,
      coalesce(p_year_standing, '') in ('1st', '2nd', '3rd', '4th', '5th') as is_continuing
  )
  select array_remove(array[
    case when p_type in ('Grade Report', 'Transcript') and not s.is_incoming then 'qpi' end,
    case when p_type = 'HS Report Card' and not s.is_continuing then 'hsAverage' end,
    case when (p_type in ('Grade Report', 'Transcript') and not s.is_incoming)
           or (p_type = 'HS Report Card' and not s.is_continuing) then 'academicStanding' end,
    case when p_type in ('Income Proof', 'Certificate of Indigency') then 'householdIncome' end,
    case when p_type in ('Certificate of Employment', 'Payslip') then 'employed' end,
    case when p_type = 'Certificate of Award' then 'honorsRank' end,
    case when p_type in ('PSA Birth Certificate', 'Philippine National ID', 'Driver''s License', 'Passport') then 'citizenship' end,
    case when p_type = 'Certificate of Tribal Membership' then 'ipCommunity' end,
    case when p_type in ('PWD ID', 'Medical Certificate') then 'pwd' end,
    -- Address and family answers (getAttributeValue() in src/lib/profile.js).
    case when p_type in ('Proof of Billing', 'Certificate of Residency') then 'completeAddress' end,
    case when p_type in ('Proof of Billing', 'Certificate of Residency') then 'residingAddress' end,
    case when p_type = 'PSA Birth Certificate' then 'parents' end,
    case when p_type = 'Certificate of Residency' then 'householdMembers' end
  ], null)
  from standing s;
$$;

-- Whether the profile's current answer needs proof. Mirrors isProofRequired():
-- an answer that claims nothing (IP community "No", "Not employed", no honors)
-- needs no document, and a QPI is not asked of an incoming first-year.
create or replace function public.attribute_proof_required(p_key text, p_profile jsonb)
returns boolean
language sql
immutable
as $$
  select case p_key
    when 'qpi' then public.profile_year_standing(p_profile) <> 'incoming-1st'
    when 'hsAverage' then public.profile_year_standing(p_profile) = 'incoming-1st'
      or (public.profile_year_standing(p_profile) = '' and coalesce(btrim(p_profile ->> 'hsAverage'), '') <> '')
    when 'employed' then coalesce(btrim(p_profile ->> 'employed'), '') not in ('', 'Not employed')
    when 'honorsRank' then coalesce(btrim(p_profile ->> 'honorsRank'), '') <> ''
    when 'ipCommunity' then coalesce(p_profile ->> 'ipCommunity', '') = 'Yes'
    when 'pwd' then coalesce(p_profile ->> 'pwd', '') = 'Yes'
    else true
  end;
$$;

-- The June-start academic year of a moment, read on the Manila calendar.
create or replace function public.academic_year_start(p_at timestamptz)
returns integer
language sql
stable
as $$
  select extract(year from (p_at at time zone 'Asia/Manila'))::integer
    - case when extract(month from (p_at at time zone 'Asia/Manila')) < 6 then 1 else 0 end;
$$;

-- A numeric answer in its comparable form, or null when blank or not a number.
create or replace function public.proof_numeric_value(p_value text)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_value), '') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_value)::numeric
    else null
  end;
$$;

-- Whether a file is still a current proof of one answer. Mirrors
-- getProofStaleReason() in src/lib/verification.js: the value it was uploaded
-- to prove must match the profile now (QPI and the senior high school average
-- to two decimals), and an annual proof must be from the current academic
-- year. A file with no attested value for the key counts as current.
create or replace function public.document_proof_is_current(
  p_attested jsonb,
  p_uploaded_at timestamptz,
  p_key text,
  p_profile jsonb,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
as $$
begin
  if coalesce(p_attested, '{}'::jsonb) ? p_key then
    if p_key in ('qpi', 'hsAverage') then
      if round(public.proof_numeric_value(p_attested ->> p_key), 2)
        is distinct from round(public.proof_numeric_value(p_profile ->> p_key), 2) then
        return false;
      end if;
    elsif p_key = 'householdIncome' then
      if public.proof_numeric_value(p_attested ->> p_key)
        is distinct from public.proof_numeric_value(p_profile ->> p_key) then
        return false;
      end if;
    elsif nullif(btrim(p_attested ->> p_key), '') is distinct from nullif(btrim(p_profile ->> p_key), '') then
      return false;
    end if;
  end if;
  if p_key in ('qpi', 'householdIncome') and p_uploaded_at is not null
    and public.academic_year_start(p_uploaded_at) <> public.academic_year_start(p_now) then
    return false;
  end if;
  return true;
end;
$$;

-- FORM 230-SCH office-only financial details (see 20261036000000_add_application_financial_details.sql).
create table if not exists public.student_financial_profiles (
  student_id uuid primary key references auth.users (id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_financial_profiles enable row level security;

drop policy if exists "student_financial_profiles_owner" on public.student_financial_profiles;
create policy "student_financial_profiles_owner" on public.student_financial_profiles
for all
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists "student_financial_profiles_office_read" on public.student_financial_profiles;
create policy "student_financial_profiles_office_read" on public.student_financial_profiles
for select using (public.is_admissions_office());

create table if not exists public.application_financial_details (
  application_id uuid primary key references public.applications (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  financial_snapshot jsonb,
  updated_at timestamptz not null default now()
);

alter table public.application_financial_details enable row level security;

drop policy if exists "application_financial_details_owner_read" on public.application_financial_details;
create policy "application_financial_details_owner_read" on public.application_financial_details
for select using (student_id = auth.uid());

drop policy if exists "application_financial_details_owner_insert" on public.application_financial_details;
create policy "application_financial_details_owner_insert" on public.application_financial_details
for insert with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.applications a
    where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft'
  )
);

drop policy if exists "application_financial_details_owner_update" on public.application_financial_details;
create policy "application_financial_details_owner_update" on public.application_financial_details
for update
using (
  student_id = auth.uid()
  and exists (
    select 1 from public.applications a
    where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft'
  )
)
with check (student_id = auth.uid());

drop policy if exists "application_financial_details_office_read" on public.application_financial_details;
create policy "application_financial_details_office_read" on public.application_financial_details
for select using (public.is_admissions_office());

-- The frozen financial snapshot is database-owned: a student's insert starts
-- empty and a student's update cannot change it. The submit trigger below runs
-- one trigger level deeper, so it passes.
create or replace function public.protect_application_financial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.financial_snapshot := null;
  else
    new.financial_snapshot := old.financial_snapshot;
    new.application_id := old.application_id;
    new.student_id := old.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_application_financial_snapshot on public.application_financial_details;
create trigger protect_application_financial_snapshot
before insert or update on public.application_financial_details
for each row execute function public.protect_application_financial_snapshot();


-- ---------------------------------------------------------------------------
-- The profile the gates read now also carries the new core answers: the
-- descriptive profile_details keys the gate needs plus the student's financial
-- profile. Core columns still win over the JSON.
-- ---------------------------------------------------------------------------
create or replace function public.student_profile_answers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.eligibility_attributes, '{}'::jsonb)
    || jsonb_build_object(
      'birthdate', p.profile_details -> 'birthdate',
      'sexAtBirth', p.profile_details -> 'sexAtBirth',
      'civilStatus', p.profile_details -> 'civilStatus',
      'religion', p.profile_details -> 'religion',
      'pronouns', p.profile_details -> 'pronouns',
      'completeAddress', p.profile_details -> 'completeAddress',
      'residingAddress', case
        when coalesce(p.profile_details ->> 'sameAsCompleteAddress', 'true') = 'false'
          then nullif(btrim(p.profile_details ->> 'residingAddress'), '')
        else nullif(btrim(p.profile_details ->> 'completeAddress'), '')
      end,
      'housingType', p.profile_details -> 'housingType',
      'housingOther', p.profile_details -> 'housingOther',
      'schoolLastAttended', p.profile_details -> 'schoolLastAttended',
      'awards', p.profile_details -> 'awards',
      'awardsNone', p.profile_details -> 'awardsNone',
      'ipGroupName', p.profile_details -> 'ipGroupName',
      'previousGrants', p.profile_details -> 'previousGrants',
      'previousGrantsAnswered', p.profile_details -> 'previousGrantsAnswered',
      'communityService', p.profile_details -> 'communityService',
      'familyDetails', p.profile_details -> 'familyDetails',
      'financialProfile', f.details
    )
    || jsonb_build_object(
      'fullName', p.full_name,
      'studentNumber', p.student_number,
      'degreeProgram', p.degree_program,
      'qpi', p.qpi,
      'householdIncome', p.household_income,
      'phone', p.phone
    )
  from public.profiles p
  left join public.student_financial_profiles f on f.student_id = p.user_id
  where p.user_id = p_user_id;
$$;

-- A parent counts as answered when deceased or unknown
-- (20261044000000_require_parent_names.sql), or when the employment status and
-- the annual income are recorded (0 is a valid income).
create or replace function public.parent_finances_answered(p_profile jsonb, p_parent text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_profile #>> array['familyDetails', p_parent || 'Deceased'], 'false') = 'true'
    or coalesce(p_profile #>> array['familyDetails', p_parent || 'Unknown'], 'false') = 'true'
    or (
      coalesce(p_profile #>> array['financialProfile', p_parent, 'employmentStatus'], '')
        in ('employed', 'self-employed', 'unemployed')
      and coalesce(p_profile #>> array['financialProfile', p_parent, 'annualIncome'], '') ~ '^[0-9]+(\.[0-9]+)?$'
    );
$$;

-- A parent's name is answered when it is filled in or the parent is marked
-- unknown / not listed (20261044000000_require_parent_names.sql).
create or replace function public.parent_name_answered(p_profile jsonb, p_parent text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_profile #>> array['familyDetails', p_parent || 'Unknown'], 'false') = 'true'
    or char_length(btrim(coalesce(p_profile #>> array['familyDetails', p_parent || 'Name'], ''))) > 0;
$$;

-- JSON helpers for the printed form's flags and lists
-- (20261046000000_require_complete_form_230_sch.sql). A stored value is only
-- trusted when it is the type the app writes, so a malformed row can never make
-- the gate raise instead of answering.
create or replace function public.jsonb_is_true(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_value = 'true'::jsonb, false);
$$;

create or replace function public.jsonb_array_empty(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select case when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) else 0 end = 0;
$$;

-- One of the printed form's checkbox groups (assets, appliances): an item,
-- "None of the above", or a typed "Others" is an answer. Mirrors
-- isOptionGroupAnswered() in src/lib/profile.js.
create or replace function public.financial_option_group_answered(p_profile jsonb, p_group text, p_keys text[])
returns boolean
language sql
immutable
as $$
  select public.jsonb_is_true(p_profile #> array[p_group, 'none'])
    or btrim(coalesce(p_profile #>> array[p_group, 'others'], '')) <> ''
    or exists (
      select 1
      from unnest(p_keys) as key
      where public.jsonb_is_true(p_profile #> array[p_group, key])
    );
$$;

-- Same checks as 20261028000000 plus the FORM 230-SCH core items, Applicant
-- Status, and the current-student AdDU student number. Mirrors
-- getProfileCompleteness() (group `application`) in src/lib/profile.js; the
-- Applicant Status branch comes from
-- 20261037000000_add_applicant_status_to_profile_gate.sql, the student-number
-- branch from 20261038000000_require_student_number_for_current_students.sql,
-- the backslash-free phone class from
-- 20261039000000_align_profile_gate_phone_pattern.sql, and the parents' names
-- from 20261044000000_require_parent_names.sql.
create or replace function public.missing_application_profile_item(p_profile jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_standing text := public.profile_year_standing(p_profile);
  v_hs numeric := public.proof_numeric_value(p_profile ->> 'hsAverage');
  v_qpi numeric := public.proof_numeric_value(p_profile ->> 'qpi');
  v_income numeric := public.proof_numeric_value(p_profile ->> 'householdIncome');
  v_transferee text := coalesce(p_profile ->> 'isTransferee', '');
  v_family jsonb := coalesce(p_profile -> 'familyDetails', '{}'::jsonb);
  v_financial jsonb := coalesce(p_profile -> 'financialProfile', '{}'::jsonb);
  v_parent text;
  v_age numeric;
  v_employment text;
begin
  if p_profile is null then return 'your profile'; end if;
  if char_length(btrim(coalesce(p_profile ->> 'fullName', ''))) < 2 then return 'Full name'; end if;
  if v_standing = '' then return 'Year standing'; end if;
  if v_transferee not in ('Yes', 'No') then return 'Applicant status'; end if;
  -- An AdDU student number belongs to a current student: an incoming first-year
  -- has not been issued one and a transferee's record is at the college they left.
  if v_transferee = 'No' and v_standing <> 'incoming-1st'
    and coalesce(btrim(p_profile ->> 'studentNumber'), '') !~ '^[0-9]{4,12}$' then
    return 'AdDU student number';
  end if;
  if coalesce(btrim(p_profile ->> 'degreeProgram'), '') = '' then return 'Degree program'; end if;
  if coalesce(p_profile ->> 'academicStanding', '') not in ('good', 'probation', 'disqualified') then return 'Academic standing'; end if;
  if v_standing <> 'incoming-1st' and (v_qpi is null or v_qpi < 0 or v_qpi > 4) then return 'Annual QPI'; end if;
  if v_standing = 'incoming-1st' and (v_hs is null or v_hs < 60 or v_hs > 100 or v_hs <> trunc(v_hs)) then
    return 'Senior high school general average';
  end if;
  if v_income is null or v_income < 0 then return 'Annual household income'; end if;
  if coalesce(p_profile ->> 'citizenship', '') not in ('Filipino', 'Non-Filipino') then return 'Citizenship'; end if;
  if coalesce(btrim(p_profile ->> 'civilStatus'), '') = '' then return 'Civil status'; end if;
  -- The printed form asks every applicant for their strand, not only an incoming
  -- first-year.
  if coalesce(btrim(p_profile ->> 'hsStrand'), '') = '' then return 'Senior high school strand'; end if;
  if coalesce(btrim(p_profile ->> 'completeAddress'), '') = '' then return 'Complete address'; end if;
  if coalesce(btrim(p_profile ->> 'housingType'), '') = '' then return 'Where you stay while studying'; end if;
  if not public.parent_name_answered(p_profile, 'father') then return 'Father''s name'; end if;
  if not public.parent_name_answered(p_profile, 'mother') then return 'Mother''s name'; end if;
  if coalesce(p_profile ->> 'ipCommunity', '') not in ('Yes', 'No') then return 'IP community'; end if;
  if coalesce(p_profile ->> 'pwd', '') not in ('Yes', 'No') then return 'Person with Disability (PWD)'; end if;
  if coalesce(p_profile ->> 'employed', '') not in ('Not employed', 'Part-time', 'Full-time', 'Self-employed') then
    return 'Employment status';
  end if;
  if coalesce(p_profile ->> 'birthdate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'Birthdate'; end if;
  if coalesce(p_profile ->> 'sexAtBirth', '') not in ('Female', 'Male') then return 'Sex assigned at birth'; end if;
  if coalesce(btrim(p_profile ->> 'religion'), '') = '' then return 'Religion'; end if;
  if coalesce(btrim(p_profile ->> 'pronouns'), '') = '' then return 'Preferred pronouns'; end if;
  -- The printed form asks for the senior high school (the college a transferee
  -- left), its city, and its province.
  if char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,name}', ''))) = 0
    or char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,city}', ''))) = 0
    or char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,province}', ''))) = 0 then
    return case when v_transferee = 'Yes'
      then 'College last attended (name, city, and province)'
      else 'Senior high school last attended (name, city, and province)' end;
  end if;
  -- "No awards received" is a recorded answer.
  if public.jsonb_is_true(p_profile -> 'awardsNone') = false
    and coalesce(btrim(p_profile ->> 'awards'), '') = '' then
    return 'Awards received';
  end if;
  if coalesce(p_profile ->> 'communityService', '') not in ('Yes', 'No') then
    return 'Willingness to render community service';
  end if;
  -- The class size supports an honors standing, so it is asked only when one is claimed.
  if coalesce(btrim(p_profile ->> 'honorsRank'), '') <> ''
    and (public.proof_numeric_value(p_profile ->> 'graduatingClassSize') is null
      or public.proof_numeric_value(p_profile ->> 'graduatingClassSize') < 1) then
    return 'Number of graduates of your senior high school';
  end if;
  if coalesce(p_profile ->> 'previousGrantsAnswered', '') not in ('Yes', 'No') then
    return 'Financial aid already received';
  end if;
  if coalesce(p_profile ->> 'previousGrantsAnswered', '') = 'Yes'
    and public.jsonb_array_empty(p_profile -> 'previousGrants') then
    return 'Grants applied for or received';
  end if;
  if coalesce(p_profile #>> '{financialProfile,economicStatus}', '') not in ('lower', 'middle', 'upper') then
    return 'Perceived economic status';
  end if;
  if not public.parent_finances_answered(p_profile, 'father') then return 'Father''s employment and income'; end if;
  if not public.parent_finances_answered(p_profile, 'mother') then return 'Mother''s employment and income'; end if;
  -- Each listed parent's age (or date of death) and occupation, then the employer
  -- of a working parent and the last employment detail of an unemployed one.
  foreach v_parent in array array['father', 'mother'] loop
    if public.jsonb_is_true(v_family -> (v_parent || 'Unknown')) = false then
      if public.jsonb_is_true(v_family -> (v_parent || 'Deceased')) then
        if coalesce(v_family ->> (v_parent || 'DateOfDeath'), '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          return case when v_parent = 'father' then 'Father''s date of death' else 'Mother''s date of death' end;
        end if;
      else
        v_age := public.proof_numeric_value(v_family ->> (v_parent || 'Age'));
        if v_age is null or v_age < 15 or v_age > 120 then
          return case when v_parent = 'father' then 'Father''s age' else 'Mother''s age' end;
        end if;
      end if;
      if btrim(coalesce(v_family ->> (v_parent || 'Occupation'), '')) = '' then
        return case when v_parent = 'father' then 'Father''s occupation' else 'Mother''s occupation' end;
      end if;
    end if;
  end loop;
  if public.proof_numeric_value(v_family ->> 'numberOfSiblings') is null
    or public.proof_numeric_value(v_family ->> 'numberOfSiblings') < 0 then
    return 'Number of siblings';
  end if;
  if public.jsonb_is_true(v_family -> 'siblingsNone') = false
    and public.jsonb_array_empty(v_family -> 'siblings') then
    return 'Siblings (names and ages), or none';
  end if;
  if public.jsonb_is_true(v_family -> 'householdAdultsNone') = false
    and public.jsonb_array_empty(v_family -> 'householdAdults') then
    return 'Other adults in the household, or none';
  end if;
  foreach v_parent in array array['father', 'mother'] loop
    if public.jsonb_is_true(v_family -> (v_parent || 'Unknown'))
      or public.jsonb_is_true(v_family -> (v_parent || 'Deceased')) then
      continue;
    end if;
    v_employment := coalesce(v_financial #>> array[v_parent, 'employmentStatus'], '');
    if v_employment in ('employed', 'self-employed')
      and btrim(coalesce(v_financial #>> array[v_parent, 'employer'], '')) = '' then
      return case when v_parent = 'father' then 'Father''s employer or business' else 'Mother''s employer or business' end;
    end if;
    if v_employment = 'unemployed'
      and (btrim(coalesce(v_financial #>> array[v_parent, 'lastEmployed'], '')) = ''
        or btrim(coalesce(v_financial #>> array[v_parent, 'unemploymentReason'], '')) = '') then
      return case when v_parent = 'father' then 'Father''s last employment and reason' else 'Mother''s last employment and reason' end;
    end if;
  end loop;
  if not public.financial_option_group_answered(
    v_financial, 'assets', array['house', 'lot', 'car', 'puv', 'motorcycle', 'realEstate', 'heavyEquipment']
  ) then
    return 'Assets owned by the family';
  end if;
  if not public.financial_option_group_answered(
    v_financial, 'appliances', array['smartphones', 'aircon', 'laptop', 'postpaidInternet']
  ) then
    return 'Appliances and services owned by the family';
  end if;
  -- A Philippine mobile number: 09XXXXXXXXX, +639XXXXXXXXX or 9XXXXXXXXX (formatting ignored).
  if regexp_replace(coalesce(p_profile ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^(63|0)?9[0-9]{9}$' then
    return 'Philippine mobile number';
  end if;
  return null;
end;
$$;

create or replace function public.enforce_student_application_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_profile jsonb;
  v_standing text;
  v_is_incoming boolean;
  v_item jsonb;
  v_types text[];
  v_keys text[];
  v_covered text[] := '{}'::text[];
  v_claim text;
  v_missing text;
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
    -- Profile first: an in-scope application starts only from a complete
    -- profile, because the answers decide its required documents.
    if found and coalesce(v_scholarship.is_external, false) = false
      and public.is_addu_in_scope_track(v_scholarship.title) then
      v_missing := public.missing_application_profile_item(public.student_profile_answers(new.student_id));
      if v_missing is not null then
        raise exception 'Complete your profile before applying: %.', v_missing using errcode = '23514';
      end if;
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

  v_profile := coalesce(public.student_profile_answers(new.student_id), '{}'::jsonb);
  v_missing := public.missing_application_profile_item(v_profile);
  if v_missing is not null then
    raise exception 'Complete your profile before submitting: %.', v_missing using errcode = '23514';
  end if;
  v_standing := public.profile_year_standing(v_profile);
  v_is_incoming := v_standing = 'incoming-1st';

  for v_item in select value from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) loop
    if (v_item ->> 'standing') = 'incoming' and not v_is_incoming then continue; end if;
    if (v_item ->> 'standing') = 'continuing' and v_is_incoming then continue; end if;
    v_types := array(select jsonb_array_elements_text(coalesce(v_item -> 'documentTypes', '[]'::jsonb)));
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type = any(v_types)
    ) then
      raise exception 'Attach the required document: %.', v_item ->> 'label' using errcode = '23514';
    end if;

    -- The answers this requirement proves for the student, as in
    -- getRequirementProvenAttributes().
    v_keys := array(
      select distinct key
      from unnest(v_types) t(type), unnest(public.document_type_attributes(t.type, v_standing)) key
      where public.attribute_proof_required(key, v_profile)
    );
    v_covered := v_covered || v_keys;
    if cardinality(v_keys) > 0 and not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type = any(v_types)
        and not exists (
          select 1 from unnest(v_keys) key
          where (key = any(d.linked_attributes) or key = any(public.document_type_attributes(d.document_type, v_standing)))
            and not public.document_proof_is_current(d.attested_values, d.uploaded_at, key, v_profile)
        )
    ) then
      raise exception 'Upload a current proof for: %. Your profile answer changed after the attached file was uploaded, or the file is from an earlier academic year.', v_item ->> 'label' using errcode = '23514';
    end if;
  end loop;

  -- Claims the profile makes need their own current proof, unless a catalog
  -- requirement already proves them (getClaimProofRequirements).
  foreach v_claim in array array['employed', 'honorsRank', 'ipCommunity', 'pwd'] loop
    if v_claim = any(v_covered) or not public.attribute_proof_required(v_claim, v_profile) then continue; end if;
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and v_claim = any(public.document_type_attributes(d.document_type, v_standing))
        and public.document_proof_is_current(d.attested_values, d.uploaded_at, v_claim, v_profile)
    ) then
      raise exception 'Attach a current proof of your % answer.', case v_claim
        when 'employed' then 'employment'
        when 'honorsRank' then 'graduation honors'
        when 'ipCommunity' then 'IP community'
        else 'PWD'
      end using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_student_application_update on public.applications;
create trigger enforce_student_application_update
  before insert or update on public.applications
  for each row execute function public.enforce_student_application_update();

-- ---------------------------------------------------------------------------
-- Submitting an in-scope application needs the financial situation answers,
-- and the database freezes the student's financial profile with them. Kept as
-- separate triggers so enforce_student_application_update is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.financial_multi_select_answered(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_value is null then false
    when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) > 0
    when jsonb_typeof(p_value) = 'string' then char_length(btrim(p_value #>> '{}')) > 0
    else false
  end;
$$;

create or replace function public.financial_answers_complete(p_answers jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_answers ->> 'otherIncomeAnswer', '') in ('yes', 'no')
    and coalesce(p_answers ->> 'difficultyAnswer', '') in ('yes', 'no')
    and (
      p_answers ->> 'difficultyAnswer' = 'no'
      or (
        public.financial_multi_select_answered(p_answers -> 'difficultyReasons')
        and public.financial_multi_select_answered(p_answers -> 'difficultyCoping')
        -- An "Other" answer needs its free text, like the workspace requires.
        and (
          jsonb_typeof(p_answers -> 'difficultyReasons') is distinct from 'array'
          or not (p_answers -> 'difficultyReasons') @> '["other"]'::jsonb
          or char_length(btrim(coalesce(p_answers ->> 'difficultyOther', ''))) > 0
        )
        and (
          jsonb_typeof(p_answers -> 'difficultyCoping') is distinct from 'array'
          or not (p_answers -> 'difficultyCoping') @> '["other"]'::jsonb
          or char_length(btrim(coalesce(p_answers ->> 'copingOther', ''))) > 0
        )
      )
    )
    and coalesce(p_answers ->> 'allowanceEnough', '') in ('yes', 'no')
    -- Adequate / Inadequate, or the free-text description a draft saved earlier holds.
    and (
      coalesce(p_answers ->> 'foodIntakeAdequacy', '') in ('adequate', 'inadequate')
      or char_length(btrim(coalesce(p_answers ->> 'foodIntake', ''))) > 0
    )
    and char_length(btrim(coalesce(p_answers ->> 'transportMode', ''))) > 0
    and coalesce(p_answers ->> 'allowanceDaily', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseFood', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseTransport', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseOther', '') ~ '^[0-9]+(\.[0-9]+)?$';
$$;

create or replace function public.require_application_financial_answers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_answers jsonb;
begin
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if not (old.status = 'Draft' and new.status = 'Submitted') then
    return new;
  end if;

  select * into v_scholarship from public.scholarships where id = new.scholarship_id;
  if not found
    or coalesce(v_scholarship.is_external, false)
    or not public.is_addu_in_scope_track(v_scholarship.title) then
    return new;
  end if;

  select answers into v_answers from public.application_financial_details where application_id = new.id;
  if v_answers is null or not public.financial_answers_complete(v_answers) then
    raise exception 'Complete the financial situation step before submitting.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists require_application_financial_answers on public.applications;
create trigger require_application_financial_answers
before update on public.applications
for each row execute function public.require_application_financial_answers();

create or replace function public.freeze_application_financial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Draft' and new.status = 'Submitted' then
    update public.application_financial_details d
    set financial_snapshot = coalesce(
          (select f.details from public.student_financial_profiles f where f.student_id = new.student_id),
          '{}'::jsonb
        ),
        updated_at = now()
    where d.application_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists freeze_application_financial_snapshot on public.applications;
create trigger freeze_application_financial_snapshot
after update on public.applications
for each row execute function public.freeze_application_financial_snapshot();


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
  public.is_admissions_office()
  or (
    public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
    and exists (
      select 1 from public.applications a
      where a.id = application_status_log.application_id
        and public.reviewer_scopes_to_student(a.student_id)
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
-- Verified, relink it, rewrite the value it attests, name a reviewer, or
-- backdate it into the current academic year (see
-- 20261013000000_add_document_attested_values.sql and
-- 20261027000000_add_document_decision_actor.sql).
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

drop trigger if exists protect_document_review_fields on public.documents;
create trigger protect_document_review_fields
  before insert or update on public.documents
  for each row execute function public.protect_document_review_fields();

-- A file cannot move into Rejected without a recorded reason, and the reason is
-- cleared once the file leaves Rejected. The check runs on the transition only,
-- so a file rejected before the column existed stays editable
-- (see 20261020000000_add_document_rejection_reason.sql). Every decision also
-- records its date and the reviewing Admissions Office account, and a reset to
-- Pending clears both (see 20261027000000_add_document_decision_actor.sql).
create or replace function public.require_document_rejection_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.verification_status is distinct from old.verification_status then
    if new.verification_status = 'Pending' then
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

-- Case officers (see 20261027043147_add_application_case_officers.sql). Joining is
-- idempotent and is the only place the roster grows; the one status move it can
-- make is the start of the review. The timeline note stays anonymous because
-- applications.timeline is readable by the student.
create or replace function public.join_application_review(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_role text := public.current_profile_role();
  v_name text;
  v_actor text;
  v_note text;
begin
  if not public.is_admissions_office() then
    raise exception 'Only the Admissions Office can join an application review.';
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'The application could not be found.';
  end if;

  if v_application.status not in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview') then
    raise exception 'An application at % does not take case officers.', v_application.status;
  end if;

  if not exists (
    select 1
    from public.application_case_officers
    where application_id = p_application_id
      and officer_id = auth.uid()
      and left_at is null
  ) then
    select coalesce(nullif(btrim(full_name), ''), 'Admissions Office reviewer')
      into v_name
      from public.profiles
      where user_id = auth.uid();

    insert into public.application_case_officers (application_id, officer_id, officer_name, officer_role, added_by)
    values (
      p_application_id,
      auth.uid(),
      coalesce(v_name, 'Admissions Office reviewer'),
      coalesce(v_role, 'admissions_office'),
      auth.uid()
    );
  end if;

  if v_application.status = 'Submitted' then
    v_actor := case v_role when 'admissions_head' then 'Admissions Office Head' else 'Admissions Office Staff' end;
    v_note := case v_role
      when 'admissions_head' then 'The Admissions Office Head opened this application for review. Attached documents are reviewed at the verification stage.'
      else 'The Admissions Office Staff opened this application for review. Attached documents are reviewed at the verification stage.'
    end;

    update public.applications
    set status = 'Under Review',
        updated_at = now(),
        timeline = coalesce(timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', 'ev-' || gen_random_uuid()::text,
          'stage', 'Under Review',
          'note', v_note,
          'actor', v_actor,
          'at', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD')
        ))
    where id = p_application_id
    returning * into v_application;
  end if;

  return v_application;
end;
$$;

revoke all on function public.join_application_review(uuid) from public, anon;
grant execute on function public.join_application_review(uuid) to authenticated;

-- Leaving a case keeps the status: Under Review -> Submitted is a reverse
-- transition the SOP map does not allow.
create or replace function public.leave_application_review(p_application_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admissions_office() then
    raise exception 'Only the Admissions Office can leave an application review.';
  end if;

  if v_reason = '' then
    raise exception 'A reason is required before leaving an application review.';
  end if;

  update public.application_case_officers
  set left_at = now(),
      left_reason = v_reason
  where application_id = p_application_id
    and officer_id = auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not a case officer on this application.';
  end if;
end;
$$;

revoke all on function public.leave_application_review(uuid, text) from public, anon;
grant execute on function public.leave_application_review(uuid, text) to authenticated;

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
-- SOP step 5 - Interview of applicants
-- (see migrations/20261029000000_overhaul_interview_stage.sql).
--
-- SOP 5a: the interviewing panel comes from the school where the applicant's
-- program belongs. The Admissions Office coordinates the interview and owns the
-- status moves; a Department Chair on the panel records the outcome and the
-- private evaluation notes. applications.interview holds only the public
-- schedule; panel membership and notes are staff-only tables.
-- ---------------------------------------------------------------------------
-- Venues for on-site interviews. Archived (is_active = false) instead of
-- deleted, and every interview snapshots its location label, so an old record
-- stays readable after a venue is retired.
create table if not exists public.interview_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  building text check (building is null or char_length(building) <= 120),
  room text check (room is null or char_length(room) <= 60),
  notes text check (notes is null or char_length(notes) <= 280),
  is_active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.interview_locations enable row level security;

drop policy if exists "admissions_office_interview_locations_read" on public.interview_locations;
drop policy if exists "admissions_head_interview_locations_insert" on public.interview_locations;
drop policy if exists "admissions_head_interview_locations_update" on public.interview_locations;
create policy "admissions_office_interview_locations_read" on public.interview_locations
for select using (public.is_admissions_office());
create policy "admissions_head_interview_locations_insert" on public.interview_locations
for insert with check (public.is_admissions_head());
create policy "admissions_head_interview_locations_update" on public.interview_locations
for update using (public.is_admissions_head()) with check (public.is_admissions_head());

-- Panel membership. An account panelist is a Department Chair from the
-- applicant's school; a faculty guest without a ScholarPath account is typed in
-- by name (and optionally email, for the calendar invitation). Removed members
-- are soft-removed so the record of who sat on an earlier panel survives.
create table if not exists public.application_interview_panelists (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  profile_id uuid references public.profiles(user_id) on delete cascade,
  guest_name text check (guest_name is null or char_length(guest_name) <= 120),
  guest_email text check (guest_email is null or guest_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  is_lead boolean not null default false,
  added_by uuid references public.profiles(user_id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint application_interview_panelists_member_check
    check (profile_id is not null or nullif(btrim(coalesce(guest_name, '')), '') is not null)
);
create index if not exists application_interview_panelists_application_idx
  on public.application_interview_panelists (application_id)
  where removed_at is null;
create unique index if not exists application_interview_panelists_active_account_unique
  on public.application_interview_panelists (application_id, profile_id)
  where removed_at is null and profile_id is not null;
create index if not exists application_interview_panelists_profile_idx
  on public.application_interview_panelists (profile_id);
-- The durable provider-side history of an interview's calendar events. The app
-- reads `applications.interview.calendar`, which is cleared when an interview is
-- cancelled; these rows keep every provider event id, so a create or cancel that
-- failed can still be found, repaired, and swept. `is_current` marks the event the
-- record points at. RLS is enabled with no policies: only the
-- manage-interview-event Edge Function (service role) reads or writes it.
-- Applied to the deployed project by the migrations
-- supabase/migrations/20261030000000_add_interview_calendar_events.sql and
-- supabase/migrations/20261031000000_interview_calendar_event_history.sql.
create table if not exists public.interview_calendar_events (
  ledger_id bigserial primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  provider text not null default 'google',
  calendar_id text not null,
  event_id text,
  html_link text,
  meet_url text,
  revision int,
  is_current boolean not null default true,
  sync_state text not null default 'synced'
    check (sync_state in ('synced', 'failed', 'cancelled')),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.interview_calendar_events is
  'Durable provider-side record of an interview calendar event. Written by the manage-interview-event Edge Function only; survives a cleared applications.interview.calendar so a failed create or cancel can be found and repaired.';
comment on column public.interview_calendar_events.is_current is
  'True for the provider event applications.interview.calendar points at; false for a superseded or failed event that is still tracked so the repair action can sweep it.';
create unique index if not exists interview_calendar_events_current_idx
  on public.interview_calendar_events (application_id)
  where is_current;
create index if not exists interview_calendar_events_application_idx
  on public.interview_calendar_events (application_id, updated_at desc);
create index if not exists interview_calendar_events_failed_idx
  on public.interview_calendar_events (updated_at desc)
  where sync_state = 'failed';
alter table public.interview_calendar_events enable row level security;
revoke all on public.interview_calendar_events from anon, authenticated;



-- SOP 5a, server-side: every reviewer level whose scope covers the applicant may sit
-- on the panel — the Chairperson of its department, the Assistant Dean of its
-- cluster, or the Dean of its school — plus either Admissions Office lane, which
-- coordinates the interview (SOP step 5). The lead may be any panel member. Applied
-- by supabase/migrations/20261042000001_reviewer_scope_ladder.sql.
create or replace function public.validate_interview_panelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_school text;
  v_school text;
  v_cluster text;
  v_department text;
  v_role text;
  v_review_school text;
  v_review_cluster text;
  v_review_department text;
  v_legacy_school text;
begin
  if new.profile_id is null then
    return new;
  end if;
  select p.department, ap.school, ap.cluster, ap.department
    into v_student_school, v_school, v_cluster, v_department
    from public.applications a
    join public.profiles p on p.user_id = a.student_id
    left join public.academic_programs ap on ap.value = p.degree_program
    where a.id = new.application_id;
  select role, review_school, review_cluster, review_department, department
    into v_role, v_review_school, v_review_cluster, v_review_department, v_legacy_school
    from public.profiles
    where user_id = new.profile_id;

  if v_role in ('admissions_office', 'admissions_head') then
    return new;
  end if;
  if v_role = 'dean'
    and nullif(btrim(coalesce(v_review_school, '')), '') is not null
    and v_school is not null
    and v_review_school = v_school then
    return new;
  end if;
  if v_role = 'assistant_dean'
    and nullif(btrim(coalesce(v_review_school, '')), '') is not null
    and v_school is not null
    and v_review_school = v_school
    and (nullif(btrim(coalesce(v_review_cluster, '')), '') is null or v_review_cluster = v_cluster) then
    return new;
  end if;
  if v_role = 'department_chair' then
    if nullif(btrim(coalesce(v_review_department, '')), '') is not null then
      if v_department is not null and v_review_department = v_department then
        return new;
      end if;
    elsif nullif(btrim(coalesce(v_legacy_school, '')), '') is not null
      and v_student_school = v_legacy_school then
      return new;
    end if;
  end if;
  raise exception 'Interview panelists must be the Chairperson of the applicant''s department, the Assistant Dean of its cluster, or the Dean of its school (SOP 5a), or an Admissions Office account.'
    using errcode = '23514';
end;
$$;

drop trigger if exists validate_interview_panelist on public.application_interview_panelists;
create trigger validate_interview_panelist
  before insert or update of profile_id, application_id on public.application_interview_panelists
  for each row execute function public.validate_interview_panelist();

revoke all on function public.validate_interview_panelist() from public;
revoke all on function public.validate_interview_panelist() from anon, authenticated;

-- True when the signed-in account sits on the application's current panel.
create or replace function public.is_interview_panelist(p_application_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.application_interview_panelists
    where application_id = p_application_id
      and profile_id = auth.uid()
      and removed_at is null
  )
$$;

revoke all on function public.is_interview_panelist(uuid) from public, anon;
grant execute on function public.is_interview_panelist(uuid) to authenticated;

-- True when the application's student is in the signed-in Chair's department.
create or replace function public.is_chair_for_application(p_application_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
    and exists (
      select 1 from public.applications a
      where a.id = p_application_id
        and public.reviewer_scopes_to_student(a.student_id)
    )
$$;

revoke all on function public.is_chair_for_application(uuid) from public, anon;
grant execute on function public.is_chair_for_application(uuid) to authenticated;

alter table public.application_interview_panelists enable row level security;

drop policy if exists "staff_interview_panelists_read" on public.application_interview_panelists;
drop policy if exists "admissions_office_interview_panelists_insert" on public.application_interview_panelists;
drop policy if exists "admissions_office_interview_panelists_update" on public.application_interview_panelists;
create policy "staff_interview_panelists_read" on public.application_interview_panelists
for select using (
  public.is_admissions_office()
  or public.is_chair_for_application(application_id)
);
create policy "admissions_office_interview_panelists_insert" on public.application_interview_panelists
for insert with check (public.is_admissions_office());
create policy "admissions_office_interview_panelists_update" on public.application_interview_panelists
for update using (public.is_admissions_office()) with check (public.is_admissions_office());

-- Private evaluation notes. Staff-only and append-only: the Admissions Office
-- and a Department Chair on the panel write them; the Admissions Office and the
-- applicant's department Chair read them. Students have no policy.
create table if not exists public.application_interview_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid not null references public.profiles(user_id) on delete cascade,
  author_role text not null check (author_role in ('admissions_office', 'admissions_head', 'department_chair')),
  rating smallint check (rating is null or rating between 1 and 5),
  -- The panel's recommendation (SOP step 6 input). `rating` is kept so a note
  -- recorded before this column still displays; see
  -- 20261041000000_add_interview_recommendation_levels.sql.
  recommendation_level text check (
    recommendation_level is null
    or recommendation_level in (
      'highly_recommended',
      'recommended',
      'recommended_with_reservation',
      'not_recommended',
      'deferred'
    )
  ),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists application_interview_notes_application_idx
  on public.application_interview_notes (application_id, created_at);
create index if not exists application_interview_notes_author_idx
  on public.application_interview_notes (author_id);

alter table public.application_interview_notes enable row level security;

drop policy if exists "staff_interview_notes_read" on public.application_interview_notes;
drop policy if exists "interview_notes_insert" on public.application_interview_notes;
create policy "staff_interview_notes_read" on public.application_interview_notes
for select using (
  public.is_admissions_office()
  or public.is_chair_for_application(application_id)
);
create policy "interview_notes_insert" on public.application_interview_notes
for insert with check (
  author_id = auth.uid()
  and author_role = public.current_profile_role()
  and (
    public.is_admissions_office()
    or (
      public.current_profile_role() = 'department_chair'
      and public.is_interview_panelist(application_id)
    )
  )
);

-- The Recommend gate: the sub-committee recommendation (SOP step 6) ends the
-- interview stage, so a live schedule must be closed first. App.jsx cancels a
-- `scheduled` record before it writes the recommendation, which keeps the
-- application at `Interview` for the cancellation notification and leaves no
-- invitation or Meet link behind. A record scheduled before the interview
-- overhaul carries no version and is grandfathered. Rejected is always allowed.
-- Mirrors the client flow in recordDeliberation (App.jsx).
create or replace function public.enforce_interview_closed_before_recommendation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Interview'
    and new.status = 'Recommended'
    and (new.interview ? 'version')
    and coalesce(new.interview ->> 'state', '') = 'scheduled' then
    raise exception 'The interview schedule must be closed before the recommendation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_interview_closed_before_recommendation on public.applications;
create trigger enforce_interview_closed_before_recommendation
  before update on public.applications
  for each row execute function public.enforce_interview_closed_before_recommendation();

revoke all on function public.enforce_interview_closed_before_recommendation() from public;
revoke all on function public.enforce_interview_closed_before_recommendation() from anon, authenticated;

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
using (bucket_id = 'documents' and public.is_admissions_office());

drop policy if exists "documents_storage_chair_read" on storage.objects;
create policy "documents_storage_chair_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  -- The first path segment is the owner's user_id. It is matched as text, not cast
  -- to uuid, so a malformed object name can never raise inside the policy.
  and exists (
    select 1 from public.profiles p
    where p.user_id::text = (storage.foldername(name))[1]
      and public.reviewer_scopes_to_student(p.user_id)
  )
);

-- ---------------------------------------------------------------------------
-- Profile photos.
--
-- A private `avatars` bucket holds one profile photo per user
-- (`<user_id>/<timestamp>-<file>`), recorded in profiles.avatar_path. Unlike a
-- Document Vault file, an avatar is personal: only its owner can read or write
-- it (no Admissions Office or Chair read policy), and it is never sent with an
-- application. The app resolves a short-lived signed URL to display it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_owner_access" on storage.objects;
create policy "avatars_owner_access" on storage.objects
for all to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

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

-- ---------------------------------------------------------------------------
-- Office calendar planning entries (Admissions Office and Department Chairs).
--
-- The office calendar derives its interviews, catalog deadlines, and recorded
-- stage decisions from records the app already holds. These rows are the office's
-- own planning dates. Applied to a deployed project by
-- supabase/migrations/20261033000000_add_office_calendar_entries.sql; `id` is
-- text because the client generates `office-<uuid>` ids.
-- ---------------------------------------------------------------------------
create table if not exists office_calendar_entries (
  id text primary key,
  title text not null,
  entry_date date not null,
  kind text not null default 'office' check (kind in ('office', 'deadline', 'meeting')),
  notes text not null default '',
  created_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists office_calendar_entries_entry_date_idx
on office_calendar_entries (entry_date);

alter table office_calendar_entries enable row level security;

drop policy if exists "staff_office_calendar_entries_read" on office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_insert" on office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_update" on office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_delete" on office_calendar_entries;

create policy "staff_office_calendar_entries_read" on office_calendar_entries
for select using (
  public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair')
);

create policy "admissions_head_office_calendar_entries_insert" on office_calendar_entries
for insert with check (public.is_admissions_head() and created_by = auth.uid());

create policy "admissions_head_office_calendar_entries_update" on office_calendar_entries
for update using (public.is_admissions_head()) with check (public.is_admissions_head());

create policy "admissions_head_office_calendar_entries_delete" on office_calendar_entries
for delete using (public.is_admissions_head());


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
-- exact value inside the function instead. Never send the anon key here  Eit is
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
-- Database-triggered status notification (pg_net)  EChapter 3, Section 3.3.4.
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

-- ---------------------------------------------------------------------------
-- Interview schedule notifications from the database (pg_net).
--
-- When an interview revision or state changes, this trigger calls
-- notify-interview-update, which tells each account panelist about the new
-- schedule and tells the student about a reschedule or cancellation. It dedupes
-- on `interview-update-<applicationId>-<revision>-<state>` (student) and
-- `interview-panel-<applicationId>-<revision>-<state>` (panelists).
--
-- Applied to the deployed project by the migration
-- supabase/migrations/20261029000001_notify_interview_update_from_database.sql.
-- Setup: replace <project-ref> and <REMINDER_CRON_SECRET>, and deploy the
-- function with verify_jwt disabled.
-- ---------------------------------------------------------------------------
-- create or replace function public.notify_interview_update_change()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public, net
-- as $$
-- begin
--   if new.status = 'Interview'
--     and (new.interview ? 'version')
--     and (
--       (new.interview ->> 'revision') is distinct from (old.interview ->> 'revision')
--       or (new.interview ->> 'state') is distinct from (old.interview ->> 'state')
--     ) then
--     perform net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/notify-interview-update',
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
-- drop trigger if exists notify_interview_update_change on public.applications;
-- create trigger notify_interview_update_change
--   after update on public.applications
--   for each row execute function public.notify_interview_update_change();

-- Only the database triggers call these (see 20261036000001_restrict_financial_function_access.sql).
revoke execute on function public.student_profile_answers(uuid) from public, anon, authenticated;
revoke execute on function public.protect_application_financial_snapshot() from public, anon, authenticated;
revoke execute on function public.require_application_financial_answers() from public, anon, authenticated;
revoke execute on function public.freeze_application_financial_snapshot() from public, anon, authenticated;
revoke execute on function public.financial_multi_select_answered(jsonb) from public, anon, authenticated;

-- The profile gate is evaluated in the trigger path only
-- (see 20261040000000_restrict_profile_gate_function_access.sql).
revoke execute on function public.missing_application_profile_item(jsonb) from public, anon, authenticated;
revoke execute on function public.parent_name_answered(jsonb, text) from public, anon, authenticated;
revoke execute on function public.jsonb_is_true(jsonb) from public, anon, authenticated;
revoke execute on function public.jsonb_array_empty(jsonb) from public, anon, authenticated;
revoke execute on function public.financial_option_group_answered(jsonb, text, text[]) from public, anon, authenticated;
revoke execute on function public.enforce_student_application_update() from public, anon, authenticated;


-- ===========================================================================
-- Consultation 2 account split (Oct 27): interviewers recommend, the school's
-- approving level approves, the Admissions Office Head verifies, checks, and
-- releases. Mirrors, in order:
--   supabase/migrations/20261050000000_interviewer_role_and_approval_routing.sql
--   supabase/migrations/20261050000001_lane_transitions_by_flow_role.sql
--   supabase/migrations/20261050000002_add_results_releases.sql
-- Every statement is idempotent and replaces the earlier definition above.
-- ===========================================================================

-- Consultation 2 (Oct 27): interviewers recommend, the school's chair or dean
-- approves, and the Admissions Office Head does the final check and releases.
--
-- This migration adds the account split that process needs:
--
--   * `interviewer` — a faculty account scoped like the reviewer ladder (one of
--     review_school / review_cluster / review_department; e.g. the Computer
--     Studies cluster of SAS). Applications are routed to it automatically by the
--     applicant's program, through the same `reviewer_scopes_to_student()`
--     predicate, so there is no assignment step.
--   * `approval_levels` — which ladder level approves for a school or cluster
--     (SOE -> Dean, SEA -> Chairperson, SAS · Computer Studies -> Assistant Dean).
--     Anything unset defaults to the Chairperson. `approver_role_for_student()`
--     resolves it; src/lib/reviewScope.js `getApproverRoleForApplication()`
--     mirrors it.
--   * Scoped reads for the new and the previously unreadable levels: a Dean,
--     Assistant Dean, or interviewer reads the profiles in its scope plus the
--     staff directory (before this, Deans and Assistant Deans read no applicant
--     profile at all).
--   * Interview work for every scoped reviewer: in-scope interviewers and ladder
--     accounts may build the panel, and the author_role checks accept the Dean,
--     the Assistant Dean, and the interviewer (they rejected a Dean's note).
--   * Document decisions belong to the Admissions Office Head only. Staff keep a
--     read-only office view.
--
-- The stage moves themselves are enforced by
-- 20261050000001_lane_transitions_by_flow_role.sql.

-- 1. The interviewer role and its scope.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

alter table public.profiles drop constraint if exists profiles_review_scope_check;
alter table public.profiles add constraint profiles_review_scope_check check (
  (review_cluster is null or role in ('assistant_dean', 'interviewer'))
  and (review_department is null or role in ('department_chair', 'interviewer'))
  and (review_school is null or role in ('dean', 'assistant_dean', 'department_chair', 'interviewer'))
);

-- 2. The single scope predicate, now including the interviewer. An interviewer is
--    scoped to the narrowest level it holds: a department, else a cluster inside
--    its school, else the whole school.
create or replace function public.reviewer_scopes_to_student(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles s
    join public.profiles c on c.user_id = auth.uid()
    left join public.academic_programs ap on ap.value = s.degree_program
    where s.user_id = p_student_id
      and (
        (
          c.role = 'department_chair'
          and (
            (
              nullif(btrim(coalesce(c.review_department, '')), '') is not null
              and ap.department is not null
              and ap.department = c.review_department
            )
            or (
              nullif(btrim(coalesce(c.review_department, '')), '') is null
              and nullif(btrim(coalesce(c.department, '')), '') is not null
              and s.department = c.department
            )
          )
        )
        or (
          c.role = 'assistant_dean'
          and nullif(btrim(coalesce(c.review_school, '')), '') is not null
          and ap.school = c.review_school
          and (nullif(btrim(coalesce(c.review_cluster, '')), '') is null or ap.cluster = c.review_cluster)
        )
        or (
          c.role = 'dean'
          and nullif(btrim(coalesce(c.review_school, '')), '') is not null
          and ap.school = c.review_school
        )
        or (
          c.role = 'interviewer'
          and (
            (
              nullif(btrim(coalesce(c.review_department, '')), '') is not null
              and ap.department is not null
              and ap.department = c.review_department
            )
            or (
              nullif(btrim(coalesce(c.review_department, '')), '') is null
              and nullif(btrim(coalesce(c.review_cluster, '')), '') is not null
              and nullif(btrim(coalesce(c.review_school, '')), '') is not null
              and ap.school = c.review_school
              and ap.cluster = c.review_cluster
            )
            or (
              nullif(btrim(coalesce(c.review_department, '')), '') is null
              and nullif(btrim(coalesce(c.review_cluster, '')), '') is null
              and nullif(btrim(coalesce(c.review_school, '')), '') is not null
              and ap.school = c.review_school
            )
          )
        )
      )
  )
$$;

revoke all on function public.reviewer_scopes_to_student(uuid) from public, anon;
grant execute on function public.reviewer_scopes_to_student(uuid) to authenticated;

-- 3. Which ladder level approves (SOP step 7) for a school or cluster.
create table if not exists public.approval_levels (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(btrim(school)) between 1 and 200),
  cluster text check (cluster is null or char_length(btrim(cluster)) between 1 and 200),
  approver_role text not null check (approver_role in ('dean', 'assistant_dean', 'department_chair')),
  updated_by uuid references public.profiles(user_id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists approval_levels_scope_unique
  on public.approval_levels (school, coalesce(cluster, ''));

alter table public.approval_levels enable row level security;

drop policy if exists "approval_levels_staff_read" on public.approval_levels;
drop policy if exists "approval_levels_head_insert" on public.approval_levels;
drop policy if exists "approval_levels_head_update" on public.approval_levels;
drop policy if exists "approval_levels_head_delete" on public.approval_levels;
create policy "approval_levels_staff_read" on public.approval_levels
for select using (
  public.current_profile_role() in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer')
);
create policy "approval_levels_head_insert" on public.approval_levels
for insert with check (public.is_admissions_head());
create policy "approval_levels_head_update" on public.approval_levels
for update using (public.is_admissions_head()) with check (public.is_admissions_head());
create policy "approval_levels_head_delete" on public.approval_levels
for delete using (public.is_admissions_head());

-- The three examples given at the consultation (32:08-36:01).
insert into public.approval_levels (school, cluster, approver_role)
values
  ('School of Education (SOE)', null, 'dean'),
  ('School of Engineering and Architecture (SEA)', null, 'department_chair'),
  ('School of Arts and Sciences (SAS)', 'Computer Studies', 'assistant_dean')
on conflict do nothing;

-- The approving level for an applicant: the cluster row, then the school row,
-- else the Chairperson.
create or replace function public.approver_role_for_student(p_student_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select al.approver_role from public.approval_levels al
      where ap.school is not null and al.school = ap.school
        and al.cluster is not null and al.cluster = ap.cluster
      limit 1
    ),
    (
      select al.approver_role from public.approval_levels al
      where ap.school is not null and al.school = ap.school and al.cluster is null
      limit 1
    ),
    'department_chair'
  )
  from public.profiles s
  left join public.academic_programs ap on ap.value = s.degree_program
  where s.user_id = p_student_id
$$;

revoke all on function public.approver_role_for_student(uuid) from public, anon;
grant execute on function public.approver_role_for_student(uuid) to authenticated;

-- 4. Profile reads. The Chair keeps its existing read; the Dean, the Assistant
--    Dean, and the interviewer read the applicants in their scope and the staff
--    directory the panel picker needs.
drop policy if exists "reviewer_scoped_profiles_read" on public.profiles;
create policy "reviewer_scoped_profiles_read" on public.profiles
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'interviewer')
  and (profiles.role <> 'student' or public.reviewer_scopes_to_student(profiles.user_id))
);

-- 5. Every scoped-reviewer read now includes the interviewer.
drop policy if exists "chair_documents_read" on public.documents;
create policy "chair_documents_read" on public.documents
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(documents.owner_id)
);

drop policy if exists "chair_applications_read" on public.applications;
create policy "chair_applications_read" on public.applications
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(applications.student_id)
);

drop policy if exists "staff_application_documents_reviewer_read" on public.application_documents;
create policy "staff_application_documents_reviewer_read" on public.application_documents
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and exists (
    select 1 from public.applications a
    where a.id = application_documents.application_id
      and public.reviewer_scopes_to_student(a.student_id)
  )
);

drop policy if exists "staff_review_comments_read" on public.application_review_comments;
create policy "staff_review_comments_read" on public.application_review_comments
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
    and exists (
      select 1 from public.applications a
      where a.id = application_review_comments.application_id
        and public.reviewer_scopes_to_student(a.student_id)
    )
  )
);

drop policy if exists "staff_review_comments_insert" on public.application_review_comments;
create policy "staff_review_comments_insert" on public.application_review_comments
for insert with check (
  author_id = auth.uid()
  and author_role = public.current_profile_role()
  and (
    public.is_admissions_head()
    or (
      public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
      and exists (
        select 1 from public.applications a
        where a.id = application_id
          and public.reviewer_scopes_to_student(a.student_id)
      )
    )
  )
);

alter table public.application_review_comments
  drop constraint if exists application_review_comments_author_role_check;
alter table public.application_review_comments add constraint application_review_comments_author_role_check
  check (author_role in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

drop policy if exists "status_log_staff_read" on public.application_status_log;
create policy "status_log_staff_read" on public.application_status_log
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
    and exists (
      select 1 from public.applications a
      where a.id = application_status_log.application_id
        and public.reviewer_scopes_to_student(a.student_id)
    )
  )
);

drop policy if exists "documents_storage_chair_read" on storage.objects;
create policy "documents_storage_chair_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and exists (
    select 1 from public.profiles p
    where p.user_id::text = (storage.foldername(name))[1]
      and public.reviewer_scopes_to_student(p.user_id)
  )
);

-- `is_chair_for_application` keeps its name (the interview policies call it) and
-- now covers every scoped reviewer, the interviewer included.
create or replace function public.is_chair_for_application(p_application_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
    and exists (
      select 1 from public.applications a
      where a.id = p_application_id
        and public.reviewer_scopes_to_student(a.student_id)
    )
$$;

-- 6. Interview work. The interviewer schedules its own interviews (45:23), and a
--    Chairperson, Assistant Dean, or Dean in scope may run the interview itself in
--    a small program (20:11), so every scoped reviewer may build the panel. The
--    Head keeps the office override; Staff no longer coordinate interviews.
drop policy if exists "admissions_office_interview_locations_read" on public.interview_locations;
create policy "admissions_office_interview_locations_read" on public.interview_locations
for select using (
  public.current_profile_role() in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer')
);

drop policy if exists "admissions_office_interview_panelists_insert" on public.application_interview_panelists;
drop policy if exists "admissions_office_interview_panelists_update" on public.application_interview_panelists;
create policy "admissions_office_interview_panelists_insert" on public.application_interview_panelists
for insert with check (
  public.is_admissions_head()
  or public.is_chair_for_application(application_id)
);
create policy "admissions_office_interview_panelists_update" on public.application_interview_panelists
for update using (
  public.is_admissions_head()
  or public.is_chair_for_application(application_id)
) with check (
  public.is_admissions_head()
  or public.is_chair_for_application(application_id)
);

alter table public.application_interview_notes
  drop constraint if exists application_interview_notes_author_role_check;
alter table public.application_interview_notes add constraint application_interview_notes_author_role_check
  check (author_role in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

drop policy if exists "interview_notes_insert" on public.application_interview_notes;
create policy "interview_notes_insert" on public.application_interview_notes
for insert with check (
  author_id = auth.uid()
  and author_role = public.current_profile_role()
  and (
    public.is_admissions_head()
    or (
      public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
      and public.is_interview_panelist(application_id)
    )
  )
);

-- SOP 5a, server-side: every ladder level and every interviewer whose scope covers
-- the applicant may sit on the panel, and so may either Admissions Office lane.
create or replace function public.validate_interview_panelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_school text;
  v_school text;
  v_cluster text;
  v_department text;
  v_role text;
  v_review_school text;
  v_review_cluster text;
  v_review_department text;
  v_legacy_school text;
begin
  if new.profile_id is null then
    return new;
  end if;
  select p.department, ap.school, ap.cluster, ap.department
    into v_student_school, v_school, v_cluster, v_department
    from public.applications a
    join public.profiles p on p.user_id = a.student_id
    left join public.academic_programs ap on ap.value = p.degree_program
    where a.id = new.application_id;
  select role, review_school, review_cluster, review_department, department
    into v_role, v_review_school, v_review_cluster, v_review_department, v_legacy_school
    from public.profiles
    where user_id = new.profile_id;

  if v_role in ('admissions_office', 'admissions_head') then
    return new;
  end if;

  if v_role = 'dean'
    and nullif(btrim(coalesce(v_review_school, '')), '') is not null
    and v_school is not null
    and v_review_school = v_school then
    return new;
  end if;

  if v_role = 'assistant_dean'
    and nullif(btrim(coalesce(v_review_school, '')), '') is not null
    and v_school is not null
    and v_review_school = v_school
    and (nullif(btrim(coalesce(v_review_cluster, '')), '') is null or v_review_cluster = v_cluster) then
    return new;
  end if;

  if v_role = 'department_chair' then
    if nullif(btrim(coalesce(v_review_department, '')), '') is not null then
      if v_department is not null and v_review_department = v_department then
        return new;
      end if;
    elsif nullif(btrim(coalesce(v_legacy_school, '')), '') is not null
      and v_student_school = v_legacy_school then
      return new;
    end if;
  end if;

  if v_role = 'interviewer' then
    if nullif(btrim(coalesce(v_review_department, '')), '') is not null then
      if v_department is not null and v_review_department = v_department then
        return new;
      end if;
    elsif nullif(btrim(coalesce(v_review_cluster, '')), '') is not null then
      if v_school is not null and v_review_school = v_school and v_review_cluster = v_cluster then
        return new;
      end if;
    elsif nullif(btrim(coalesce(v_review_school, '')), '') is not null
      and v_school is not null
      and v_review_school = v_school then
      return new;
    end if;
  end if;

  raise exception 'Interview panelists must be an interviewer, Chairperson, Assistant Dean, or Dean whose scope covers the applicant (SOP 5a), or an Admissions Office account.'
    using errcode = '23514';
end;
$$;

revoke all on function public.validate_interview_panelist() from public;
revoke all on function public.validate_interview_panelist() from anon, authenticated;

-- 7. Document decisions belong to the Admissions Office Head.
drop policy if exists "admissions_office_documents_update" on public.documents;
create policy "admissions_office_documents_update" on public.documents
for update using (public.is_admissions_head()) with check (public.is_admissions_head());

-- Verification (run after applying):
--   select school, cluster, approver_role from public.approval_levels order by school;
--   select conname from pg_constraint where conname in (
--     'profiles_role_check', 'profiles_review_scope_check',
--     'application_review_comments_author_role_check', 'application_interview_notes_author_role_check');

-- Stage authority by role, following the process Ma'am Devi described at
-- Consultation 2 (Oct 27):
--
--   Admissions Office Head  Submitted -> Under Review -> For Verification, verifies
--                           every file, then forwards the case straight to the
--                           interviewer (For Verification -> Endorsed; the separate
--                           endorsement hand-off is retired). Superset override on
--                           the interview and approval moves. Final check and
--                           release (Approved -> Released), or Approved -> Rejected
--                           when the final check finds a sibling already on a grant
--                           or a pending case.
--   Admissions Office Staff no stage moves; a read-only office view.
--   Interviewer, and any    Endorsed -> Interview (scheduling) and, once on the
--   ladder level in scope   panel, Interview -> Recommended. An interviewer never
--                           rejects: "Not recommended" is a recommendation level.
--   Approver                Recommended -> Approved / Rejected, when the caller's
--                           role is approver_role_for_student() for the applicant.
--
-- src/lib/constants.js `getNextApplicationStatuses()` mirrors this map.
-- The legacy For Endorsement -> Endorsed move stays with the Head so rows sent to
-- endorsement before this migration can still leave that stage.

create or replace function public.enforce_admissions_office_lane_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
  v_allowed boolean := false;
begin
  -- Students (enforce_student_application_update) and service-role jobs are
  -- governed elsewhere.
  if caller_role is null or caller_role = 'student' then
    return new;
  end if;

  -- A scoped reviewer writes the interview and deliberation stage payloads only;
  -- the submitted record, the office's endorsement and release records stay as
  -- they were.
  if caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if new.student_id is distinct from old.student_id
      or new.scholarship_id is distinct from old.scholarship_id
      or new.statement is distinct from old.statement
      or new.profile_snapshot is distinct from old.profile_snapshot
      or new.certified_at is distinct from old.certified_at
      or new.submitted_at is distinct from old.submitted_at
      or new.endorsement is distinct from old.endorsement
      or new.release is distinct from old.release then
      raise exception 'A reviewer can only record the interview and the recommendation on an application.'
        using errcode = '42501';
    end if;
  end if;

  -- Staff have no update policy any more, so a non-status write by them never
  -- reaches this trigger; a status move is refused below.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_head' then
    v_allowed := (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Rejected'))
      or (old.status = 'Approved' and new.status in ('Released', 'Rejected'));
  elsif caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if public.reviewer_scopes_to_student(new.student_id) then
      v_allowed := (old.status = 'Endorsed' and new.status = 'Interview')
        or (
          old.status = 'Interview' and new.status = 'Recommended'
          and public.is_interview_panelist(new.id)
        )
        or (
          caller_role <> 'interviewer'
          and old.status = 'Recommended' and new.status in ('Approved', 'Rejected')
          and caller_role = public.approver_role_for_student(new.student_id)
        );
    end if;
  end if;

  if not v_allowed then
    raise exception 'Your role cannot move this application from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admissions_office_lane_transitions on public.applications;
create trigger enforce_admissions_office_lane_transitions
  before update on public.applications
  for each row execute function public.enforce_admissions_office_lane_transitions();

revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

-- Row access for the writes above. The trigger decides which status move is
-- allowed; these policies decide which rows each role may touch at all.
drop policy if exists "admissions_staff_applications_update" on public.applications;

drop policy if exists "admissions_head_applications_update" on public.applications;
create policy "admissions_head_applications_update" on public.applications
for update using (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected')
);

drop policy if exists "reviewer_applications_update" on public.applications;
create policy "reviewer_applications_update" on public.applications
for update using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended')
) with check (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended', 'Approved', 'Rejected')
);

-- The case-officer roster is no longer how work is routed (an applicant reaches
-- the interviewers of its scope automatically), so only the Head opens a case
-- into review. `join_application_review` still checks the caller itself; the
-- trigger above refuses a Staff status move.

-- Results are released per scholarship, in one batch (Consultation 2, #8 and #13).
--
-- Until the Admissions Office Head releases a scholarship's results, no outcome
-- reaches the student: notify-application-status holds the Approved and Rejected
-- notices, and the student's surfaces show "Under deliberation". Releasing:
--
--   1. moves the remaining Approved cases to Released (the normal status write,
--      which notifies each accepted applicant), then
--   2. calls record_results_release(), which records this release with the
--      number of applicants and the number accepted, and the exact applications
--      it covers, then
--   3. this table's insert trigger calls notify-application-status in its
--      `results-release` mode, which sends every covered, non-accepted applicant
--      the general letter: no reason, only the counts.
--
-- Students read these rows (the counts are what the letter states, and the
-- covered application ids are what unmask a Rejected status on their own
-- surfaces); only the Head inserts, through the function.
--
-- Setup before applying, as for the other notify migrations:
--   1. Replace <project-ref> with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> with the REMINDER_CRON_SECRET value.
--   3. Redeploy notify-application-status with verify_jwt disabled.

create table if not exists public.results_releases (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  released_at timestamptz not null default now(),
  released_by uuid references public.profiles(user_id) on delete set null default auth.uid(),
  applicant_count integer not null check (applicant_count >= 0),
  accepted_count integer not null check (accepted_count >= 0),
  application_ids uuid[] not null default '{}'
);
create index if not exists results_releases_scholarship_idx
  on public.results_releases (scholarship_id, released_at);

alter table public.results_releases enable row level security;

drop policy if exists "results_releases_read" on public.results_releases;
create policy "results_releases_read" on public.results_releases
for select to authenticated using (true);
-- No insert/update/delete policy: record_results_release() writes as definer.

create or replace function public.record_results_release(p_scholarship_id uuid)
returns public.results_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_covered uuid[];
  v_applicants integer;
  v_accepted integer;
  v_row public.results_releases;
begin
  if not public.is_admissions_head() then
    raise exception 'Only the Admissions Office Head can release results.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.applications
    where scholarship_id = p_scholarship_id and status = 'Approved'
  ) then
    raise exception 'Release every approved application of this scholarship before recording the results.'
      using errcode = '23514';
  end if;

  -- Decided applications not covered by an earlier release.
  select coalesce(array_agg(a.id), '{}')
    into v_covered
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status in ('Released', 'Rejected')
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id and a.id = any (r.application_ids)
      );
  if coalesce(array_length(v_covered, 1), 0) = 0 then
    raise exception 'There are no decided applications to release for this scholarship.'
      using errcode = '23514';
  end if;

  -- Applicants this cycle: every submitted application not covered before,
  -- including the ones still in progress.
  select count(*)
    into v_applicants
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status <> 'Draft'
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id and a.id = any (r.application_ids)
      );
  select count(*) into v_accepted
    from public.applications a
    where a.id = any (v_covered) and a.status = 'Released';

  insert into public.results_releases (scholarship_id, applicant_count, accepted_count, application_ids)
  values (p_scholarship_id, v_applicants, v_accepted, v_covered)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_results_release(uuid) from public, anon;
grant execute on function public.record_results_release(uuid) to authenticated;


-- Reference only (placeholders, like the other notify blocks above):
-- create extension if not exists pg_net;
--
-- create or replace function public.notify_results_release()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public, net
-- as $$
-- begin
--   perform net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/notify-application-status',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
--       'Content-Type', 'application/json'
--     ),
--     body := jsonb_build_object('mode', 'results-release', 'releaseId', new.id)
--   );
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists notify_results_release on public.results_releases;
-- create trigger notify_results_release
--   after insert on public.results_releases
--   for each row execute function public.notify_results_release();


-- Student support inbox (20261051000000_add_support_inbox.sql).
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles(user_id) on delete cascade,
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  last_message_at timestamptz,
  last_message_by text check (last_message_by in ('student', 'admissions_office', 'admissions_head')),
  student_last_read_at timestamptz,
  office_last_read_at timestamptz,
  student_unread_count integer not null default 0 check (student_unread_count >= 0),
  office_unread_count integer not null default 0 check (office_unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_threads_last_message_idx
  on public.support_threads (last_message_at desc nulls last);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(user_id) on delete cascade,
  sender_role text not null check (sender_role in ('student', 'admissions_office', 'admissions_head')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread_created_idx
  on public.support_messages (thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_threads from public, anon, authenticated;
grant select on public.support_threads to authenticated;
revoke all on public.support_messages from public, anon, authenticated;
grant select, insert on public.support_messages to authenticated;

drop policy if exists "support_threads_read" on public.support_threads;
create policy "support_threads_read" on public.support_threads
for select using (student_id = auth.uid() or public.is_admissions_office());
drop policy if exists "support_messages_read" on public.support_messages;
create policy "support_messages_read" on public.support_messages
for select using (
  public.is_admissions_office()
  or exists (
    select 1 from public.support_threads t
    where t.id = support_messages.thread_id and t.student_id = auth.uid()
  )
);
drop policy if exists "support_messages_insert" on public.support_messages;
create policy "support_messages_insert" on public.support_messages
for insert with check (
  sender_id = auth.uid()
  and sender_role = public.current_profile_role()
  and sender_role in ('student', 'admissions_office', 'admissions_head')
  and (
    public.is_admissions_office()
    or exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.student_id = auth.uid()
    )
  )
);

create or replace function public.stamp_support_message_identity()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text := public.current_profile_role();
begin
  if caller_role is null or caller_role not in ('student', 'admissions_office', 'admissions_head') then
    raise exception 'This account cannot send support messages.';
  end if;
  if caller_role = 'student' and not exists (
    select 1 from public.support_threads t where t.id = new.thread_id and t.student_id = auth.uid()
  ) then raise exception 'You can only message the Admissions Office in your own thread.'; end if;
  new.sender_id := auth.uid();
  new.sender_role := caller_role;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists stamp_support_message_identity on public.support_messages;
create trigger stamp_support_message_identity before insert on public.support_messages
for each row execute function public.stamp_support_message_identity();

create or replace function public.update_support_thread_after_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_threads set
    last_message_at = new.created_at,
    last_message_by = new.sender_role,
    status = 'Open',
    student_unread_count = student_unread_count + case when new.sender_role = 'student' then 0 else 1 end,
    office_unread_count = office_unread_count + case when new.sender_role = 'student' then 1 else 0 end,
    updated_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;
drop trigger if exists update_support_thread_after_message on public.support_messages;
create trigger update_support_thread_after_message after insert on public.support_messages
for each row execute function public.update_support_thread_after_message();

create or replace function public.notify_student_of_support_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare student_profile_id uuid; in_app_preference text;
begin
  if new.sender_role not in ('admissions_office', 'admissions_head') then return new; end if;
  select t.student_id into student_profile_id from public.support_threads t where t.id = new.thread_id;
  select p.notification_preferences ->> 'inAppEnabled' into in_app_preference
    from public.profiles p where p.user_id = student_profile_id;
  if in_app_preference is distinct from 'false' then
    insert into public.notifications (profile_id, title, body, channel, status, source_key)
    values (student_profile_id, 'Admissions Office replied', 'A reply is waiting in your Support inbox.',
      'In-app', 'Unread', 'support-reply-' || new.thread_id::text || '-' || new.id::text)
    on conflict (profile_id, source_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists notify_student_of_support_reply on public.support_messages;
create trigger notify_student_of_support_reply after insert on public.support_messages
for each row execute function public.notify_student_of_support_reply();

create or replace function public.get_or_create_support_thread()
returns public.support_threads language plpgsql security definer set search_path = public as $$
declare result public.support_threads;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can start a support thread.';
  end if;
  insert into public.support_threads (student_id) values (auth.uid())
    on conflict (student_id) do nothing returning * into result;
  if result.id is null then select * into result from public.support_threads where student_id = auth.uid(); end if;
  return result;
end;
$$;

create or replace function public.mark_support_thread_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller_role text := public.current_profile_role();
begin
  if caller_role = 'student' then
    update public.support_threads set student_last_read_at = now(), student_unread_count = 0
      where id = p_thread_id and student_id = auth.uid();
  elsif caller_role in ('admissions_office', 'admissions_head') then
    update public.support_threads set office_last_read_at = now(), office_unread_count = 0 where id = p_thread_id;
  else raise exception 'This account cannot access the support inbox.';
  end if;
end;
$$;

create or replace function public.set_support_thread_status(p_thread_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admissions_office() is not true then raise exception 'Only the Admissions Office can change support thread status.'; end if;
  if p_status not in ('Open', 'Closed') then raise exception 'Invalid support thread status.'; end if;
  update public.support_threads set status = p_status, updated_at = now() where id = p_thread_id;
end;
$$;

revoke all on function public.get_or_create_support_thread() from public;
revoke all on function public.mark_support_thread_read(uuid) from public;
revoke all on function public.set_support_thread_status(uuid, text) from public;
revoke all on function public.stamp_support_message_identity() from public;
revoke all on function public.update_support_thread_after_message() from public;
revoke all on function public.notify_student_of_support_reply() from public;
grant execute on function public.get_or_create_support_thread() to authenticated;
grant execute on function public.mark_support_thread_read(uuid) to authenticated;
grant execute on function public.set_support_thread_status(uuid, text) to authenticated;
