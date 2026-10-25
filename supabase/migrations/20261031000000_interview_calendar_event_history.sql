-- The interview calendar ledger becomes a history instead of one row per
-- application.
--
-- 20261030000000 keyed the table by application_id, so every action overwrote the
-- previous provider event. When a cancel could not reach Google, the next
-- schedule replaced that row and the orphaned event became unreachable: the
-- calendar ended up with two events for one interview, and nothing recorded the
-- one left behind.
--
-- Each provider event now keeps its own row. `is_current` marks the event that
-- applications.interview.calendar points at, so a superseded event is still known
-- and can be swept by the repair action.

alter table public.interview_calendar_events
  drop constraint if exists interview_calendar_events_pkey;

alter table public.interview_calendar_events
  add column if not exists ledger_id bigserial;

alter table public.interview_calendar_events
  add column if not exists is_current boolean not null default true;

alter table public.interview_calendar_events
  add constraint interview_calendar_events_pkey primary key (ledger_id);

-- One live event per application. A failed attempt keeps its row with
-- is_current = false, because it describes no event.
create unique index if not exists interview_calendar_events_current_idx
  on public.interview_calendar_events (application_id)
  where is_current;

create index if not exists interview_calendar_events_application_idx
  on public.interview_calendar_events (application_id, updated_at desc);

comment on column public.interview_calendar_events.is_current is
  'True for the provider event applications.interview.calendar points at; false for a superseded or failed event that is still tracked so the repair action can sweep it.';
