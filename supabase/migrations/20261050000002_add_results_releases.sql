-- Results are released per scholarship, in one batch (Consultation 2, #8 and #13).
--
-- Until the Admissions Office Head releases a scholarship's results, no outcome
-- reaches the student: notify-application-status holds the Approved and Rejected
-- notices, and the student's surfaces show "Under deliberation". Releasing:
--
--   1. moves the remaining Approved cases to Released (the normal status write,
--      which notifies each accepted applicant), then
--   2. calls record_results_release(), which records this release with the
--      number of applicants and the number accepted, and the exact applications
--      it covers, then
--   3. this table's insert trigger calls notify-application-status in its
--      `results-release` mode, which sends every covered, non-accepted applicant
--      the general letter: no reason, only the counts.
--
-- Students read these rows (the counts are what the letter states, and the
-- covered application ids are what unmask a Rejected status on their own
-- surfaces); only the Head inserts, through the function.
--
-- No placeholders to fill in: the notify trigger copies the function URL and the
-- REMINDER_CRON_SECRET from notify_application_status_change(), which
-- 20261014000003 installed with the real values, so the secret stays out of git.
-- Redeploy notify-application-status with verify_jwt disabled afterwards.

create table if not exists public.results_releases (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  released_at timestamptz not null default now(),
  released_by uuid references public.profiles(user_id) on delete set null default auth.uid(),
  applicant_count integer not null check (applicant_count >= 0),
  accepted_count integer not null check (accepted_count >= 0),
  application_ids uuid[] not null default '{}'
);
create index if not exists results_releases_scholarship_idx
  on public.results_releases (scholarship_id, released_at);

alter table public.results_releases enable row level security;

drop policy if exists "results_releases_read" on public.results_releases;
create policy "results_releases_read" on public.results_releases
for select to authenticated using (true);
-- No insert/update/delete policy: record_results_release() writes as definer.

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
  if not public.is_admissions_head() then
    raise exception 'Only the Admissions Office Head can release results.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.applications
    where scholarship_id = p_scholarship_id and status = 'Approved'
  ) then
    raise exception 'Release every approved application of this scholarship before recording the results.'
      using errcode = '23514';
  end if;

  -- Decided applications not covered by an earlier release.
  select coalesce(array_agg(a.id), '{}')
    into v_covered
    from public.applications a
    where a.scholarship_id = p_scholarship_id
      and a.status in ('Released', 'Rejected')
      and not exists (
        select 1 from public.results_releases r
        where r.scholarship_id = p_scholarship_id and a.id = any (r.application_ids)
      );
  if coalesce(array_length(v_covered, 1), 0) = 0 then
    raise exception 'There are no decided applications to release for this scholarship.'
      using errcode = '23514';
  end if;

  -- Applicants this cycle: every submitted application not covered before,
  -- including the ones still in progress.
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

  insert into public.results_releases (scholarship_id, applicant_count, accepted_count, application_ids)
  values (p_scholarship_id, v_applicants, v_accepted, v_covered)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_results_release(uuid) from public, anon;
grant execute on function public.record_results_release(uuid) to authenticated;

-- Applications decided before this migration were already notified one by one,
-- so they are recorded as released here. Inserted before the notify trigger
-- below exists, so no letter is sent for them.
insert into public.results_releases (scholarship_id, released_by, applicant_count, accepted_count, application_ids)
select
  a.scholarship_id,
  null,
  count(*) filter (where a.status <> 'Draft'),
  count(*) filter (where a.status = 'Released'),
  coalesce(array_agg(a.id) filter (where a.status in ('Released', 'Rejected')), '{}')
from public.applications a
where not exists (select 1 from public.results_releases r where r.scholarship_id = a.scholarship_id)
group by a.scholarship_id
having count(*) filter (where a.status in ('Released', 'Rejected')) > 0;

create extension if not exists pg_net;

-- The REMINDER_CRON_SECRET is not written here: it is copied from the
-- notify_application_status_change() trigger function that
-- 20261014000003_notify_application_status_from_database.sql installed with the
-- real value, so the secret never appears in this file or in git. The URL is
-- copied from the same function. Apply that migration (with its values) first.
do $migration$
declare
  v_source text;
  v_url text;
  v_secret text;
begin
  select p.prosrc
    into v_source
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_application_status_change';
  v_url := substring(v_source from 'url := ''([^'']*/functions/v1/)notify-application-status''');
  -- Accepts both 'Bearer <secret>' and 'Bearer ' || '<secret>'.
  v_secret := substring(v_source from 'Bearer (?:'' \|\| '')?([^'']+)''');
  if v_url is null or v_secret is null or v_url like '%<%' or v_secret like '<%' then
    raise exception 'notify_application_status_change() has no deployed URL and secret to copy. Apply 20261014000003 with its real values first.';
  end if;

  execute format($fn$
    create or replace function public.notify_results_release()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, net
    as $body$
    begin
      perform net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('mode', 'results-release', 'releaseId', new.id)
      );
      return new;
    end;
    $body$;
  $fn$, v_url || 'notify-application-status', 'Bearer ' || v_secret);
end;
$migration$;

revoke all on function public.notify_results_release() from public, anon, authenticated;

drop trigger if exists notify_results_release on public.results_releases;
create trigger notify_results_release
  after insert on public.results_releases
  for each row execute function public.notify_results_release();
