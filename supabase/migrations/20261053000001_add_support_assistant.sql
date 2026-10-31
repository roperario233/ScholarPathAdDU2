alter table public.profiles add column if not exists support_last_seen_at timestamptz;
alter table public.support_threads add column if not exists escalated_at timestamptz;
alter table public.support_threads add column if not exists assistant_enabled boolean not null default true;
alter table public.support_messages add column if not exists replying_to_id uuid references public.support_messages(id) on delete set null;
alter table public.support_messages alter column sender_id drop not null;
create unique index if not exists support_messages_assistant_reply_once_idx
  on public.support_messages (thread_id, replying_to_id)
  where sender_role = 'assistant' and replying_to_id is not null;

alter table public.support_threads drop constraint if exists support_threads_last_message_by_check;
alter table public.support_threads add constraint support_threads_last_message_by_check
  check (last_message_by in ('student', 'admissions_office', 'admissions_head', 'assistant'));
alter table public.support_messages drop constraint if exists support_messages_sender_role_check;
alter table public.support_messages add constraint support_messages_sender_role_check
  check (sender_role in ('student', 'admissions_office', 'admissions_head', 'assistant'));

create or replace function public.touch_office_support_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_profile_role(), '') not in ('admissions_office', 'admissions_head') then
    raise exception 'Only Admissions Office accounts can update office availability.';
  end if;
  update public.profiles
  set support_last_seen_at = now()
  where user_id = auth.uid()
    and (support_last_seen_at is null or support_last_seen_at < now() - interval '45 seconds');
end;
$$;

create or replace function public.get_admissions_office_availability()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  latest_seen timestamptz;
  local_now timestamp := now() at time zone 'Asia/Manila';
  office_open boolean;
begin
  if coalesce(public.current_profile_role(), '') not in ('student', 'admissions_office', 'admissions_head') then
    raise exception 'This account cannot access Admissions Office availability.';
  end if;
  select max(p.support_last_seen_at) into latest_seen
  from public.profiles p
  where p.role in ('admissions_office', 'admissions_head');

  office_open := extract(isodow from local_now) between 1 and 5
    and local_now::time >= time '08:00'
    and local_now::time < time '17:00';

  return jsonb_build_object(
    'online', latest_seen is not null and latest_seen >= now() - interval '5 minutes',
    'officeHoursOpen', office_open,
    'checkedAt', now()
  );
end;
$$;

-- Ordinary student messages are answered by the assistant first. Notify the
-- office only after the student has explicitly escalated the conversation.
create or replace function public.notify_office_of_support_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient record;
  is_escalated boolean;
