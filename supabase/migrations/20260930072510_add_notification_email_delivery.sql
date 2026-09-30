-- ---------------------------------------------------------------------------
-- Email notification delivery (Resend).
--
-- Adds the server-side pieces the notification subsystem needs so deadline
-- reminders and application status alerts can be emailed, not only shown in the
-- in-app notification center:
--
--   * notification_preferences on profiles
--       Server-side mirror of the local notification settings so the scheduled
--       Edge Function can honor the student's Email Notifications toggle and
--       their 7-day / 3-day / 1-day reminder choices.
--   * notification_email_log
--       At-most-once delivery ledger keyed by (source_key, user_id), extended
--       with Resend delivery metadata so a failed send stays observable instead
--       of silently disappearing.
--   * custom_deadlines
--       Student-created calendar entries persisted to the database so the
--       server can email the same reminders the client generates locally. The
--       id column is text because the client uses `custom-<uuid>` ids, and
--       keeping them verbatim makes client and server sourceKeys identical.
-- ---------------------------------------------------------------------------

alter table profiles add column if not exists notification_preferences jsonb not null default '{}'::jsonb;

create table if not exists notification_email_log (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  user_id uuid not null,
  reminder_title text,
  email_to text,
  email_status text check (email_status in ('sent', 'failed', 'skipped')),
  email_id text,
  email_error text,
  delivered_at timestamptz not null default now(),
  unique (source_key, user_id)
);

alter table notification_email_log enable row level security;

drop policy if exists "notification_email_log_self_read" on notification_email_log;
create policy "notification_email_log_self_read" on notification_email_log
for select using (auth.uid() = user_id);

create table if not exists custom_deadlines (
  id text primary key,
  owner_id uuid not null references profiles(user_id) on delete cascade,
  title text not null,
  deadline date not null,
  created_at timestamptz not null default now()
);

create index if not exists custom_deadlines_owner_id_idx on custom_deadlines (owner_id);

alter table custom_deadlines enable row level security;

drop policy if exists "custom_deadlines_self_access" on custom_deadlines;
create policy "custom_deadlines_self_access" on custom_deadlines
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
