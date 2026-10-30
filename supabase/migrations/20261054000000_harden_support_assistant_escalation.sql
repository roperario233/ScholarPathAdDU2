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
        and t.assistant_enabled and t.escalated_at is null
    ) then
      raise exception 'Assistant replies can only be recorded in an active, un-escalated student thread.';
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

create or replace function public.post_assistant_support_message(p_thread_id uuid, p_body text, p_replying_to_id uuid)
returns public.support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.support_messages;
  thread_is_available boolean;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can request an assistant reply.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Assistant reply must contain between 1 and 2000 characters.';
  end if;

  -- Lock the thread so an escalation cannot race with an assistant response.
  select t.assistant_enabled and t.escalated_at is null into thread_is_available
  from public.support_threads t
  where t.id = p_thread_id and t.student_id = auth.uid()
  for update;
  if not coalesce(thread_is_available, false) then
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

revoke all on function public.stamp_support_message_identity() from public;
revoke all on function public.post_assistant_support_message(uuid, text, uuid) from public;
grant execute on function public.post_assistant_support_message(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';