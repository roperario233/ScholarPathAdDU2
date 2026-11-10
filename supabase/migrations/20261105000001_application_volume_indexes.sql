-- Indexes for the paginated queue, student-list, notification and reminder
-- access patterns. Keep these aligned with the query plans measured in staging.
create index if not exists applications_status_submitted_at_id_idx
  on public.applications (status, submitted_at, id);
create index if not exists applications_updated_at_id_idx
  on public.applications (updated_at desc, id);
create index if not exists applications_student_updated_at_id_idx
  on public.applications (student_id, updated_at desc, id);
create index if not exists applications_scholarship_status_submitted_at_idx
  on public.applications (scholarship_id, status, submitted_at, id);

create index if not exists documents_owner_uploaded_at_id_idx
  on public.documents (owner_id, uploaded_at desc, id);
create index if not exists documents_status_uploaded_at_id_idx
  on public.documents (verification_status, uploaded_at desc, id);

create index if not exists notifications_profile_created_at_id_idx
  on public.notifications (profile_id, created_at desc, id);
create index if not exists notification_email_log_user_id_idx
  on public.notification_email_log (user_id);
create index if not exists custom_deadlines_deadline_idx
  on public.custom_deadlines (deadline);

-- Keep later-added actor foreign keys cheap to resolve on account deletion and
-- staff attribution lookups; the original FK-index migration predates these.
create index if not exists application_grant_amounts_set_by_idx
  on public.application_grant_amounts (set_by);
create index if not exists application_waitlist_ranks_set_by_idx
  on public.application_waitlist_ranks (set_by);
create index if not exists scholarship_offers_responded_by_idx
  on public.scholarship_offers (responded_by);
create index if not exists support_messages_sender_id_idx
  on public.support_messages (sender_id);
create index if not exists support_messages_replying_to_id_idx
  on public.support_messages (replying_to_id);
