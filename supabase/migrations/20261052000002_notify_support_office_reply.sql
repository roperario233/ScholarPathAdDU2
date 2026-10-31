
create or replace function public.notify_office_of_support_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient record;
begin
  if new.sender_role is distinct from 'student' then
    return new;
  end if;

  for recipient in
    select p.user_id, p.notification_preferences ->> 'inAppEnabled' as in_app_preference
    from public.profiles p
    where p.role in ('admissions_office', 'admissions_head')
  loop
    if recipient.in_app_preference is distinct from 'false' then
      insert into public.notifications (profile_id, title, body, channel, status, source_key)
      values (
        recipient.user_id,
        'Student replied',
        'A student replied in the Support inbox.',
        'In-app',
        'Unread',
        'support-message-' || new.thread_id::text || '-' || new.id::text
      )
      on conflict (profile_id, source_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_office_of_support_message on public.support_messages;
create trigger notify_office_of_support_message
after insert on public.support_messages
for each row execute function public.notify_office_of_support_message();

revoke all on function public.notify_office_of_support_message() from public;

-- Opening the conversation is the inbox's read action for both its unread badge
-- and its related in-app notification rows.
create or replace function public.mark_support_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
begin
  if caller_role = 'student' then
    update public.support_threads
    set student_last_read_at = now(), student_unread_count = 0
    where id = p_thread_id and student_id = auth.uid();

    if found then
      update public.notifications
      set status = 'Read'
      where profile_id = auth.uid()
        and status = 'Unread'
        and source_key like 'support-reply-' || p_thread_id::text || '-%';
    end if;
  elsif caller_role in ('admissions_office', 'admissions_head') then
    update public.support_threads
    set office_last_read_at = now(), office_unread_count = 0
    where id = p_thread_id and public.is_admissions_office();

    if found then
      update public.notifications n
      set status = 'Read'
      where n.profile_id = auth.uid()
        and n.status = 'Unread'
        and n.source_key like 'support-message-' || p_thread_id::text || '-%';
    end if;
  else
    raise exception 'This account cannot access the support inbox.';
  end if;
end;
$$;

revoke all on function public.mark_support_thread_read(uuid) from public;
grant execute on function public.mark_support_thread_read(uuid) to authenticated;

notify pgrst, 'reload schema';
