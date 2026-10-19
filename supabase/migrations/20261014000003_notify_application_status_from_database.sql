-- ---------------------------------------------------------------------------
-- Notify on an application status change from the database (pg_net).
--
-- Chapter 3 (Section 3.3.4) describes a database-driven notification: whenever
-- an evaluator changes a status, the notification is triggered from the
-- database, not left to the browser. Today the app also calls the Edge Function
-- after writing the status, but a closed tab or a dropped connection between the
-- two writes loses the alert. This AFTER UPDATE trigger fires the same function
-- from the database, asynchronously and idempotently (the function dedupes on
-- `application-status-<applicationId>-<status>`), so the client call becomes a
-- harmless retry.
--
-- Setup before applying:
--   1. Replace <project-ref> with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> with the same long random value set as the
--      REMINDER_CRON_SECRET Edge Function secret. It is bound into the function
--      body because Supabase's `postgres` role cannot set an `app.*` database
--      setting. To rotate it, re-run this migration with the new value.
--   3. Deploy `notify-application-status` with verify_jwt disabled (like
--      process-deadline-reminders); it authenticates the secret itself and still
--      validates a signed-in user's JWT for the browser path.
--
-- pg_net queues the request, so the status write is never blocked, and a failed
-- call is simply retried by the next status change or the client.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

create or replace function public.notify_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  if new.status is distinct from old.status then
    perform net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/notify-application-status',
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

drop trigger if exists notify_application_status_change on public.applications;
create trigger notify_application_status_change
  after update on public.applications
  for each row execute function public.notify_application_status_change();
