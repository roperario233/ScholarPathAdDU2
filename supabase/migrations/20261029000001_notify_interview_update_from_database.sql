-- ---------------------------------------------------------------------------
-- Notify the interview panel and the student when an interview is scheduled,
-- rescheduled, or cancelled (SOP step 5).
--
-- The first schedule also moves the application to `Interview`, so the student
-- hears about it through notify-application-status (whose Interview message
-- carries the date, mode, and location or link). This AFTER UPDATE trigger calls
-- notify-interview-update whenever the interview revision or state changes, so:
--   * every account panelist is told about each new revision of the schedule;
--   * the student is told about a reschedule (revision > 1) or a cancellation.
-- The function dedupes on `interview-update-<applicationId>-<revision>-<state>`
-- (student) and `interview-panel-<applicationId>-<revision>-<state>` (each
-- panelist), so the browser's call after the write is a harmless retry. SMS is
-- sent only for this database caller, like the status and document functions.
--
-- Setup before applying:
--   1. Replace <project-ref> with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> with the same value set as the
--      REMINDER_CRON_SECRET Edge Function secret (already used by
--      20261014000003 and 20261021000001).
--   3. Deploy the function with verify_jwt disabled:
--        supabase functions deploy notify-interview-update --no-verify-jwt
--
-- pg_net queues the request, so the schedule write is never blocked.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

create or replace function public.notify_interview_update_change()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  if new.status = 'Interview'
    and (new.interview ? 'version')
    and (
      (new.interview ->> 'revision') is distinct from (old.interview ->> 'revision')
      or (new.interview ->> 'state') is distinct from (old.interview ->> 'state')
    ) then
    perform net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/notify-interview-update',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('applicationId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_interview_update_change on public.applications;
create trigger notify_interview_update_change
  after update on public.applications
  for each row execute function public.notify_interview_update_change();
