-- Case officers on an Admissions Office application.
--
-- The office works one application at a time, but not one officer at a time: a
-- case is prepared by whoever picks it up, and a second officer who opens it
-- joins the same case instead of taking it over. `application_case_officers` is
-- that roster.
--
-- Why a table and not a column on `applications`: `applications` is loaded with
-- `select('*')` for every role and spread into client state
-- (src/lib/supabaseData.js, toApplication), so an `assigned_to` column would ride
-- into the student's own browser payload. The student must never learn which
-- officer holds their case, so the roster lives in a staff-only table with no
-- student policy; the student's application row and notifications are unchanged.
--
-- Members are soft-removed (`left_at`), like application_interview_panelists, so
-- the roster keeps its history and one officer can join a case again later.
--
-- Membership is only ever self-selected: an Admissions Office account joins by
-- opening the case, and leaves with a recorded reason. There is no manual
-- add/remove action, so the roster always reflects who actually worked the case.
--
-- Mirrors the client helpers in src/lib/admissionsOffice.js (getCaseOfficers,
-- getMyReviewQueue, getIntakePool) and src/App.jsx (joinCaseReview /
-- leaveCaseReview).

create table if not exists public.application_case_officers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  officer_id uuid references public.profiles(user_id) on delete set null,
  -- Snapshots, like applications.interview.locationLabel: a departed account
  -- still reads correctly and the roster needs no join to profiles.
  officer_name text not null,
  officer_role text not null check (officer_role in ('admissions_office', 'admissions_head')),
  joined_at timestamptz not null default now(),
  added_by uuid references public.profiles(user_id) on delete set null,
  left_at timestamptz,
  left_reason text
);

-- One active row per officer per application, and many officers per application.
create unique index if not exists application_case_officers_active_unique
  on public.application_case_officers (application_id, officer_id)
  where left_at is null;

-- "My review queue" reads the active roster for one officer.
create index if not exists application_case_officers_officer_idx
  on public.application_case_officers (officer_id)
  where left_at is null;

create index if not exists application_case_officers_application_idx
  on public.application_case_officers (application_id);

alter table public.application_case_officers enable row level security;

drop policy if exists "staff_application_case_officers_read" on public.application_case_officers;

-- Both Admissions Office lanes read every roster; the student and the
-- Department Chair have no policy here.
create policy "staff_application_case_officers_read" on public.application_case_officers
for select using (public.is_admissions_office());

-- Deliberate: no insert/update/delete policies. The two RPCs below are the only
-- writers, so membership cannot be forged from the browser.
revoke insert, update, delete on public.application_case_officers from public, anon, authenticated;


-- Joining a case. Called when an Admissions Office account opens an application
-- and when the intake pool picks one up, so it must be idempotent: a repeat open
-- (or a retried call) never duplicates the roster row.
--
-- The one status move a join can make is the start of the review
-- (Submitted -> Under Review). The timeline note stays anonymous because
-- applications.timeline is readable by the student: it never names the officer.
-- The append-only application_status_log records the actor separately, and the
-- existing notify-application-status trigger tells the student the review began.
create or replace function public.join_application_review(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_role text := public.current_profile_role();
  v_name text;
  v_actor text;
  v_note text;
begin
  if not public.is_admissions_office() then
    raise exception 'Only the Admissions Office can join an application review.';
  end if;

  -- The row lock serializes two officers opening the same newly submitted case:
  -- one performs the status move, the other only joins the roster.
  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'The application could not be found.';
  end if;

  if v_application.status not in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview') then
    raise exception 'An application at % does not take case officers.', v_application.status;
  end if;

  if not exists (
    select 1
    from public.application_case_officers
    where application_id = p_application_id
      and officer_id = auth.uid()
      and left_at is null
  ) then
    select coalesce(nullif(btrim(full_name), ''), 'Admissions Office reviewer')
      into v_name
      from public.profiles
      where user_id = auth.uid();

    insert into public.application_case_officers (application_id, officer_id, officer_name, officer_role, added_by)
    values (
      p_application_id,
      auth.uid(),
      coalesce(v_name, 'Admissions Office reviewer'),
      coalesce(v_role, 'admissions_office'),
      auth.uid()
    );
  end if;

  if v_application.status = 'Submitted' then
    v_actor := case v_role when 'admissions_head' then 'Admissions Office Head' else 'Admissions Office Staff' end;
    v_note := case v_role
      when 'admissions_head' then 'The Admissions Office Head opened this application for review. Attached documents are reviewed at the verification stage.'
      else 'The Admissions Office Staff opened this application for review. Attached documents are reviewed at the verification stage.'
    end;

    update public.applications
    set status = 'Under Review',
        updated_at = now(),
        timeline = coalesce(timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', 'ev-' || gen_random_uuid()::text,
          'stage', 'Under Review',
          'note', v_note,
          'actor', v_actor,
          'at', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD')
        ))
    where id = p_application_id
    returning * into v_application;
  end if;

  return v_application;
end;
$$;

revoke all on function public.join_application_review(uuid) from public, anon;
grant execute on function public.join_application_review(uuid) to authenticated;

-- Leaving a case. Self-service only: the officer records why, and the case keeps
-- its status (Under Review -> Submitted is a reverse transition the SOP map does
-- not allow). If the last officer leaves, the application returns to the intake
-- pool's unclaimed view.
create or replace function public.leave_application_review(p_application_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admissions_office() then
    raise exception 'Only the Admissions Office can leave an application review.';
  end if;

  if v_reason = '' then
    raise exception 'A reason is required before leaving an application review.';
  end if;

  update public.application_case_officers
  set left_at = now(),
      left_reason = v_reason
  where application_id = p_application_id
    and officer_id = auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not a case officer on this application.';
  end if;
end;
$$;

revoke all on function public.leave_application_review(uuid, text) from public, anon;
grant execute on function public.leave_application_review(uuid, text) to authenticated;
