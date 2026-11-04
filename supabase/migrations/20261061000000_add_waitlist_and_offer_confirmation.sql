-- Waitlisted and Not accepted outcomes, with offer confirmation.
--
-- The office does not want a student to read the word "reject", and accepted
-- applicants often decline for a better offer. Results therefore have three
-- outcomes and reach the students in two waves:
--
--   1. The school's approving level decides each recommendation: Approved,
--      Waitlisted, or Not accepted (stored `Rejected`, displayed "Not accepted").
--   2. The Admissions Office Admin orders the waitlist (application_waitlist_ranks)
--      and releases the accepted and waitlisted applicants together
--      (record_results_release, results_releases.kind = 'offers'). Each accepted
--      applicant receives an offer (scholarship_offers) with a confirm-by date.
--   3. Each accepted applicant confirms or declines in ScholarPath
--      (respond_to_scholarship_offer); the Admin can record a response given
--      outside the app. A waitlisted applicant can withdraw
--      (withdraw_from_waitlist). When an accepted applicant declines, the Admin
--      offers the slot to the next waitlisted applicant ("Offer to next": the
--      Admin's ordinary Waitlisted -> Released status write).
--   4. Once every offer is answered the Admin closes the round
--      (close_results_round, kind = 'closing'): the applicants still waitlisted
--      become Not accepted, and every Not accepted applicant receives the general
--      letter together. Until then a student never sees "Not accepted".
--
-- Release rows recorded before this migration are `legacy` and behave like a
-- closing for the student-side hold. The student's decline is the one write a
-- student makes to a submitted application, so it runs only inside the RPCs,
-- which set a transaction-local flag that the student update trigger honours.
--
-- Apply with the client build and redeploy notify-application-status,
-- notify-interview-update, and manage-interview-event (all --no-verify-jwt).

-- ---------------------------------------------------------------------------
-- Statuses
-- ---------------------------------------------------------------------------

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released', 'Declined', 'Rejected'));

-- ---------------------------------------------------------------------------
-- Release kinds
-- ---------------------------------------------------------------------------

alter table public.results_releases
  add column if not exists kind text not null default 'legacy';
alter table public.results_releases drop constraint if exists results_releases_kind_check;
alter table public.results_releases add constraint results_releases_kind_check
  check (kind in ('offers', 'closing', 'legacy'));

-- ---------------------------------------------------------------------------
-- Offers: one per accepted application, the response ledger
-- ---------------------------------------------------------------------------

create table if not exists public.scholarship_offers (
  application_id uuid primary key references public.applications(id) on delete cascade,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  offered_at timestamptz not null default now(),
  confirm_by date,
  origin text not null default 'release' check (origin in ('release', 'promotion')),
  response text not null default 'pending' check (response in ('pending', 'confirmed', 'declined')),
  responded_at timestamptz,
  responded_by uuid references public.profiles(user_id) on delete set null,
  responded_by_role text,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500)
);
create index if not exists scholarship_offers_scholarship_idx
  on public.scholarship_offers (scholarship_id, response);
create index if not exists scholarship_offers_student_idx
  on public.scholarship_offers (student_id);

alter table public.scholarship_offers enable row level security;

drop policy if exists "scholarship_offers_student_read" on public.scholarship_offers;
create policy "scholarship_offers_student_read" on public.scholarship_offers
for select using (student_id = auth.uid());

drop policy if exists "scholarship_offers_office_read" on public.scholarship_offers;
create policy "scholarship_offers_office_read" on public.scholarship_offers
for select using (public.is_admissions_office());

drop policy if exists "scholarship_offers_reviewer_read" on public.scholarship_offers;
create policy "scholarship_offers_reviewer_read" on public.scholarship_offers
for select using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair')
  and public.reviewer_scopes_to_student(student_id)
);
-- No write policy: the trigger and the RPCs below write as definer.

