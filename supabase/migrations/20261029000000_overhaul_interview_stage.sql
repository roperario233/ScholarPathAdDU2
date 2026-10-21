-- ---------------------------------------------------------------------------
-- SOP step 5 - Interview of applicants.
--
-- SOP 5a: "Interviewing body / panel are from the school where the applicant's
-- program belongs." The Admissions Office (Staff and Head) coordinates the
-- interview and owns the status moves (Endorsed -> Interview -> Recommended);
-- the panel is drawn from the applicant's school (profiles.department, which is
-- the school: SEA, CAS, CCS, ...). A Department Chair on the panel records the
-- outcome and the private evaluation notes; Chair status authority is unchanged.
--
-- Data split:
--   * applications.interview (student-readable) holds only the public schedule:
--     { version: 2, state, revision, mode, startsAt, durationMinutes, locationId,
--       locationLabel, meetingUrl, school, calendar, instructions, scheduledBy,
--       scheduledAt, outcomeRecordedAt, outcomeRecordedBy, outcomeRecordedRole,
--       history[] }. No panelist identity or email is stored there.
--   * interview_locations: the Head-managed list of on-site venues.
--   * application_interview_panelists: staff-only panel membership.
--   * application_interview_notes: staff-only, append-only evaluation notes.
--
-- Additive and safe to re-run. The notification trigger lives in
-- 20261029000001_notify_interview_update_from_database.sql because it needs the
-- deployed project ref and the shared cron secret.
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

-- SOP 5a, server-side: an account panelist must be a Department Chair whose
-- department (school) is the applicant's.
create or replace function public.validate_interview_panelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school text;
  v_member_role text;
  v_member_school text;
begin
  if new.profile_id is null then
    return new;
  end if;
  select p.department into v_school
    from public.applications a
    join public.profiles p on p.user_id = a.student_id
    where a.id = new.application_id;
  select role, department into v_member_role, v_member_school
    from public.profiles
    where user_id = new.profile_id;
  if v_member_role is distinct from 'department_chair'
    or nullif(btrim(coalesce(v_school, '')), '') is null
    or v_member_school is distinct from v_school then
    raise exception 'Interview panelists must come from the school where the applicant''s program belongs (SOP 5a).'
      using errcode = '23514';
  end if;
  return new;
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
  select public.current_profile_role() = 'department_chair'
    and exists (
      select 1 from public.applications a
      join public.profiles p on p.user_id = a.student_id
      where a.id = p_application_id
        and p.department = public.current_profile_department()
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

-- The panel (or the Admissions Office on its behalf) records attendance. Only
-- the interview state and its attribution change; the application status does
-- not, so the Chair's status policies stay exactly as they were.
create or replace function public.record_interview_outcome(p_application_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications%rowtype;
  v_role text := public.current_profile_role();
  v_interview jsonb;
begin
  if p_outcome not in ('completed', 'no_show') then
    raise exception 'Record the interview as attended or not attended.' using errcode = '22023';
  end if;

  select * into v_application
    from public.applications
    where id = p_application_id
    for update;
  if not found then
    raise exception 'Application not found.' using errcode = '42501';
  end if;

  if not (
    v_role in ('admissions_office', 'admissions_head')
    or (v_role = 'department_chair' and public.is_interview_panelist(p_application_id))
  ) then
    raise exception 'Only the interview panel or the Admissions Office can record the interview outcome.' using errcode = '42501';
  end if;

  if v_application.status <> 'Interview' then
    raise exception 'This application is not at the interview stage.' using errcode = '23514';
  end if;

  v_interview := coalesce(v_application.interview, '{}'::jsonb);
  if coalesce(v_interview ->> 'state', '') <> 'scheduled' then
    raise exception 'Only a scheduled interview can have its outcome recorded.' using errcode = '23514';
  end if;
  if (v_interview ->> 'startsAt') is null or (v_interview ->> 'startsAt')::timestamptz > now() then
    raise exception 'The outcome can be recorded once the interview has started.' using errcode = '23514';
  end if;

  v_interview := v_interview || jsonb_build_object(
    'state', p_outcome,
    'outcomeRecordedAt', now(),
    'outcomeRecordedBy', auth.uid(),
    'outcomeRecordedRole', v_role
  );

  update public.applications
    set interview = v_interview, updated_at = now()
    where id = p_application_id;

  return v_interview;
end;
$$;

revoke all on function public.record_interview_outcome(uuid, text) from public, anon;
grant execute on function public.record_interview_outcome(uuid, text) to authenticated;

-- The Recommend gate: the sub-committee recommendation (SOP step 6) follows a
-- completed interview. A record scheduled before this migration carries no
-- version and is grandfathered. Rejected is always allowed.
create or replace function public.enforce_interview_outcome_before_recommendation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Interview'
    and new.status = 'Recommended'
    and (new.interview ? 'version')
    and coalesce(new.interview ->> 'state', '') <> 'completed' then
    raise exception 'The interview panel must record the applicant as attended before the recommendation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_interview_outcome_before_recommendation on public.applications;
create trigger enforce_interview_outcome_before_recommendation
  before update on public.applications
  for each row execute function public.enforce_interview_outcome_before_recommendation();

revoke all on function public.enforce_interview_outcome_before_recommendation() from public;
revoke all on function public.enforce_interview_outcome_before_recommendation() from anon, authenticated;

notify pgrst, 'reload schema';
