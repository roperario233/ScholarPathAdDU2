-- ---------------------------------------------------------------------------
-- Fix: the interview notification trigger was applied with placeholders.
--
-- `20261029000001_notify_interview_update_from_database.sql` created
-- public.notify_interview_update_change() with the authoring placeholders in
-- place:
--     url := 'https://<project-ref>.supabase.co/functions/v1/notify-interview-update'
--     'Authorization', 'Bearer <REMINDER_CRON_SECRET>'
-- They were never substituted on this project, so pg_net posted to an
-- unresolvable host: no panelist or student interview notification ever left
-- the database, and the function itself had not been deployed either.
--
-- This migration recreates the same trigger function with the deployed project
-- ref filled in and the secret bound the way the two sibling notify triggers
-- (20261014000003, 20261021000001) already bind it. Replace
-- <REMINDER_CRON_SECRET> with the same value set as the REMINDER_CRON_SECRET
-- Edge Function secret before applying: `create or replace` keeps the function
-- OID, so the existing trigger stays bound.
--
-- The function is still not enough on its own — deploy it with verify_jwt
-- disabled (`supabase functions deploy notify-interview-update --no-verify-jwt`).
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
      url := 'https://xzptlibbavjswlbgjckx.supabase.co/functions/v1/notify-interview-update',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || '<REMINDER_CRON_SECRET>',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('applicationId', new.id)
    );
  end if;
  return new;
end;
$$;

-- Guard: a trigger body that still carries a placeholder can never deliver, and
-- that failure is invisible until someone checks pg_net. Warn loudly instead.
do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'notify_interview_update_change'
       and (
         pg_get_functiondef(p.oid) like '%<project-ref>%'
         or pg_get_functiondef(p.oid) like '%<REMINDER_CRON_SECRET>%'
       )
  ) then
    raise warning 'notify_interview_update_change still contains a placeholder; interview notifications will not be delivered until it is replaced';
  end if;
end $$;
