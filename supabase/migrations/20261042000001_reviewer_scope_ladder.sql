-- The reviewer scope ladder.
--
-- AdDU's academic reviewer roles each own one level of the hierarchy created by
-- 20261042000000_academic_program_hierarchy.sql:
--
--   Dean            (dean)            -> a School    (every cluster and department)
--   Assistant Dean  (assistant_dean)  -> a Cluster   (every department in it)
--   Chairperson     (department_chair) -> a Department (and its degree programs)
--
-- A reviewer's scope lives in three nullable columns on `profiles`, and a check
-- constraint keeps each role from carrying a level it does not own.
--
-- Before this migration every academic reviewer was a `department_chair` compared
-- against the applicant's SCHOOL, which is why the two Computer Studies chairs were
-- scoped to "College of Computer Studies (CCS)" and one SEA chair covered ten
-- unrelated departments. One predicate now replaces the seven copy-pasted
-- `p.department = current_profile_department()` checks, and it derives the
-- applicant's level from their degree program through the taxonomy, so a new
-- department needs no policy change.
--
-- Mirrors src/lib/reviewScope.js. The two must agree: this decides what a policy
-- allows, and that decides what a page lists.
--
-- Apply before deploying a frontend that reads `review_school` and friends;
-- `getProfileReviewScope()` in src/lib/auth.js tolerates the columns being absent so
-- a deployed app keeps working either way.

-- 1. Widen the role check.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair'));

-- 2. One column per level. Null means "not this reviewer's level".
alter table public.profiles add column if not exists review_school text;
alter table public.profiles add column if not exists review_cluster text;
alter table public.profiles add column if not exists review_department text;

-- 3. Move the seeded reviewer accounts onto the ladder.
--    Miguel chaired SEA, which has no clusters, so SEA is his school.
update public.profiles
set role = 'dean', review_school = 'School of Engineering and Architecture (SEA)',
    review_cluster = null, review_department = null, updated_at = now()
where email = 'miguel.chair.sea@gmail.com';

--    The two Computer Studies accounts were scoped to the retired CCS school. That
--    cluster now lives inside SAS, so they become its Assistant Deans and keep every
--    BSCS / BSDS / BSIT / BSIS case they could read before.
update public.profiles
set role = 'assistant_dean', review_school = 'School of Arts and Sciences (SAS)',
    review_cluster = 'Computer Studies', review_department = null, updated_at = now()
where email = 'ogs@addu.edu.ph';

--    The earlier seed stays the narrowest level to demonstrate department scope.
update public.profiles
set role = 'department_chair', review_school = null, review_cluster = null,
    review_department = 'Information Technology and Information Systems Department', updated_at = now()
where email = 'scholarpath.chair@gmail.com';

-- 4. A reviewer may only carry the levels their role owns. A Chairperson may hold a
--    department (its scope) or nothing at all (unscoped, see the legacy fallback
--    below), but never a cluster.
alter table public.profiles drop constraint if exists profiles_review_scope_check;
alter table public.profiles add constraint profiles_review_scope_check check (
  (review_cluster is null or role = 'assistant_dean')
  and (review_department is null or role = 'department_chair')
  and (review_school is null or role in ('dean', 'assistant_dean', 'department_chair'))
);

-- 5. The single access predicate behind every academic-reviewer policy.
--    `security definer` so a policy can read the applicant's profile and program
--    without depending on the caller's own RLS visibility.
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
        -- Chairperson: its department and the programs under it. A Chairperson an
        -- operator has not scoped yet keeps the old school-wide read, so an existing
        -- account is never locked out of the queue it had before this migration.
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
        -- Assistant Dean: its cluster inside its school.
        or (
          c.role = 'assistant_dean'
          and nullif(btrim(coalesce(c.review_school, '')), '') is not null
          and ap.school = c.review_school
          and (nullif(btrim(coalesce(c.review_cluster, '')), '') is null or ap.cluster = c.review_cluster)
        )
        -- Dean: its whole school.
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


-- 6. Every academic-reviewer policy now reads the one predicate. The role test stays
--    in front of it so the helper is only consulted for a reviewer account.
drop policy if exists "chair_documents_read" on public.documents;
create policy "chair_documents_read" on public.documents
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and public.reviewer_scopes_to_student(documents.owner_id)
);

drop policy if exists "chair_applications_read" on public.applications;
create policy "chair_applications_read" on public.applications
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and public.reviewer_scopes_to_student(applications.student_id)
);

drop policy if exists "staff_review_comments_read" on public.application_review_comments;
create policy "staff_review_comments_read" on public.application_review_comments
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
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
    public.is_admissions_office()
    or (
      public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
      and exists (
        select 1 from public.applications a
        where a.id = application_id
          and public.reviewer_scopes_to_student(a.student_id)
      )
    )
  )
);

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

-- 7. `is_chair_for_application` keeps its name (the interview policies call it) but
--    now delegates, so panel visibility follows the same ladder.
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

-- 8. SOP 5a, server-side. The panel is drawn from the school the applicant's program
--    belongs to, so every ladder level whose scope covers the applicant may sit on
--    it: the Chairperson of the department, the Assistant Dean of the cluster, and
--    the Dean of the school. The Admissions Office coordinates the interview (SOP
--    step 5) and may join any panel. Any member may be the lead.
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
  -- The applicant's level, resolved from their degree program through the taxonomy.
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
      -- A Chairperson an operator has not scoped yet keeps the school-wide read.
      return new;
    end if;
  end if;

  raise exception 'Interview panelists must be the Chairperson of the applicant''s department, the Assistant Dean of its cluster, or the Dean of its school (SOP 5a), or an Admissions Office account.'
    using errcode = '23514';
end;
$$;

revoke all on function public.validate_interview_panelist() from public;
revoke all on function public.validate_interview_panelist() from anon, authenticated;

-- Verification (run after applying):
--   select role, review_school, review_cluster, review_department, email
--     from public.profiles where role in ('dean','assistant_dean','department_chair')
--     order by role;
--   select proname from pg_proc where proname = 'reviewer_scopes_to_student';
--   select conname from pg_constraint where conname = 'profiles_review_scope_check';

