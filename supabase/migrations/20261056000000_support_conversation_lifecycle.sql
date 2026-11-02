-- ---------------------------------------------------------------------------
-- Support conversation lifecycle.
--
-- escalate_support_thread() sets support_threads.escalated_at and nothing ever
-- cleared it, so a student whose live-agent request had been answered (or whose
-- conversation the office had closed) stayed on "Live-agent request sent" and
-- the assistant never replied again.
--
-- A resolve now moves the escalation into history (last_escalated_at) and puts
-- the thread back in assistant mode, so every existing reader of escalated_at
-- and assistant_enabled (the chat, the assistant RPC gate, the notify triggers,
-- the office "Awaiting live agent" badge) already means the right thing. Messages
-- are never deleted: support_messages stays append-only and the office keeps the
-- full thread. student_view_from only hides older messages from the student's
-- own chat when they start a new question.
-- ---------------------------------------------------------------------------

alter table public.support_threads add column if not exists resolved_at timestamptz;
alter table public.support_threads add column if not exists resolved_by text;
alter table public.support_threads add column if not exists last_escalated_at timestamptz;
alter table public.support_threads add column if not exists student_view_from timestamptz;

alter table public.support_threads drop constraint if exists support_threads_resolved_by_check;
alter table public.support_threads add constraint support_threads_resolved_by_check
  check (resolved_by is null or resolved_by in ('student', 'admissions_office', 'admissions_admin', 'system'));

-- Not granted to any client role: only the RPCs below and the scheduled job call it.
create or replace function public.reset_support_thread(p_thread_id uuid, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_threads
  set last_escalated_at = coalesce(escalated_at, last_escalated_at),
      escalated_at = null,
      assistant_enabled = true,
      status = 'Closed',
      resolved_at = now(),
      resolved_by = p_by,
      updated_at = now()
  where id = p_thread_id;
end;
$$;

-- Closing a conversation returns it to the assistant; reopening only flips the status.
create or replace function public.set_support_thread_status(p_thread_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admissions_office() is not true then
    raise exception 'Only the Admissions Office can change support thread status.';
  end if;
  if p_status not in ('Open', 'Closed') then
    raise exception 'Invalid support thread status.';
  end if;
  if p_status = 'Closed' then
    perform public.reset_support_thread(p_thread_id, public.current_profile_role());
  else
    update public.support_threads set status = p_status, updated_at = now() where id = p_thread_id;
  end if;
end;
$$;

-- The student's "Mark as solved".
create or replace function public.resolve_support_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can resolve a support conversation.';
  end if;
  perform 1 from public.support_threads t
  where t.id = p_thread_id and t.student_id = auth.uid()
  for update;
  if not found then
    raise exception 'Support conversation not found.';
  end if;
  perform public.reset_support_thread(p_thread_id, 'student');
end;
$$;

-- The student's "Start a new question": back to the assistant, with the earlier
-- messages hidden from the student's own chat (the office still sees all of them).
-- A request the office has not answered yet cannot be abandoned this way.
create or replace function public.start_new_support_topic(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.support_threads;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can start a new support question.';
  end if;
  select * into thread from public.support_threads t
  where t.id = p_thread_id and t.student_id = auth.uid()
  for update;
  if not found then
    raise exception 'Support conversation not found.';
  end if;
  if thread.escalated_at is not null
    and thread.status <> 'Closed'
    and coalesce(thread.last_message_by, '') not in ('admissions_office', 'admissions_admin') then
    raise exception 'Your live-agent request is still waiting for the Admissions Office.';
  end if;
  if thread.escalated_at is not null or not thread.assistant_enabled then
    perform public.reset_support_thread(p_thread_id, 'student');
  end if;
  update public.support_threads set student_view_from = now(), updated_at = now() where id = p_thread_id;
end;
$$;

-- Backs up the office and the student: an answered conversation that nobody
-- closed returns to the assistant after three quiet days. A request still
-- waiting for the office is never touched. Also sweeps any conversation that was
-- closed before this migration and is still stuck in live-agent mode.
create or replace function public.auto_resolve_idle_support_threads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  resolved_count integer := 0;
begin
  for target in
    select t.id from public.support_threads t
    where (t.escalated_at is not null or not t.assistant_enabled)
      and (
        t.status = 'Closed'
        or (
          t.last_message_by in ('admissions_office', 'admissions_admin')
          and t.last_message_at < now() - interval '3 days'
        )
      )
  loop
    perform public.reset_support_thread(target.id, 'system');
    resolved_count := resolved_count + 1;
  end loop;
  return resolved_count;
end;
$$;

revoke all on function public.reset_support_thread(uuid, text) from public;
revoke all on function public.set_support_thread_status(uuid, text) from public;
revoke all on function public.resolve_support_thread(uuid) from public;
revoke all on function public.start_new_support_topic(uuid) from public;
revoke all on function public.auto_resolve_idle_support_threads() from public;
grant execute on function public.set_support_thread_status(uuid, text) to authenticated;
grant execute on function public.resolve_support_thread(uuid) to authenticated;
grant execute on function public.start_new_support_topic(uuid) to authenticated;

create extension if not exists pg_cron;

-- Recreate the job idempotently so re-applying does not stack duplicate schedules.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-resolve-idle-support-threads') then
    perform cron.unschedule('auto-resolve-idle-support-threads');
  end if;
end $$;

select cron.schedule(
  'auto-resolve-idle-support-threads',
  '0 * * * *',
  $$ select public.auto_resolve_idle_support_threads(); $$
);

-- One pass now clears conversations that are stuck today.
select public.auto_resolve_idle_support_threads();

notify pgrst, 'reload schema';
