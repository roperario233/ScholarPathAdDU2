-- Release every Approved case for one scholarship in a single transaction.
-- Application triggers still run per row (including audit, offers, and the
-- database notification path), but the browser no longer performs N sequential
-- writes and cannot leave a half-released first wave on a mid-loop failure.
create table if not exists public.application_results_release_requests (
  request_id uuid primary key,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  confirm_by date,
  release_id uuid not null references public.results_releases(id) on delete cascade,
  released_application_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.application_results_release_requests enable row level security;
revoke all on public.application_results_release_requests from public, anon, authenticated;

create or replace function public.release_scholarship_results(
  p_scholarship_id uuid,
  p_confirm_by date,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.application_results_release_requests%rowtype;
  v_release public.results_releases%rowtype;
  v_approved_count integer;
  v_released_ids uuid[] := '{}'::uuid[];
  v_application_rows jsonb := '[]'::jsonb;
begin
  if not public.is_admissions_admin() then
    raise exception 'Only the Admissions Office Admin can release results.' using errcode = '42501';
  end if;
  if p_scholarship_id is null or p_request_id is null then
    raise exception 'A scholarship and release request ID are required.' using errcode = '22023';
  end if;

  -- Serialize retries of the same request even when the first transaction has
  -- not inserted its request row yet.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing
  from public.application_results_release_requests
  where request_id = p_request_id
  for update;
  if found then
    if v_existing.scholarship_id <> p_scholarship_id
      or v_existing.confirm_by is distinct from p_confirm_by then
      raise exception 'The release request ID is already bound to different release details.' using errcode = '23505';
    end if;
    select * into v_release from public.results_releases where id = v_existing.release_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'updated_at', a.updated_at,
      'release', a.release,
      'timeline', a.timeline
    ) order by a.id), '[]'::jsonb)
      into v_application_rows
      from public.applications a
      where a.id = any(v_existing.released_application_ids);
    return jsonb_build_object(
      'release', to_jsonb(v_release),
      'releasedApplicationIds', to_jsonb(v_existing.released_application_ids),
      'applications', v_application_rows,
      'replayed', true
    );
  end if;

  perform 1 from public.scholarships where id = p_scholarship_id for update;
  if not found then
    raise exception 'The scholarship could not be found.' using errcode = '23503';
  end if;
  select count(*) into v_approved_count
  from public.applications a
  where a.scholarship_id = p_scholarship_id and a.status = 'Approved';
  if v_approved_count > 0 and (p_confirm_by is null or p_confirm_by < (now() at time zone 'Asia/Manila')::date) then
    raise exception 'Choose a confirm-by date that is today or later.' using errcode = '23514';
  end if;

  with updated as (
    update public.applications a
    set status = 'Released',
        release = jsonb_build_object(
          'releasedTo', 'Admissions Office',
          'releasedAt', (now() at time zone 'Asia/Manila')::date::text,
          'reference', 'OAA-' || upper(substr(a.id::text, 1, 8)),
          'confirmBy', p_confirm_by::text
        ),
        updated_at = now(),
        timeline = coalesce(a.timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', 'ev-' || gen_random_uuid()::text,
          'stage', 'Released',
          'note', 'Result released to the applicant through the Admissions Office (OAA-' || upper(substr(a.id::text, 1, 8)) || ').',
          'actor', 'Admissions Office Admin',
          'at', (now() at time zone 'Asia/Manila')::date::text
        ))
    where a.scholarship_id = p_scholarship_id and a.status = 'Approved'
    returning a.id
  )
  select coalesce(array_agg(updated.id), '{}'::uuid[])
    into v_released_ids
    from updated;
  if cardinality(v_released_ids) > 0
    and (p_confirm_by is null or p_confirm_by < (now() at time zone 'Asia/Manila')::date) then
    raise exception 'Choose a confirm-by date that is today or later.' using errcode = '23514';
  end if;

  -- This records the batch, adds the normalized coverage rows through its table
  -- trigger, and sends the consolidated Waitlisted notice.
  v_release := public.record_results_release(p_scholarship_id);
  insert into public.application_results_release_requests (
    request_id, scholarship_id, confirm_by, release_id, released_application_ids
  ) values (
    p_request_id, p_scholarship_id, p_confirm_by, v_release.id, v_released_ids
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'updated_at', a.updated_at,
    'release', a.release,
    'timeline', a.timeline
  ) order by a.id), '[]'::jsonb)
    into v_application_rows
    from public.applications a
    where a.id = any(v_released_ids);

  return jsonb_build_object(
    'release', to_jsonb(v_release),
    'releasedApplicationIds', to_jsonb(v_released_ids),
    'applications', v_application_rows,
    'replayed', false
  );
end;
$$;

revoke all on function public.release_scholarship_results(uuid, date, uuid) from public, anon;
grant execute on function public.release_scholarship_results(uuid, date, uuid) to authenticated;
