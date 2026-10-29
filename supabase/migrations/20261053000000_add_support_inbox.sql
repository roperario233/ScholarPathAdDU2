-- ---------------------------------------------------------------------------
-- In-app student support inbox for the Admissions Office.
-- Students can read and write only their own continuous thread. Both Admissions
-- Office lanes can read every thread and reply. Academic reviewers have no
-- support-table policies. Messages are append-only and their identity is stamped
-- from the authenticated profile instead of trusted from browser input.
-- ---------------------------------------------------------------------------

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles(user_id) on delete cascade,
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  last_message_at timestamptz,
  last_message_by text check (last_message_by in ('student', 'admissions_office', 'admissions_head')),
  student_last_read_at timestamptz,
  office_last_read_at timestamptz,
  student_unread_count integer not null default 0 check (student_unread_count >= 0),
  office_unread_count integer not null default 0 check (office_unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on public.support_threads from public, anon, authenticated;
grant select on public.support_threads to authenticated;

create index if not exists support_threads_last_message_idx
  on public.support_threads (last_message_at desc nulls last);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(user_id) on delete cascade,
  sender_role text not null check (sender_role in ('student', 'admissions_office', 'admissions_head')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

revoke all on public.support_messages from public, anon, authenticated;
grant select, insert on public.support_messages to authenticated;

create index if not exists support_messages_thread_created_idx
  on public.support_messages (thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "support_threads_read" on public.support_threads;
create policy "support_threads_read" on public.support_threads
for select using (student_id = auth.uid() or public.is_admissions_office());

drop policy if exists "support_messages_read" on public.support_messages;
create policy "support_messages_read" on public.support_messages
for select using (
  public.is_admissions_office()
  or exists (
    select 1 from public.support_threads t
    where t.id = support_messages.thread_id and t.student_id = auth.uid()
  )
);

drop policy if exists "support_messages_insert" on public.support_messages;
create policy "support_messages_insert" on public.support_messages
for insert with check (
  sender_id = auth.uid()
  and sender_role = public.current_profile_role()
  and sender_role in ('student', 'admissions_office', 'admissions_head')
  and (
    public.is_admissions_office()
    or exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.student_id = auth.uid()
    )
  )
);

create or replace function public.stamp_support_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
begin
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
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_support_message_identity on public.support_messages;
create trigger stamp_support_message_identity
before insert on public.support_messages
for each row execute function public.stamp_support_message_identity();

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
      student_unread_count = student_unread_count + case when new.sender_role = 'student' then 0 else 1 end,
      office_unread_count = office_unread_count + case when new.sender_role = 'student' then 1 else 0 end,
      updated_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists update_support_thread_after_message on public.support_messages;
create trigger update_support_thread_after_message
after insert on public.support_messages
for each row execute function public.update_support_thread_after_message();

create or replace function public.notify_student_of_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_profile_id uuid;
  in_app_preference text;
begin
  if new.sender_role not in ('admissions_office', 'admissions_head') then
    return new;
  end if;

  select t.student_id into student_profile_id
  from public.support_threads t where t.id = new.thread_id;

  select p.notification_preferences ->> 'inAppEnabled' into in_app_preference
  from public.profiles p where p.user_id = student_profile_id;

  if in_app_preference is distinct from 'false' then
    insert into public.notifications (profile_id, title, body, channel, status, source_key)
    values (
      student_profile_id,
      'Admissions Office replied',
      'A reply is waiting in your Support inbox.',
      'In-app',
      'Unread',
      'support-reply-' || new.thread_id::text || '-' || new.id::text
    )
    on conflict (profile_id, source_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_student_of_support_reply on public.support_messages;
create trigger notify_student_of_support_reply
after insert on public.support_messages
for each row execute function public.notify_student_of_support_reply();

create or replace function public.get_or_create_support_thread()
returns public.support_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.support_threads;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'student' then
    raise exception 'Only a signed-in student can start a support thread.';
  end if;

  insert into public.support_threads (student_id)
  values (auth.uid())
  on conflict (student_id) do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.support_threads where student_id = auth.uid();
  end if;
  return result;
end;
$$;

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
  elsif caller_role in ('admissions_office', 'admissions_head') then
    update public.support_threads
    set office_last_read_at = now(), office_unread_count = 0
    where id = p_thread_id and public.is_admissions_office();
  else
    raise exception 'This account cannot access the support inbox.';
  end if;
end;
$$;

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
  update public.support_threads set status = p_status, updated_at = now() where id = p_thread_id;
end;
$$;

revoke all on function public.get_or_create_support_thread() from public;
revoke all on function public.mark_support_thread_read(uuid) from public;
revoke all on function public.set_support_thread_status(uuid, text) from public;
revoke all on function public.stamp_support_message_identity() from public;
revoke all on function public.update_support_thread_after_message() from public;
revoke all on function public.notify_student_of_support_reply() from public;
grant execute on function public.get_or_create_support_thread() to authenticated;
grant execute on function public.mark_support_thread_read(uuid) to authenticated;
grant execute on function public.set_support_thread_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';