begin
  if new.sender_role is distinct from 'student' then return new; end if;
  select t.escalated_at is not null or not t.assistant_enabled into is_escalated
  from public.support_threads t where t.id = new.thread_id;
  if not coalesce(is_escalated, false) then return new; end if;
  for recipient in
    select p.user_id, p.notification_preferences ->> 'inAppEnabled' as in_app_preference
    from public.profiles p where p.role in ('admissions_office', 'admissions_head')
  loop
    if recipient.in_app_preference is distinct from 'false' then
      insert into public.notifications (profile_id, title, body, channel, status, source_key)
      values (recipient.user_id, 'Student replied', 'A student replied in the Support inbox.',
        'In-app', 'Unread', 'support-message-' || new.thread_id::text || '-' || new.id::text)
      on conflict (profile_id, source_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.stamp_support_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
  assistant_insert boolean := current_setting('scholarpath.assistant_message', true) = 'on';
begin
  if assistant_insert then
    if caller_role is distinct from 'student' or not exists (
      select 1 from public.support_threads t
      where t.id = new.thread_id and t.student_id = auth.uid()
    ) then
      raise exception 'Assistant replies can only be recorded in the caller’s own student thread.';
    end if;
    new.sender_id := null;
    new.sender_role := 'assistant';
  else
    if caller_role is null or caller_role not in ('student', 'admissions_office', 'admissions_head') then
      raise exception 'This account cannot send support messages.';
    end if;
    if caller_role = 'student' and not exists (
      select 1 from public.support_threads t
      where t.id = new.thread_id and t.student_id = auth.uid()
    ) then
      raise exception 'You can only message the Admissions Office in your own thread.';
    end if;
    new.sender_id := auth.uid();
    new.sender_role := caller_role;
  end if;
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.update_support_thread_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_threads
  set last_message_at = new.created_at,
      last_message_by = new.sender_role,
      status = 'Open',
      assistant_enabled = case when new.sender_role in ('admissions_office', 'admissions_head') then false else assistant_enabled end,
      student_unread_count = student_unread_count + case when new.sender_role in ('admissions_office', 'admissions_head', 'assistant') then 1 else 0 end,
      office_unread_count = office_unread_count + case
        when new.sender_role = 'student' and exists (
          select 1 from public.support_threads t where t.id = new.thread_id and (t.escalated_at is not null or not t.assistant_enabled)
        ) then 1 else 0 end,
      updated_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;

create or replace function public.post_assistant_support_message(p_thread_id uuid, p_body text, p_replying_to_id uuid)
returns public.support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.support_messages;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can request an assistant reply.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Assistant reply must contain between 1 and 2000 characters.';
  end if;
  if not exists (
    select 1 from public.support_threads t
    where t.id = p_thread_id and t.student_id = auth.uid() and t.assistant_enabled
  ) then
    raise exception 'This support conversation is not available to the assistant.';
  end if;
  if not exists (
    select 1 from public.support_messages m
    where m.id = p_replying_to_id and m.thread_id = p_thread_id and m.sender_role = 'student'
  ) then
    raise exception 'The assistant reply must reference a student message in this conversation.';
  end if;
  if exists (
    select 1 from public.support_messages m
    where m.thread_id = p_thread_id and m.replying_to_id = p_replying_to_id and m.sender_role = 'assistant'
  ) then
    select * into result from public.support_messages m
    where m.thread_id = p_thread_id and m.replying_to_id = p_replying_to_id and m.sender_role = 'assistant'
    order by m.created_at desc limit 1;
    return result;
  end if;
  perform set_config('scholarpath.assistant_message', 'on', true);
  insert into public.support_messages (thread_id, sender_id, sender_role, body, replying_to_id)
  values (p_thread_id, null, 'assistant', btrim(p_body), p_replying_to_id)
  on conflict (thread_id, replying_to_id) where sender_role = 'assistant' and replying_to_id is not null do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.support_messages m
    where m.thread_id = p_thread_id and m.replying_to_id = p_replying_to_id and m.sender_role = 'assistant';
  end if;
  return result;
end;
$$;

create or replace function public.escalate_support_thread(p_thread_id uuid, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  escalation_time timestamptz;
  recipient record;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can request a live agent.';
  end if;
  select t.escalated_at into escalation_time
  from public.support_threads t
  where t.id = p_thread_id and t.student_id = auth.uid()
  for update;
  if not found then
    raise exception 'Support conversation not found.';
  end if;
  if escalation_time is not null then return escalation_time; end if;
  update public.support_threads set escalated_at = now(), status = 'Open',
    office_unread_count = greatest(office_unread_count, 1), updated_at = now()
  where id = p_thread_id returning escalated_at into escalation_time;
  for recipient in
    select p.user_id, p.notification_preferences ->> 'inAppEnabled' as in_app_preference
    from public.profiles p
    where p.role in ('admissions_office', 'admissions_head')
  loop
    if recipient.in_app_preference is distinct from 'false' then
      insert into public.notifications (profile_id, title, body, channel, status, source_key)
      values (
        recipient.user_id,
        'Student requested a live agent',
        'A student is waiting for a reply in the Support inbox.',
        'In-app',
        'Unread',
        'support-escalation-' || p_thread_id::text || '-' || floor(extract(epoch from escalation_time))::bigint::text
      ) on conflict (profile_id, source_key) do nothing;
    end if;
  end loop;
  return escalation_time;
end;
$$;

create or replace function public.mark_support_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare caller_role text := public.current_profile_role();
begin
  if caller_role = 'student' then
    update public.support_threads set student_last_read_at = now(), student_unread_count = 0
    where id = p_thread_id and student_id = auth.uid();
    if found then
      update public.notifications set status = 'Read'
      where profile_id = auth.uid() and status = 'Unread'
        and source_key like 'support-reply-' || p_thread_id::text || '-%';
    end if;
  elsif caller_role in ('admissions_office', 'admissions_head') then
    update public.support_threads set office_last_read_at = now(), office_unread_count = 0
    where id = p_thread_id and public.is_admissions_office();
    if found then
      update public.notifications n set status = 'Read'
      where n.profile_id = auth.uid() and n.status = 'Unread'
        and (n.source_key like 'support-message-' || p_thread_id::text || '-%'
          or n.source_key like 'support-escalation-' || p_thread_id::text || '-%');
    end if;
  else
    raise exception 'This account cannot access the support inbox.';
  end if;
end;
$$;

revoke all on function public.touch_office_support_presence() from public;
revoke all on function public.get_admissions_office_availability() from public;
revoke all on function public.post_assistant_support_message(uuid, text, uuid) from public;
revoke all on function public.escalate_support_thread(uuid, text) from public;
revoke all on function public.mark_support_thread_read(uuid) from public;
grant execute on function public.touch_office_support_presence() to authenticated;
grant execute on function public.get_admissions_office_availability() to authenticated;
grant execute on function public.post_assistant_support_message(uuid, text, uuid) to authenticated;
grant execute on function public.escalate_support_thread(uuid, text) to authenticated;
grant execute on function public.mark_support_thread_read(uuid) to authenticated;

notify pgrst, 'reload schema';