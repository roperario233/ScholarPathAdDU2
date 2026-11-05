-- ---------------------------------------------------------------------------
-- Durable, bounded notification dispatch (outbox) and an append-only delivery
-- attempt record.
--
-- Before: every changed application fired its own pg_net request from the
-- status trigger. Releasing or closing a round of 1,000 cases therefore queued
-- 1,000 Edge Function calls inside one transaction, and a call that failed was
-- retried only by the next status change or by the browser.
--
-- Now the triggers hand the call to public.dispatch_notification():
--   * the first few notifications of a transaction (a normal single status change)
--     are sent at once, exactly as before;
--   * the rest of a bulk transaction wait as `pending` rows in
--     public.notification_outbox, and a once-a-minute worker sends them in
--     bounded batches;
--   * every call is recorded, its pg_net response is read back, and a failed or
--     lost call is retried with backoff (the Edge Functions are idempotent on
--     their source keys, so a retry never duplicates an in-app row or an email).
--
-- A dispatch problem never blocks the business write: the trigger path catches
-- every error and leaves the row pending for the worker.
--
-- Setup: nothing to replace by hand. The project URL and the shared secret are
-- copied once from the notify_application_status_change() function that
-- 20261014000003 installed with the real values (the same technique as
-- 20261050000002), into public.notification_dispatch_config, which no API role can
-- read. To rotate the secret later, update that single row.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- --- Dispatch settings (service-side only) ----------------------------------

create table if not exists public.notification_dispatch_config (
  id boolean primary key default true check (id),
  functions_base_url text not null,
  bearer_secret text not null,
  updated_at timestamptz not null default now()
);
alter table public.notification_dispatch_config enable row level security;
revoke all on public.notification_dispatch_config from public, anon, authenticated;

do $migration$
declare
  v_source text;
  v_url text;
  v_secret text;
begin
  if exists (select 1 from public.notification_dispatch_config) then
    return;
  end if;

  select p.prosrc
    into v_source
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_application_status_change';
  v_url := substring(v_source from 'url := ''([^'']*/functions/v1/)notify-application-status''');
  -- Accepts both 'Bearer <secret>' and 'Bearer ' || '<secret>'.
  v_secret := substring(v_source from 'Bearer (?:'' \|\| '')?([^'']+)''');
  if v_url is null or v_secret is null or v_url like '%<%' or v_secret like '<%' then
    raise exception 'notify_application_status_change() has no deployed URL and secret to copy. Apply 20261014000003 with its real values first, or insert one row into public.notification_dispatch_config yourself.';
  end if;

  insert into public.notification_dispatch_config (functions_base_url, bearer_secret)
  values (v_url, v_secret);
end;
$migration$;

-- --- Outbox ------------------------------------------------------------------

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  function_name text not null check (function_name in ('notify-application-status')),
  payload jsonb not null,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'dispatched', 'sent', 'failed')),
  attempts integer not null default 0,
  request_id bigint,
  next_attempt_at timestamptz not null default now(),
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);

-- One live entry per logical notification: a duplicate trigger firing while the
-- first is still pending or in flight adds nothing.
create unique index if not exists notification_outbox_active_dedupe_idx
  on public.notification_outbox (dedupe_key)
  where status in ('pending', 'dispatched');
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (next_attempt_at, id)
  where status = 'pending';
create index if not exists notification_outbox_dispatched_idx
  on public.notification_outbox (dispatched_at, id)
  where status = 'dispatched';
create index if not exists notification_outbox_completed_idx
  on public.notification_outbox (completed_at)
  where status = 'sent';

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant select on public.notification_outbox to service_role;

-- --- Sending -----------------------------------------------------------------

-- Sends one outbox row through pg_net. Returns the pg_net request id.
create or replace function public.notification_outbox_send(p_function_name text, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_config public.notification_dispatch_config%rowtype;
begin
  select * into v_config from public.notification_dispatch_config where id;
  if not found then
    raise exception 'notification_dispatch_config is empty';
  end if;
  return net.http_post(
    url := v_config.functions_base_url || p_function_name,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_config.bearer_secret,
      'Content-Type', 'application/json'
    ),
    body := p_payload
  );