-- The offer is created when the application becomes Released, by the release
-- or by a promotion from the waitlist. The confirm-by date rides the release
-- payload the Admin's browser writes (applications.release.confirmBy).
create or replace function public.create_scholarship_offer_on_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirm_by date;
begin
  if new.status = 'Released' and old.status is distinct from 'Released' then
    if coalesce(new.release ->> 'confirmBy', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_confirm_by := (new.release ->> 'confirmBy')::date;
    end if;
    insert into public.scholarship_offers (application_id, scholarship_id, student_id, confirm_by, origin)
    values (
      new.id,
      new.scholarship_id,
      new.student_id,
      v_confirm_by,
      case when old.status = 'Waitlisted' then 'promotion' else 'release' end
    )
    on conflict (application_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists create_scholarship_offer_on_release on public.applications;
create trigger create_scholarship_offer_on_release
  after update on public.applications
  for each row execute function public.create_scholarship_offer_on_release();

revoke all on function public.create_scholarship_offer_on_release() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Waitlist order (staff-only; a student never sees a position)
-- ---------------------------------------------------------------------------

create table if not exists public.application_waitlist_ranks (
  application_id uuid primary key references public.applications(id) on delete cascade,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  rank integer not null check (rank >= 1),
  set_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists application_waitlist_ranks_scholarship_idx
  on public.application_waitlist_ranks (scholarship_id, rank);

alter table public.application_waitlist_ranks enable row level security;

drop policy if exists "waitlist_ranks_office_read" on public.application_waitlist_ranks;
create policy "waitlist_ranks_office_read" on public.application_waitlist_ranks
for select using (public.is_admissions_office());

create or replace function public.set_waitlist_order(p_scholarship_id uuid, p_application_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := coalesce(array_length(p_application_ids, 1), 0);
begin
  if not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can order the waitlist.' using errcode = '42501';
  end if;
  if v_count <> (select count(distinct t.app_id) from unnest(coalesce(p_application_ids, '{}')) as t(app_id)) then
    raise exception 'An application can appear only once on the waitlist.' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_application_ids, '{}')) as t(app_id)
    where not exists (
      select 1 from public.applications a
      where a.id = t.app_id and a.scholarship_id = p_scholarship_id and a.status = 'Waitlisted'
    )
  ) then
    raise exception 'Only waitlisted applications of this scholarship can be ordered.' using errcode = '23514';
  end if;

  delete from public.application_waitlist_ranks where scholarship_id = p_scholarship_id;
  insert into public.application_waitlist_ranks (application_id, scholarship_id, rank, set_by)
  select t.app_id, p_scholarship_id, t.ord::integer, auth.uid()
  from unnest(coalesce(p_application_ids, '{}')) with ordinality as t(app_id, ord);
  return v_count;
end;
$$;

revoke all on function public.set_waitlist_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_waitlist_order(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The student's one write to a submitted application
-- ---------------------------------------------------------------------------

-- enforce_student_application_update freezes a submitted row for a student.
-- The offer RPCs below set this transaction-local flag around their own update,
-- so the student's decline (Released/Waitlisted -> Declined) passes, and no
-- other client write can: PostgREST exposes no way to set it.
drop trigger if exists enforce_student_application_update on public.applications;
create trigger enforce_student_application_update
  before insert or update on public.applications
  for each row
  when (coalesce(current_setting('scholarpath.offer_response', true), '') <> 'on')
  execute function public.enforce_student_application_update();

create or replace function public.append_application_timeline(p_timeline jsonb, p_stage text, p_note text, p_actor text)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select coalesce(p_timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'id', 'ev-' || gen_random_uuid()::text,
    'stage', p_stage,
    'note', p_note,
    'actor', p_actor,
    'at', to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
  ));
$$;

revoke all on function public.append_application_timeline(jsonb, text, text, text) from public, anon, authenticated;

-- A round is closed once a closing (or legacy) release of the scholarship was
-- recorded after the offer.
create or replace function public.is_results_round_closed(p_scholarship_id uuid, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.results_releases r
    where r.scholarship_id = p_scholarship_id
      and r.kind in ('closing', 'legacy')
      and r.released_at >= p_since
  );
$$;

revoke all on function public.is_results_round_closed(uuid, timestamptz) from public, anon;
grant execute on function public.is_results_round_closed(uuid, timestamptz) to authenticated;

create or replace function public.respond_to_scholarship_offer(p_application_id uuid, p_response text, p_reason text default null)
returns public.scholarship_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_is_admin boolean := public.is_admissions_admin();
  v_application public.applications;
  v_offer public.scholarship_offers;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor_label text;
begin
  if p_response not in ('confirmed', 'declined') then
    raise exception 'Choose to confirm or decline the offer.' using errcode = '22023';
  end if;
  select * into v_application from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'The application was not found.';
  end if;
  if not v_is_admin and (v_actor is null or v_application.student_id <> v_actor) then
    raise exception 'Only the applicant or the Admissions Office Admin can answer this offer.' using errcode = '42501';
  end if;
  select * into v_offer from public.scholarship_offers where application_id = p_application_id for update;
  if not found or v_application.status not in ('Released', 'Declined') then
    raise exception 'There is no open offer on this application.' using errcode = '23514';
  end if;
  if v_offer.response = 'declined' then
    raise exception 'This offer was already declined.' using errcode = '23514';
  end if;
  if not v_is_admin and public.is_results_round_closed(v_application.scholarship_id, v_offer.offered_at) then
    raise exception 'The results for this scholarship are closed. Contact the Admissions Office to change your response.' using errcode = '23514';
  end if;
  if p_response = 'declined' and v_reason is null and not v_is_admin then
    raise exception 'Tell the Admissions Office why you are declining.' using errcode = '23514';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer.' using errcode = '23514';
  end if;

  if p_response = 'confirmed' then
    if v_offer.response = 'confirmed' then
      return v_offer;
    end if;
    update public.scholarship_offers
      set response = 'confirmed', responded_at = now(), responded_by = v_actor, responded_by_role = v_role
      where application_id = p_application_id
      returning * into v_offer;
    return v_offer;
  end if;

  update public.scholarship_offers
    set response = 'declined', responded_at = now(), responded_by = v_actor, responded_by_role = v_role,
        decline_reason = v_reason
    where application_id = p_application_id
    returning * into v_offer;

  v_actor_label := case when v_is_admin then 'Admissions Office Admin' else 'Student' end;
  perform set_config('scholarpath.offer_response', 'on', true);
  update public.applications
    set status = 'Declined',
        updated_at = now(),
        timeline = public.append_application_timeline(
          timeline, 'Declined',
          case when v_is_admin then 'Offer declined (recorded by the Admissions Office).' else 'Offer declined by the applicant.' end
            || coalesce(' Reason: ' || v_reason, ''),
          v_actor_label)
    where id = p_application_id;
  perform set_config('scholarpath.offer_response', 'off', true);
  return v_offer;
end;
$$;

revoke all on function public.respond_to_scholarship_offer(uuid, text, text) from public, anon;
grant execute on function public.respond_to_scholarship_offer(uuid, text, text) to authenticated;

create or replace function public.withdraw_from_waitlist(p_application_id uuid, p_reason text default null)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_is_admin boolean := public.is_admissions_admin();
  v_application public.applications;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_application from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'The application was not found.';
  end if;
  if not v_is_admin and (v_actor is null or v_application.student_id <> v_actor) then
    raise exception 'Only the applicant or the Admissions Office Admin can withdraw from the waitlist.' using errcode = '42501';
  end if;
  if v_application.status <> 'Waitlisted' then
    raise exception 'This application is not on the waitlist.' using errcode = '23514';
  end if;
  -- A student only learns of the waitlist once the offers are released.
  if not v_is_admin and not exists (
    select 1 from public.results_releases r
    where r.scholarship_id = v_application.scholarship_id
      and r.kind = 'offers'
      and p_application_id = any (r.application_ids)
  ) then
    raise exception 'The results for this scholarship have not been released yet.' using errcode = '23514';
  end if;
  if v_reason is null and not v_is_admin then
    raise exception 'Tell the Admissions Office why you are leaving the waitlist.' using errcode = '23514';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer.' using errcode = '23514';
  end if;

  perform set_config('scholarpath.offer_response', 'on', true);
  update public.applications
    set status = 'Declined',
        updated_at = now(),
        timeline = public.append_application_timeline(
          timeline, 'Declined',
          case when v_is_admin then 'Withdrawal from the waitlist recorded by the Admissions Office.' else 'Withdrew from the waitlist.' end
            || coalesce(' Reason: ' || v_reason, ''),
          case when v_is_admin then 'Admissions Office Admin' else 'Student' end)
    where id = p_application_id
    returning * into v_application;
  perform set_config('scholarpath.offer_response', 'off', true);
  delete from public.application_waitlist_ranks where application_id = p_application_id;
  return v_application;
end;
$$;

revoke all on function public.withdraw_from_waitlist(uuid, text) from public, anon;
grant execute on function public.withdraw_from_waitlist(uuid, text) to authenticated;

-- A student's decline or withdrawal frees a slot, so both Admin lanes hear about
-- it in-app (generic copy, no reason, no student text), like a support escalation.
create or replace function public.notify_office_of_declined_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.status = 'Declined' and old.status is distinct from 'Declined'
    and public.current_profile_role() = 'student' then
    select title into v_title from public.scholarships where id = new.scholarship_id;
    insert into public.notifications (profile_id, title, body, channel, status, source_key)
    select p.user_id,
      case when old.status = 'Waitlisted' then 'A waitlisted applicant withdrew' else 'An offer was declined' end,
      'An applicant for ' || coalesce(v_title, 'a scholarship')
        || case when old.status = 'Waitlisted'
             then ' left the waitlist. Review the waitlist on Final check and release.'
             else ' declined the award. Offer the slot to the next waitlisted applicant on Final check and release.' end,
      'In-app',
      'Unread',
      'result-declined-' || new.id::text
    from public.profiles p
    where p.role = 'admissions_admin'
      and p.deactivated_at is null
      and (p.notification_preferences ->> 'inAppEnabled') is distinct from 'false'
    on conflict (profile_id, source_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_office_of_declined_result on public.applications;
create trigger notify_office_of_declined_result
  after update on public.applications
  for each row execute function public.notify_office_of_declined_result();

revoke all on function public.notify_office_of_declined_result() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stage authority (mirrors getNextApplicationStatuses in src/lib/constants.js)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_admissions_office_lane_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_profile_role();
  v_allowed boolean := false;
begin
  -- Students (enforce_student_application_update and the offer RPCs) and
  -- service-role jobs are governed elsewhere.
  if caller_role is null or caller_role = 'student' then
    return new;
  end if;

  -- A scoped reviewer writes the interview and deliberation stage payloads only;
  -- the submitted record, the office's endorsement and release records stay as
  -- they were.
  if caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if new.student_id is distinct from old.student_id
      or new.scholarship_id is distinct from old.scholarship_id
      or new.statement is distinct from old.statement
      or new.profile_snapshot is distinct from old.profile_snapshot
      or new.certified_at is distinct from old.certified_at
      or new.submitted_at is distinct from old.submitted_at
      or new.endorsement is distinct from old.endorsement
      or new.release is distinct from old.release then
      raise exception 'A reviewer can only record the interview and the recommendation on an application.'
        using errcode = '42501';
    end if;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if caller_role = 'admissions_admin' then
    v_allowed := (old.status = 'Submitted' and new.status in ('Under Review', 'For Verification', 'Rejected'))
      or (old.status = 'Under Review' and new.status in ('For Verification', 'Rejected'))
      or (old.status = 'For Verification' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'For Endorsement' and new.status in ('Endorsed', 'Rejected'))
      or (old.status = 'Endorsed' and new.status in ('Interview', 'Rejected'))
      or (old.status = 'Interview' and new.status in ('Recommended', 'Rejected'))
      or (old.status = 'Recommended' and new.status in ('Approved', 'Waitlisted', 'Rejected'))
      or (old.status = 'Approved' and new.status in ('Released', 'Rejected'))
      -- The waitlist: a promotion only once the offers were released, so the
      -- waitlisted applicant already knows they were waitlisted.
      or (old.status = 'Waitlisted' and new.status in ('Rejected', 'Declined'))
      or (
        old.status = 'Waitlisted' and new.status = 'Released'
        and exists (
          select 1 from public.results_releases r
          where r.scholarship_id = new.scholarship_id and r.kind = 'offers' and new.id = any (r.application_ids)
        )
      )
      or (old.status = 'Released' and new.status = 'Declined');
  elsif caller_role in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    if public.reviewer_scopes_to_student(new.student_id) then
      v_allowed := (old.status = 'Endorsed' and new.status = 'Interview')
        or (
          old.status = 'Interview' and new.status = 'Recommended'
          and public.is_interview_panelist(new.id)
        )
        or (
          caller_role <> 'interviewer'
          and old.status = 'Recommended' and new.status in ('Approved', 'Waitlisted', 'Rejected')
          and caller_role = public.approver_role_for_student(new.student_id)
        );
    end if;
  end if;

  if not v_allowed then
    raise exception 'Your role cannot move this application from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_admissions_office_lane_transitions() from public;
revoke all on function public.enforce_admissions_office_lane_transitions() from anon, authenticated;

drop policy if exists "admissions_admin_applications_update" on public.applications;
create policy "admissions_admin_applications_update" on public.applications
for update using (
  public.is_admissions_admin()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted')
) with check (
  public.is_admissions_admin()
  and status in ('Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released', 'Declined', 'Rejected')
);

drop policy if exists "reviewer_applications_update" on public.applications;
create policy "reviewer_applications_update" on public.applications
for update using (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended')
) with check (
  public.current_profile_role() in ('dean', 'assistant_dean', 'department_chair', 'interviewer')
  and public.reviewer_scopes_to_student(student_id)
  and status in ('Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Rejected')
);

-- A waitlisted case has been through verification like an approved one.
create or replace function public.enforce_document_verification_before_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding integer;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released') then
    return new;
  end if;

  select count(*)
    into v_outstanding
    from public.application_documents ad
    join public.documents d on d.id = ad.document_id
    where ad.application_id = new.id
      and d.verification_status <> 'Verified';

  if v_outstanding > 0 then
    raise exception 'All attached documents must be verified before this application can be endorsed or advance to a later stage. % document(s) still need verification.', v_outstanding
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_verified_documents_on_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.verification_status = 'Verified' and new.verification_status is distinct from 'Verified' then
    if exists (
      select 1
      from public.application_documents ad
      join public.applications a on a.id = ad.application_id
      where ad.document_id = new.id
        and a.status in ('For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released')
    ) then
      raise exception 'This document is verified and an application that relies on it has already advanced. Revert that application before changing its verification status.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Releases
-- ---------------------------------------------------------------------------

-- The first wave: the accepted (Released) and waitlisted applicants. The Admin's
-- browser moves each Approved case to Released first (with its confirm-by date),
-- so an Approved case left over refuses the release. Not accepted cases are
-- covered only by close_results_round.
create or replace function public.record_results_release(p_scholarship_id uuid)
returns public.results_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_covered uuid[];
  v_applicants integer;
  v_accepted integer;
  v_row public.results_releases;
begin
  if not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can release results.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.applications
    where scholarship_id = p_scholarship_id and status = 'Approved'
  ) then
    raise exception 'Release every approved application of this scholarship before recording the results.'
      using errcode = '23514';
  end if;

  select coalesce(array_agg(a.id), '{}')
    into v_covered
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status in ('Released', 'Waitlisted')
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id and a.id = any (r.application_ids)
      );
  if coalesce(array_length(v_covered, 1), 0) = 0 then
    raise exception 'There are no accepted or waitlisted applications to release for this scholarship. Close the results to send the Not accepted letters.'
      using errcode = '23514';
  end if;

  select count(*)
    into v_applicants
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status <> 'Draft'
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id and a.id = any (r.application_ids)
      );
  select count(*) into v_accepted
    from public.applications a
    where a.id = any (v_covered) and a.status = 'Released';

  insert into public.results_releases (scholarship_id, applicant_count, accepted_count, application_ids, kind)
  values (p_scholarship_id, v_applicants, v_accepted, v_covered, 'offers')
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_results_release(uuid) from public, anon;
grant execute on function public.record_results_release(uuid) to authenticated;

