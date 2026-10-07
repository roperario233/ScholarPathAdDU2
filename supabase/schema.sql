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

-- Standard Procedure stage records (endorsement, interview, deliberation,
-- release) and the event timeline live on applications as JSON payloads.
alter table applications add column if not exists endorsement jsonb;
alter table applications add column if not exists interview jsonb;
alter table applications add column if not exists deliberation jsonb;
alter table applications add column if not exists release jsonb;
alter table applications add column if not exists timeline jsonb not null default '[]'::jsonb;

-- Widen the application status check to cover the SOP stage sequence
-- (Endorsed, Interview, Recommended, Released) additively.
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check
  check (status in ('Draft', 'Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'));

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
  created_at timestamptz not null default now()
);

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
drop policy if exists "documents_self_access" on documents;
drop policy if exists "osa_documents_access" on documents;
drop policy if exists "admissions_office_documents_access" on documents;
drop policy if exists "applications_self_access" on applications;
drop policy if exists "osa_applications_access" on applications;
drop policy if exists "admissions_office_applications_access" on applications;
drop policy if exists "chair_applications_read" on applications;
drop policy if exists "chair_applications_status" on applications;
drop policy if exists "application_documents_self_access" on application_documents;
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
create policy "documents_self_access" on documents
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "admissions_office_documents_access" on documents
for all using (public.current_profile_role() = 'admissions_office') with check (public.current_profile_role() = 'admissions_office');
create policy "applications_self_access" on applications
for all using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "admissions_office_applications_access" on applications
for all using (public.current_profile_role() = 'admissions_office') with check (public.current_profile_role() = 'admissions_office');
create policy "chair_applications_read" on applications
for select using (
  public.current_profile_role() = 'department_chair'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
);
create policy "chair_applications_status" on applications
for update using (
  public.current_profile_role() = 'department_chair'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
) with check (
  public.current_profile_role() = 'department_chair'
  and exists (select 1 from profiles p where p.user_id = applications.student_id and p.department = public.current_profile_department())
);
create policy "application_documents_self_access" on application_documents
for all using (
  exists (
    select 1 from applications a where a.id = application_id and a.student_id = auth.uid()
  )
) with check (
  exists (
    select 1 from applications a where a.id = application_id and a.student_id = auth.uid()
  )
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

