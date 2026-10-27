-- ---------------------------------------------------------------------------
-- Maintenance: reset every transactional row while keeping the demo scaffolding.
--
-- Run manually (SQL editor, `supabase db` or a maintenance session); this is not
-- a migration and it changes no schema. Applied to the ScholarPath AdDU project
-- on 2026-10-28 for the clean-demo reset.
--
-- KEPT
--   public.profiles                    the signed-in accounts: Admissions Office
--                                      Staff/Head, Department Chairs, and the
--                                      student demo profiles with their answers
--                                      and notification preferences
--   public.annual_qpi_records          profile data, not an application
--   public.student_financial_profiles   the reusable Household finances section
--   public.scholarships                the catalog (3 active in-scope tracks plus
--                                      the 51 deactivated out-of-scope rows)
--   public.academic_programs           the program taxonomy
--   public.interview_locations         the venue list the Head maintains
--
-- DELETED (and why the order matters)
--   application_status_log is the only child table with `on delete NO ACTION`,
--   so it must be cleared before an application row can be removed. Everything
--   else under applications cascades: application_documents,
--   application_case_officers, application_interview_panelists,
--   application_interview_notes, application_review_comments,
--   department_reviews, application_financial_details, interview_calendar_events.
--   Documents are removed after the applications that referenced them, so
--   protect_submitted_application_documents never refuses the delete.
--
-- STORAGE
--   Removing the rows does not free the bucket bytes. Run
--   `node scripts/cleanup-orphaned-storage.mjs` (dry run) and then
--   `node scripts/cleanup-orphaned-storage.mjs --apply` with
--   SUPABASE_SERVICE_ROLE_KEY to delete every object no documents/profiles row
--   names. That command needs the service role because the storage RLS
--   policies only let a folder owner delete.
-- ---------------------------------------------------------------------------

begin;

-- 1. Safety snapshot. `if not exists` keeps the first snapshot intact if this
--    file is ever replayed; drop the schema when it is no longer wanted:
--    `drop schema backups cascade;`
create schema if not exists backups;

create table if not exists backups.reset_20261028_applications as
  select * from public.applications;
create table if not exists backups.reset_20261028_application_documents as
  select * from public.application_documents;
create table if not exists backups.reset_20261028_application_status_log as
  select * from public.application_status_log;
create table if not exists backups.reset_20261028_documents as
  select * from public.documents;
create table if not exists backups.reset_20261028_notifications as
  select * from public.notifications;
create table if not exists backups.reset_20261028_notification_email_log as
  select * from public.notification_email_log;
create table if not exists backups.reset_20261028_application_case_officers as
  select * from public.application_case_officers;
create table if not exists backups.reset_20261028_application_interview_panelists as
  select * from public.application_interview_panelists;
create table if not exists backups.reset_20261028_application_interview_notes as
  select * from public.application_interview_notes;
create table if not exists backups.reset_20261028_interview_calendar_events as
  select * from public.interview_calendar_events;
create table if not exists backups.reset_20261028_application_financial_details as
  select * from public.application_financial_details;
create table if not exists backups.reset_20261028_custom_deadlines as
  select * from public.custom_deadlines;
create table if not exists backups.reset_20261028_office_calendar_entries as
  select * from public.office_calendar_entries;
create table if not exists backups.reset_20261028_announcements as
  select * from public.announcements;
create table if not exists backups.reset_20261028_department_reviews as
  select * from public.department_reviews;
create table if not exists backups.reset_20261028_application_review_comments as
  select * from public.application_review_comments;
create table if not exists backups.reset_20261028_storage_objects as
  select id, bucket_id, name, metadata, created_at, updated_at
  from storage.objects
  where bucket_id in ('documents', 'avatars');

-- The snapshot holds personal data, so keep it off the API roles. The schema is
-- outside PostgREST's exposed schemas anyway ("public", "storage",
-- "graphql_public"), but this makes the intent explicit.
revoke all on schema backups from public, anon, authenticated;
revoke all on all tables in schema backups from public, anon, authenticated;

-- 2. Reset, in foreign-key order.
delete from public.application_status_log;
delete from public.applications;
delete from public.documents;
delete from public.notifications;
delete from public.notification_email_log;
delete from public.custom_deadlines;
delete from public.office_calendar_entries;
delete from public.announcements;

-- 3. Post-checks: fail the whole transaction instead of leaving a partial reset.
do $$
declare
  v_left integer;
begin
  select
    (select count(*) from public.applications)
    + (select count(*) from public.application_documents)
    + (select count(*) from public.application_status_log)
    + (select count(*) from public.documents)
    + (select count(*) from public.notifications)
    + (select count(*) from public.application_case_officers)
    + (select count(*) from public.application_interview_panelists)
    + (select count(*) from public.application_interview_notes)
    + (select count(*) from public.interview_calendar_events)
    + (select count(*) from public.application_financial_details)
  into v_left;

  if v_left > 0 then
    raise exception 'Reset incomplete: % transactional row(s) remain.', v_left;
  end if;
end
$$;

commit;

-- 4. Read-only confirmation.
select 'applications' as table_name, count(*) as rows from public.applications
union all select 'application_documents', count(*) from public.application_documents
union all select 'application_status_log', count(*) from public.application_status_log
union all select 'documents', count(*) from public.documents
union all select 'notifications', count(*) from public.notifications
union all select 'notification_email_log', count(*) from public.notification_email_log
union all select 'case_officers', count(*) from public.application_case_officers
union all select 'interview_panelists', count(*) from public.application_interview_panelists
union all select 'interview_notes', count(*) from public.application_interview_notes
union all select 'interview_calendar_events', count(*) from public.interview_calendar_events
union all select 'profiles (kept)', count(*) from public.profiles
union all select 'scholarships (kept)', count(*) from public.scholarships
union all select 'academic_programs (kept)', count(*) from public.academic_programs
union all select 'interview_locations (kept)', count(*) from public.interview_locations;