-- The second wave. Every offer must be answered (the Admin marks a lapsed one
-- Declined first); the applicants still waitlisted become Not accepted, and the
-- closing release covers every Not accepted case not yet told, so its insert
-- trigger sends them the general letter together. The counts are this round's:
-- the applicants the offers and this closing cover, and those who kept the award.
create or replace function public.close_results_round(p_scholarship_id uuid)
returns public.results_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_covered uuid[];
  v_round uuid[];
  v_applicants integer;
  v_accepted integer;
  v_row public.results_releases;
begin
  if not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can close the results.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.applications
    where scholarship_id = p_scholarship_id and status = 'Approved'
  ) then
    raise exception 'Release the approved applications of this scholarship before closing the results.'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.scholarship_offers o
    join public.applications a on a.id = o.application_id
    where o.scholarship_id = p_scholarship_id and o.response = 'pending' and a.status = 'Released'
  ) then
    raise exception 'Every accepted applicant must confirm or decline before the results are closed. Record a response for each unanswered offer first.'
      using errcode = '23514';
  end if;

  update public.applications
    set status = 'Rejected',
        updated_at = now(),
        timeline = public.append_application_timeline(timeline, 'Rejected', 'Application not accepted.', 'Admissions Office Admin')
    where scholarship_id = p_scholarship_id and status = 'Waitlisted';
  delete from public.application_waitlist_ranks where scholarship_id = p_scholarship_id;

  select coalesce(max(r.released_at), '-infinity'::timestamptz)
    into v_since
    from public.results_releases r
    where r.scholarship_id = p_scholarship_id and r.kind in ('closing', 'legacy');

  select coalesce(array_agg(a.id), '{}')
    into v_covered
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status = 'Rejected'
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id
          and r.kind in ('closing', 'legacy')
          and a.id = any (r.application_ids)
      );

  select coalesce(array_agg(distinct id), '{}')
    into v_round
    from (
      select unnest(r.application_ids) as id
      from public.results_releases r
      where r.scholarship_id = p_scholarship_id and r.kind = 'offers' and r.released_at > v_since
      union
      select unnest(v_covered)
    ) ids;
  v_applicants := coalesce(array_length(v_round, 1), 0);
  select count(*) into v_accepted
    from public.applications a
    where a.id = any (v_round) and a.status = 'Released';

  insert into public.results_releases (scholarship_id, applicant_count, accepted_count, application_ids, kind)
  values (p_scholarship_id, v_applicants, v_accepted, v_covered, 'closing')
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.close_results_round(uuid) from public, anon;
grant execute on function public.close_results_round(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grant amount
-- ---------------------------------------------------------------------------

-- The Admin records the figure of a waitlisted case before offering it the
-- slot; a student reads a figure only for their own accepted offer (never while
-- waitlisted), or for a result released before the waitlist existed.
drop policy if exists "grant_amounts_student_released_read" on public.application_grant_amounts;
create policy "grant_amounts_student_released_read" on public.application_grant_amounts
for select using (
  exists (
    select 1 from public.applications a
    where a.id = application_grant_amounts.application_id
      and a.student_id = auth.uid()
      and (
        exists (select 1 from public.scholarship_offers o where o.application_id = a.id)
        or (
          a.status = 'Released'
          and exists (
            select 1 from public.results_releases r
            where application_grant_amounts.application_id = any (r.application_ids)
          )
        )
      )
  )
);

create or replace function public.set_application_grant_amount(
  p_application_id uuid,
  p_coverage_percent numeric,
  p_amount numeric,
  p_note text
)
returns public.application_grant_amounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_is_admin boolean := public.is_admissions_admin();
  v_application public.applications;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.application_grant_amounts;
begin
  if v_actor is null
     or not (v_is_admin or v_role in ('dean', 'assistant_dean', 'department_chair')) then
    raise exception 'Only the approving level or the Admissions Office Admin can record a grant amount.'
      using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'The application id is missing.';
  end if;

  select * into v_application from public.applications where id = p_application_id;
  if not found then
    raise exception 'The application was not found.';
  end if;

  if not v_is_admin and (
       not public.reviewer_scopes_to_student(v_application.student_id)
       or v_role is distinct from public.approver_role_for_student(v_application.student_id)
     ) then
    raise exception 'Only the approving level for this applicant can record a grant amount.'
      using errcode = '42501';
  end if;

  if not (
    v_application.status in ('Recommended', 'Approved')
    or (v_is_admin and v_application.status = 'Waitlisted')
  ) then
    raise exception 'A grant amount can be recorded only while the application is Recommended or Approved, or by the Admin while it is Waitlisted.'
      using errcode = '42501';
  end if;

  if p_coverage_percent is null and p_amount is null then
    raise exception 'Enter a coverage percent, an amount per semester, or both.';
  end if;
  if p_coverage_percent is not null and (p_coverage_percent < 0 or p_coverage_percent > 100) then
    raise exception 'Coverage must be between 0 and 100 percent.';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'The amount per semester cannot be negative.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note can be at most 500 characters.';
  end if;

  insert into public.application_grant_amounts as g
    (application_id, coverage_percent, amount_per_semester, note, set_by, set_by_role, updated_at)
  values
    (p_application_id, p_coverage_percent, p_amount, v_note, v_actor, v_role, now())
  on conflict (application_id) do update
    set coverage_percent = excluded.coverage_percent,
        amount_per_semester = excluded.amount_per_semester,
        note = excluded.note,
        set_by = excluded.set_by,
        set_by_role = excluded.set_by_role,
        updated_at = excluded.updated_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_application_grant_amount(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.set_application_grant_amount(uuid, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
