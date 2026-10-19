-- ---------------------------------------------------------------------------
-- Restrict student applications to the three in-scope AdDU internal tracks.
--
-- Appendix A scopes the study to the Jubilee Scholarship Fund, Grant-in-Aid
-- (GIA), and the Student Assistant (SA) Program. The `admissions_office` role
-- has `for all` access to applications, and a student can write their own rows,
-- so the rule cannot live in the UI alone: a student may only create a Draft or
-- submit an application whose scholarship title names one of the three tracks.
--
-- "In scope" is decided by the *title*, never by rule_family alone: other
-- internal catalog entries (for example a donor endowment stored as
-- `general-pool`, such as the "Antonio A. Villanueva Endowment Fund") share
-- those values without being one of the three tracks. This mirrors
-- isAdduInternalProgram() in src/lib/eligibility.js.
--
-- External and government-linked entries stay tracked-only and are unaffected:
-- a Draft row against them is still allowed (the student applies elsewhere).
-- ---------------------------------------------------------------------------
create or replace function public.is_addu_in_scope_track(p_title text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_title, ''))) ~ 'jubilee|grant[ -]?in[ -]?aid|(^|[^a-z])gia([^a-z]|$)|student assistant|working scholar';
$$;

create or replace function public.enforce_student_application_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_is_incoming boolean;
  v_item jsonb;
begin
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'Draft' then
      raise exception 'New applications start as drafts.' using errcode = '42501';
    end if;
    -- An internal catalog entry that is not one of the three in-scope tracks
    -- cannot even be started. External/government-linked entries are tracked
    -- only, so a Draft row there is allowed.
    select * into v_scholarship from public.scholarships where id = new.scholarship_id;
    if found
      and coalesce(v_scholarship.is_external, false) = false
      and coalesce(v_scholarship.rule_family, '') in ('general-pool', 'honors', 'work-study')
      and not public.is_addu_in_scope_track(v_scholarship.title) then
      raise exception 'Only the AdDU internal scholarship tracks are in scope: Grant-in-Aid (GIA), Jubilee, and the Student Assistant Program.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.student_id <> old.student_id or new.scholarship_id <> old.scholarship_id then
    raise exception 'An application cannot be moved to another student or scholarship.' using errcode = '42501';
  end if;
  if old.status <> 'Draft' then
    raise exception 'A submitted application can no longer be changed by the student.' using errcode = '42501';
  end if;
  if new.status = 'Draft' then
    return new;
  end if;
  if new.status <> 'Submitted' then
    raise exception 'Students can only submit a draft application.' using errcode = '42501';
  end if;

  select * into v_scholarship from public.scholarships where id = new.scholarship_id;
  if not found
    or v_scholarship.is_external
    or coalesce(v_scholarship.rule_family, '') not in ('general-pool', 'honors', 'work-study') then
    raise exception 'External programs are tracked only. Apply through the provider.' using errcode = '23514';
  end if;
  if not public.is_addu_in_scope_track(v_scholarship.title) then
    raise exception 'Only the AdDU internal scholarship tracks are in scope: Grant-in-Aid (GIA), Jubilee, and the Student Assistant Program.' using errcode = '23514';
  end if;
  if not v_scholarship.is_active
    or (v_scholarship.deadline is not null and v_scholarship.deadline < (now() at time zone 'Asia/Manila')::date) then
    raise exception 'This scholarship is no longer accepting applications.' using errcode = '23514';
  end if;
  if new.certified_at is null then
    raise exception 'Certify that your information and documents are true and complete.' using errcode = '23514';
  end if;
  if coalesce(btrim(new.statement), '') = '' then
    raise exception 'Write your application statement.' using errcode = '23514';
  end if;

  select coalesce(p.eligibility_attributes ->> 'yearStanding', '') = 'incoming-1st'
    into v_is_incoming
    from public.profiles p
    where p.user_id = new.student_id;

  for v_item in select value from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) loop
    if (v_item ->> 'standing') = 'incoming' and not coalesce(v_is_incoming, false) then continue; end if;
    if (v_item ->> 'standing') = 'continuing' and coalesce(v_is_incoming, false) then continue; end if;
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type in (select jsonb_array_elements_text(v_item -> 'documentTypes'))
    ) then
      raise exception 'Attach the required document: %.', v_item ->> 'label' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_student_application_update on public.applications;
create trigger enforce_student_application_update
  before insert or update on public.applications
  for each row execute function public.enforce_student_application_update();
