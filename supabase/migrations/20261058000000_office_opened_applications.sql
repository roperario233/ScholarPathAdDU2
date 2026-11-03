-- Office-opened applications: an eligibility exception the Admissions Office
-- Admin records for one student and one scholarship.
--
-- The Smart Eligibility Checker blocks applicants the office still needs to let
-- through (a QPI of 3 against a floor of 4, for example). Instead of a general
-- override, the Admin opens the Draft for the student with a recorded reason, and
-- the student completes, certifies, and submits it as usual.
--
--   1. applications.opened_by_office_at marks the Draft. It is a marker only: the
--      student reads their own row with select *, so it carries no name and no
--      reason. The client waives the qualification rules (floors, ceilings,
--      degree and track rules) for a marked application only; the profile,
--      deadline, document, and financial gates are unchanged.
--   2. open_application_for_student() is the only way to set it. It is Admin-only,
--      writes the reason into the staff-only application_review_comments thread
--      (prefixed "Eligibility exception — ", like a rejection reason), and leaves
--      the student a generic in-app notification without the reason.
--   3. protect_application_office_marker stops a student session from setting or
--      changing the marker, so a student cannot waive their own gate.
--
-- enforce_student_application_update is untouched: it never checked the floors,
-- and it returns early for a non-student caller, so the RPC's insert passes it.
-- The profile-completeness check runs again when the student submits.

alter table public.applications add column if not exists opened_by_office_at timestamptz;

create or replace function public.protect_application_office_marker()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.opened_by_office_at := null;
  elsif new.opened_by_office_at is distinct from old.opened_by_office_at then
    raise exception 'Only the Admissions Office can open an application as an eligibility exception.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_application_office_marker on public.applications;
create trigger protect_application_office_marker
before insert or update on public.applications
for each row execute function public.protect_application_office_marker();

create or replace function public.open_application_for_student(
  p_application_id uuid,
  p_student_id uuid,
  p_scholarship_id uuid,
  p_reason text
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_body text;
  v_student public.profiles;
  v_scholarship public.scholarships;
  v_row public.applications;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_actor is null or not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can open an application for a student.'
      using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'The application id is missing.';
  end if;

  v_body := 'Eligibility exception — ' || v_reason;
  if v_reason = '' then
    raise exception 'Record the reason for opening this application.';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep the reason to % characters or fewer.', 2000 - char_length('Eligibility exception — ');
  end if;

  select * into v_student from public.profiles where user_id = p_student_id;
  if not found or v_student.role is distinct from 'student' or v_student.deactivated_at is not null then
    raise exception 'Choose an active student account.';
  end if;

  select * into v_scholarship from public.scholarships where id = p_scholarship_id;
  if not found or not public.is_addu_in_scope_track(v_scholarship.title) then
    raise exception 'Choose an AdDU internal scholarship (GIA, Jubilee, or the Working Scholar Program).';
  end if;
  if not v_scholarship.is_active
    or (v_scholarship.deadline is not null and v_scholarship.deadline < v_today) then
    raise exception 'This scholarship is no longer accepting applications.';
  end if;

  if exists (
    select 1 from public.applications
    where student_id = p_student_id and scholarship_id = p_scholarship_id
  ) then
    raise exception 'This student already has an application for this scholarship.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Admissions Office Admin') into v_actor_name
  from public.profiles where user_id = v_actor;

  insert into public.applications (
    id, student_id, scholarship_id, status, document_status, notes, statement,
    opened_by_office_at, timeline, updated_at
  ) values (
    p_application_id,
    p_student_id,
    p_scholarship_id,
    'Draft',
    'Pending',
    'Opened by the Admissions Office.',
    coalesce(v_student.profile_details ->> 'essay', ''),
    now(),
    jsonb_build_array(jsonb_build_object(
      'id', 'ev-' || gen_random_uuid()::text,
      'stage', 'Draft',
      'note', 'Opened by the Admissions Office. Attach the required documents, then review and submit.',
      'actor', 'Admissions Office',
      'at', to_char(v_today, 'YYYY-MM-DD')
    )),
    now()
  )
  returning * into v_row;

  insert into public.application_review_comments (application_id, author_id, author_role, author_name, body)
  values (p_application_id, v_actor, 'admissions_admin', v_actor_name, v_body);

  if (v_student.notification_preferences ->> 'inAppEnabled') is distinct from 'false' then
    insert into public.notifications (profile_id, title, body, channel, status, source_key)
    values (
      p_student_id,
      'An application was opened for you',
      'The Admissions Office opened your ' || v_scholarship.title
        || ' application. Attach the required documents, then review and submit.',
      'In-app',
      'Unread',
      'application-opened-' || p_application_id::text
    )
    on conflict (profile_id, source_key) do nothing;
  end if;

  return v_row;
end;
$$;

revoke all on function public.open_application_for_student(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.open_application_for_student(uuid, uuid, uuid, text) to authenticated;
