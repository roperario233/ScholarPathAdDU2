-- ---------------------------------------------------------------------------
-- Split the Admissions Office into two accountability lanes.
--
-- `admissions_office` stays the Staff lane: intake, document verification, the
-- hand-off to the Department Chair, interview scheduling, and the sub-committee
-- recommendation. The new `admissions_head` role decides SOP step 7 (approval)
-- and step 8 (results release) and owns the catalog and announcement surfaces.
-- Keeping the existing value means no profile or history backfill: every row
-- already written by the combined role remains a valid Staff row.
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Allow the new role value. -------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'admissions_office', 'admissions_head', 'department_chair'));

alter table public.application_review_comments
  drop constraint if exists application_review_comments_author_role_check;
alter table public.application_review_comments add constraint application_review_comments_author_role_check
  check (author_role in ('admissions_office', 'admissions_head', 'department_chair'));

-- 2. Lane helpers, security definer like current_profile_role(). ---------------
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

-- 3. Role-scoped stage authority, enforced in the database. --------------------
-- RLS cannot compare the old and new status of a row, so the same transition map
-- the app reads (src/lib/constants.js) is repeated here. Students and Department
-- Chairs are exempt: their writes are constrained by their own policies and
-- triggers, and a service-role job has no profile role.
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
      (old.status = 'Recommended' and new.status in ('Approved', 'Rejected'))
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

-- A trigger function is invoked by the database, never through PostgREST. Keep
-- it out of the RPC surface so an anon caller cannot probe it.
revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

-- 4. Applications: shared read, lane-scoped writes. ----------------------------
drop policy if exists "admissions_office_applications_access" on public.applications;
drop policy if exists "admissions_office_applications_read" on public.applications;
drop policy if exists "admissions_staff_applications_update" on public.applications;
drop policy if exists "admissions_head_applications_update" on public.applications;

create policy "admissions_office_applications_read" on public.applications
for select using (public.is_admissions_office());

create policy "admissions_staff_applications_update" on public.applications
for update using (
  public.is_admissions_staff()
  and status in ('Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview')
) with check (
  public.is_admissions_staff()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Interview', 'Recommended', 'Rejected')
);

create policy "admissions_head_applications_update" on public.applications
for update using (
  public.is_admissions_head()
  and status in ('Recommended', 'Approved')
) with check (
  public.is_admissions_head()
  and status in ('Approved', 'Released', 'Rejected')
);

-- 5. Documents: Staff verify, both lanes read, the student keeps their own. -----
drop policy if exists "admissions_office_documents_access" on public.documents;
drop policy if exists "admissions_office_documents_read" on public.documents;
drop policy if exists "admissions_staff_documents_update" on public.documents;

create policy "admissions_office_documents_read" on public.documents
for select using (public.is_admissions_office());

create policy "admissions_staff_documents_update" on public.documents
for update using (public.is_admissions_staff())
with check (public.is_admissions_staff());

-- 6. Catalog and communications belong to the Head. ----------------------------
drop policy if exists "admissions_office_scholarships_manage" on public.scholarships;
create policy "admissions_office_scholarships_manage" on public.scholarships
for all using (
  public.is_admissions_head()
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
) with check (
  public.is_admissions_head()
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
);

drop policy if exists "admissions_office_announcements_manage" on public.announcements;
create policy "admissions_office_announcements_manage" on public.announcements
for insert with check (public.is_admissions_head() and created_by = auth.uid());

drop policy if exists "admissions_office_academic_programs_manage" on public.academic_programs;
create policy "admissions_office_academic_programs_manage" on public.academic_programs
for all using (public.is_admissions_head()) with check (public.is_admissions_head());

-- 7. Shared staff reads: profiles, comments, status log, attachments, storage. --
drop policy if exists "staff_read_profiles" on public.profiles;
create policy "staff_read_profiles" on public.profiles
for select using (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'));

drop policy if exists "staff_review_comments_read" on public.application_review_comments;
create policy "staff_review_comments_read" on public.application_review_comments
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() = 'department_chair'
    and exists (
      select 1
      from public.applications a
      join public.profiles p on p.user_id = a.student_id
      where a.id = application_review_comments.application_id
        and p.department = public.current_profile_department()
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
      public.current_profile_role() = 'department_chair'
      and exists (
        select 1
        from public.applications a
        join public.profiles p on p.user_id = a.student_id
        where a.id = application_id
          and p.department = public.current_profile_department()
      )
    )
  )
);

drop policy if exists "status_log_staff_read" on public.application_status_log;
create policy "status_log_staff_read" on public.application_status_log
for select using (
  public.is_admissions_office()
  or (
    public.current_profile_role() = 'department_chair'
    and exists (
      select 1 from public.applications a
      where a.id = application_status_log.application_id
        and exists (
          select 1 from public.profiles p
          where p.user_id = a.student_id
            and p.department = public.current_profile_department()
        )
    )
  )
);

drop policy if exists "staff_application_documents_access" on public.application_documents;
create policy "staff_application_documents_access" on public.application_documents
for all using (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'))
with check (public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair'));

drop policy if exists "documents_storage_admissions_office_read" on storage.objects;
create policy "documents_storage_admissions_office_read" on storage.objects
for select to authenticated
using (bucket_id = 'documents' and public.is_admissions_office());

notify pgrst, 'reload schema';

