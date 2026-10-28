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
