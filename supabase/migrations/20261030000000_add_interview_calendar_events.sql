-- The durable Google Calendar mirror of an interview (SOP step 5).
--
-- `applications.interview.calendar` is the copy the student and the staff read,
-- and it is cleared when an interview is cancelled so a later schedule creates a
-- fresh event. That clearing is exactly what makes a failed provider call
-- unrecoverable: once the event id is gone, an orphaned Google event keeps its
-- invitation and Meet link with nothing left to repair it from.
--
-- This table is the record of the provider event itself. It is written only by
-- the manage-interview-event Edge Function (service role), so it has RLS enabled
-- with no policies: no signed-in role can read or write it.
--
-- Applied to the deployed project by
-- supabase/migrations/20261030000000_add_interview_calendar_events.sql.

create table if not exists public.interview_calendar_events (
  application_id uuid primary key references public.applications(id) on delete cascade,
  provider text not null default 'google',
  calendar_id text not null,
  event_id text,
  html_link text,
  meet_url text,
  revision int,
  sync_state text not null default 'synced'
    check (sync_state in ('synced', 'failed', 'cancelled')),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.interview_calendar_events is
  'Durable provider-side record of an interview calendar event. Written by the manage-interview-event Edge Function only; survives a cleared applications.interview.calendar so a failed create/cancel can be found and repaired.';

create index if not exists interview_calendar_events_failed_idx
  on public.interview_calendar_events (updated_at desc)
  where sync_state = 'failed';

alter table public.interview_calendar_events enable row level security;

-- No policies: the Edge Function uses the service role, which bypasses RLS.
revoke all on public.interview_calendar_events from anon, authenticated;