end;
$$;
revoke all on function public.notification_outbox_send(text, jsonb) from public, anon, authenticated;

-- The one entry point the triggers call. Records the notification, then sends it
-- at once while the transaction is still small; beyond that the worker sends it.
create or replace function public.dispatch_notification(
  p_function_name text,
  p_payload jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_direct integer;
  v_request bigint;
begin
  -- Record first. An exception block rolls back everything inside it, so the
  -- insert sits outside the protected send below: whatever happens to the send,
  -- the row stays committed with the business write for the worker to retry.
  begin
    insert into public.notification_outbox (function_name, payload, dedupe_key)
    values (p_function_name, p_payload, p_dedupe_key)
    on conflict (dedupe_key) where status in ('pending', 'dispatched') do nothing
    returning id into v_id;
  exception when others then
    -- The outbox itself is unavailable: fall back to the previous behaviour (one
    -- direct call) rather than lose the notification or fail the status write.
    begin
      perform public.notification_outbox_send(p_function_name, p_payload);
    exception when others then
      null;
    end;
    return;
  end;
  if v_id is null then
    return;
  end if;

  -- Direct sends per transaction. A single status change sends at once; a bulk
  -- update (a release or a closing round touching hundreds of cases) sends the
  -- first few and leaves the rest pending, so one statement can no longer queue
  -- an unbounded number of Edge Function calls.
  v_direct := coalesce(nullif(current_setting('scholarpath.notify_direct_count', true), ''), '0')::integer;
  if v_direct >= 20 then
    return;
  end if;
  perform set_config('scholarpath.notify_direct_count', (v_direct + 1)::text, true);

  begin
    v_request := public.notification_outbox_send(p_function_name, p_payload);
    update public.notification_outbox
      set status = 'dispatched', request_id = v_request, attempts = attempts + 1, dispatched_at = now()
      where id = v_id;
  exception when others then
    -- Never fail the business write. The row stays pending, the worker retries.
    update public.notification_outbox set last_error = left(sqlerrm, 200) where id = v_id;
  end;
end;
$$;
revoke all on function public.dispatch_notification(text, jsonb, text) from public, anon, authenticated;

-- Sends pending rows in a bounded batch. `for update skip locked` lets two
-- overlapping worker runs share the queue without sending a row twice.
create or replace function public.drain_notification_outbox(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_request bigint;
  v_sent integer := 0;
begin
  for v_row in
    select id, function_name, payload
    from public.notification_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    begin
      v_request := public.notification_outbox_send(v_row.function_name, v_row.payload);
      update public.notification_outbox
        set status = 'dispatched', request_id = v_request, attempts = attempts + 1, dispatched_at = now(), last_error = null
        where id = v_row.id;
      v_sent := v_sent + 1;
    exception when others then
      update public.notification_outbox
        set attempts = attempts + 1,
            last_error = left(sqlerrm, 200),
            next_attempt_at = now() + (interval '1 minute' * power(2, least(attempts + 1, 6))),
            status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
            completed_at = case when attempts + 1 >= 5 then now() else null end
        where id = v_row.id;
    end;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.drain_notification_outbox(integer) from public, anon, authenticated;

-- Reads the pg_net outcome of every in-flight row. 2xx completes it; a 4xx other
-- than 408/429 is permanent (a bad request does not improve by repeating); a
-- timeout, 5xx, 408 or 429 is retried with exponential backoff, up to five
-- attempts. A request with no recorded response after 15 minutes is treated as
-- lost and retried, which is safe because the Edge Functions dedupe on source
-- keys. Finished rows are pruned after 14 days.
create or replace function public.reconcile_notification_outbox()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
begin
  update public.notification_outbox o
  set last_http_status = r.status_code,
      last_error = case when r.status_code between 200 and 299 then null else left(coalesce(r.error_msg, 'HTTP ' || coalesce(r.status_code::text, 'no status')), 200) end,
      status = case
        when r.status_code between 200 and 299 then 'sent'
        when r.status_code between 400 and 499 and r.status_code not in (408, 429) then 'failed'
        when o.attempts >= 5 then 'failed'
        else 'pending'
      end,
      completed_at = case
        when r.status_code between 200 and 299 then now()
        when r.status_code between 400 and 499 and r.status_code not in (408, 429) then now()
        when o.attempts >= 5 then now()
        else null
      end,
      next_attempt_at = now() + (interval '1 minute' * power(2, least(o.attempts, 6)))
  from net._http_response r
  where o.status = 'dispatched' and o.request_id = r.id;

  update public.notification_outbox o
  set status = case when o.attempts >= 5 then 'failed' else 'pending' end,
      last_error = 'No response recorded for the request',
      completed_at = case when o.attempts >= 5 then now() else null end,
      next_attempt_at = now() + (interval '1 minute' * power(2, least(o.attempts, 6)))
  where o.status = 'dispatched'
    and o.dispatched_at < now() - interval '15 minutes'
    and not exists (select 1 from net._http_response r where r.id = o.request_id);

  delete from public.notification_outbox
  where status in ('sent', 'failed') and completed_at < now() - interval '14 days';
end;
$$;
revoke all on function public.reconcile_notification_outbox() from public, anon, authenticated;

create or replace function public.run_notification_outbox()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_notification_outbox();
  return public.drain_notification_outbox(100);
end;
$$;
revoke all on function public.run_notification_outbox() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'run-notification-outbox') then
    perform cron.unschedule('run-notification-outbox');
  end if;
end $$;
select cron.schedule('run-notification-outbox', '* * * * *', $$select public.run_notification_outbox();$$);

-- --- Route the bulk-capable triggers through the outbox ---------------------

create or replace function public.notify_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.dispatch_notification(
      'notify-application-status',
      jsonb_build_object('applicationId', new.id),
      'application-status-' || new.id::text || '-' || new.status
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_application_status_change() from public, anon, authenticated;

create or replace function public.notify_results_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.dispatch_notification(
    'notify-application-status',
    jsonb_build_object('mode', 'results-release', 'releaseId', new.id),
    'results-release-' || new.id::text
  );
  return new;
end;
$$;
revoke all on function public.notify_results_release() from public, anon, authenticated;

-- --- Append-only delivery attempts ------------------------------------------

-- One row per channel outcome per run of an Edge Function. It records what
-- happened (sent, skipped, failed) and a short code; it never holds an address,
-- a phone number, a message body or a provider error text. The delivery ledger
-- (notification_email_log) stays the latest state per recipient and channel.
create table if not exists public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  function_name text not null,
  source_key text not null,
  user_id uuid,
  channel text not null check (channel in ('in-app', 'email', 'sms')),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  provider_message_id text,
  attempted_at timestamptz not null default now()
);
create index if not exists notification_delivery_attempts_source_idx
  on public.notification_delivery_attempts (source_key, attempted_at);
create index if not exists notification_delivery_attempts_attempted_idx
  on public.notification_delivery_attempts (attempted_at);
create index if not exists notification_delivery_attempts_user_idx
  on public.notification_delivery_attempts (user_id);

alter table public.notification_delivery_attempts enable row level security;
revoke all on public.notification_delivery_attempts from public, anon, authenticated;
grant select, insert on public.notification_delivery_attempts to service_role;

create or replace function public.forbid_delivery_attempt_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'notification_delivery_attempts is append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.forbid_delivery_attempt_changes() from public, anon, authenticated;

drop trigger if exists forbid_delivery_attempt_changes on public.notification_delivery_attempts;
create trigger forbid_delivery_attempt_changes
  before update or delete on public.notification_delivery_attempts
  for each row execute function public.forbid_delivery_attempt_changes();
