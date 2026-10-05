alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = 'admissions_office'
where role = 'osa_admin';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'admissions_office', 'department_chair'));

drop policy if exists "osa_documents_access" on public.documents;
drop policy if exists "admissions_office_documents_access" on public.documents;
create policy "admissions_office_documents_access" on public.documents
for all using (public.current_profile_role() = 'admissions_office')
with check (public.current_profile_role() = 'admissions_office');

drop policy if exists "osa_applications_access" on public.applications;
drop policy if exists "admissions_office_applications_access" on public.applications;
create policy "admissions_office_applications_access" on public.applications
for all using (public.current_profile_role() = 'admissions_office')
with check (public.current_profile_role() = 'admissions_office');

drop policy if exists "staff_read_profiles" on public.profiles;
create policy "staff_read_profiles" on public.profiles
for select using (public.current_profile_role() in ('admissions_office', 'department_chair'));

drop policy if exists "staff_application_documents_access" on public.application_documents;
create policy "staff_application_documents_access" on public.application_documents
for all using (public.current_profile_role() in ('admissions_office', 'department_chair'))
with check (public.current_profile_role() in ('admissions_office', 'department_chair'));

drop policy if exists "osa_announcements_manage" on public.announcements;
drop policy if exists "admissions_office_announcements_manage" on public.announcements;
create policy "admissions_office_announcements_manage" on public.announcements
for insert with check (public.current_profile_role() = 'admissions_office' and created_by = auth.uid());

drop policy if exists "osa_academic_programs_manage" on public.academic_programs;
drop policy if exists "admissions_office_academic_programs_manage" on public.academic_programs;
create policy "admissions_office_academic_programs_manage" on public.academic_programs
for all using (public.current_profile_role() = 'admissions_office')
with check (public.current_profile_role() = 'admissions_office');