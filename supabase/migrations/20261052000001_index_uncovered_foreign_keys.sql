-- Cover the foreign keys the performance linter reports as
-- `unindexed_foreign_keys` (lint 0001).
--
-- None of these columns is the leading column of an existing index, so a
-- delete or update of the referenced row makes Postgres scan the whole child
-- table to enforce the constraint, and the lookups that read "the rows for this
-- parent" (an officer's cases, a student's documents, a chair's reviews) cannot
-- use an index at all. The dataset is small today, so this is housekeeping
-- rather than a fix for a measured problem.
--
-- Composite indexes already present are left alone: they do not cover these
-- columns as a prefix, which is why the linter reports them.
-- (`results_releases_scholarship_id` is already covered by
-- `results_releases_scholarship_idx (scholarship_id, released_at)`, so only its
-- `released_by` actor column is added here.)
--
-- Every statement is `if not exists`, so the file is safe to re-run.

-- Account provisioning.
create index if not exists account_invitations_claimed_by_idx
  on public.account_invitations (claimed_by);
create index if not exists account_invitations_invited_by_idx
  on public.account_invitations (invited_by);
create index if not exists account_invitations_revoked_by_idx
  on public.account_invitations (revoked_by);
create index if not exists account_provisioning_log_actor_id_idx
  on public.account_provisioning_log (actor_id);
create index if not exists account_provisioning_log_target_user_id_idx
  on public.account_provisioning_log (target_user_id);

-- Applications and their case work.
create index if not exists applications_student_id_idx
  on public.applications (student_id);
create index if not exists applications_scholarship_id_idx
  on public.applications (scholarship_id);
create index if not exists application_documents_document_id_idx
  on public.application_documents (document_id);
create index if not exists application_case_officers_added_by_idx
  on public.application_case_officers (added_by);
create index if not exists application_review_comments_author_id_idx
  on public.application_review_comments (author_id);

-- Documents and the office-only financial record.
create index if not exists documents_owner_id_idx
  on public.documents (owner_id);
create index if not exists application_financial_details_student_id_idx
  on public.application_financial_details (student_id);

-- Interview workspace.
create index if not exists application_interview_panelists_added_by_idx
  on public.application_interview_panelists (added_by);
create index if not exists interview_locations_created_by_idx
  on public.interview_locations (created_by);

-- Review ladder, catalog, and release.
create index if not exists department_reviews_reviewer_id_idx
  on public.department_reviews (reviewer_id);
create index if not exists approval_levels_updated_by_idx
  on public.approval_levels (updated_by);
create index if not exists results_releases_released_by_idx
  on public.results_releases (released_by);
create index if not exists announcements_created_by_idx
  on public.announcements (created_by);
create index if not exists office_calendar_entries_created_by_idx
  on public.office_calendar_entries (created_by);
