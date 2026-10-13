-- ---------------------------------------------------------------------------
-- Schedule the daily deadline-reminder run (pg_cron + pg_net).
--
-- process-deadline-reminders must be invoked on a schedule for deadline
-- reminders (scholarship, application, and student-created custom deadlines) to
-- be emailed without the student having the app open. This applies the block
-- documented at the bottom of supabase/schema.sql so the deployed project
-- actually runs it.
--
-- Setup before applying:
--   1. Replace <project-ref> with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> with the same long random value you set as
--      the REMINDER_CRON_SECRET Edge Function secret. The scheduled caller
--      authenticates with it; the Edge Function compares it by exact value and
--      fails closed when its own secret is unset.
--
-- The value is bound into the scheduled command rather than read from a database
-- setting, because Supabase's `postgres` role cannot run
-- `alter database postgres set app.settings.reminder_cron_secret` (permission
-- denied to set parameter). To rotate the secret, re-run the cron.schedule
-- statement below with the new value.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Recreate the job idempotently so re-applying does not stack duplicate schedules.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-deadline-reminders-daily') then
    perform cron.unschedule('process-deadline-reminders-daily');
  end if;
end $$;

select cron.schedule(
  'process-deadline-reminders-daily',
  '0 23 * * *',  -- 07:00 PHT (UTC+8)
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/process-deadline-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
