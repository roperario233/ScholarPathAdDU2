-- ---------------------------------------------------------------------------
-- FORM 230-SCH in the system: office-only financial details.
--
-- The AdDU Application for Financial Aid asks for family finances (each
-- parent's employment and annual income, assets, appliances, perceived economic
-- status) and for time-sensitive answers (other income, financial difficulty in
-- the last 3 months, daily allowance and expenses). Those are sensitive, and a
-- Department Chair can read every `profiles` row, so they do NOT live in
-- `profiles.profile_details`. Two tables hold them, readable by the owning
-- student and the Admissions Office (Staff and Head) only; there is no Chair
-- policy.
--
--   student_financial_profiles       reusable facts, one row per student
--   application_financial_details    the per-application answers, plus the copy
--                                    of the student's financial profile frozen
--                                    by the database when the application is
--                                    submitted
--
-- It also mirrors the new "Needed to apply" core items on the server
-- (missing_application_profile_item), requires the financial answers before a
-- Draft can be submitted, and replaces the generic "Application Form" upload
-- requirement with the two pages that cannot be captured in the system: the
-- Barangay certification of residence and the signed affidavit of agreement.
-- ---------------------------------------------------------------------------

create table if not exists public.student_financial_profiles (
  student_id uuid primary key references auth.users (id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_financial_profiles enable row level security;

drop policy if exists "student_financial_profiles_owner" on public.student_financial_profiles;
create policy "student_financial_profiles_owner" on public.student_financial_profiles
for all
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists "student_financial_profiles_office_read" on public.student_financial_profiles;
create policy "student_financial_profiles_office_read" on public.student_financial_profiles
for select using (public.is_admissions_office());

create table if not exists public.application_financial_details (
  application_id uuid primary key references public.applications (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  financial_snapshot jsonb,
  updated_at timestamptz not null default now()
);

alter table public.application_financial_details enable row level security;

drop policy if exists "application_financial_details_owner_read" on public.application_financial_details;
create policy "application_financial_details_owner_read" on public.application_financial_details
for select using (student_id = auth.uid());

drop policy if exists "application_financial_details_owner_insert" on public.application_financial_details;
create policy "application_financial_details_owner_insert" on public.application_financial_details
for insert with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.applications a
    where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft'
  )
);

drop policy if exists "application_financial_details_owner_update" on public.application_financial_details;
create policy "application_financial_details_owner_update" on public.application_financial_details
for update
using (
  student_id = auth.uid()
  and exists (
    select 1 from public.applications a
    where a.id = application_id and a.student_id = auth.uid() and a.status = 'Draft'
  )
)
with check (student_id = auth.uid());

drop policy if exists "application_financial_details_office_read" on public.application_financial_details;
create policy "application_financial_details_office_read" on public.application_financial_details
for select using (public.is_admissions_office());

-- The frozen financial snapshot is database-owned: a student's insert starts
-- empty and a student's update cannot change it. The submit trigger below runs
-- one trigger level deeper, so it passes.
create or replace function public.protect_application_financial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.financial_snapshot := null;
  else
    new.financial_snapshot := old.financial_snapshot;
    new.application_id := old.application_id;
    new.student_id := old.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_application_financial_snapshot on public.application_financial_details;
create trigger protect_application_financial_snapshot
before insert or update on public.application_financial_details
for each row execute function public.protect_application_financial_snapshot();

-- ---------------------------------------------------------------------------
-- The profile the gates read now also carries the new core answers: the
-- descriptive profile_details keys the gate needs plus the student's financial
-- profile. Core columns still win over the JSON.
-- ---------------------------------------------------------------------------
create or replace function public.student_profile_answers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.eligibility_attributes, '{}'::jsonb)
    || jsonb_build_object(
      'birthdate', p.profile_details -> 'birthdate',
      'sexAtBirth', p.profile_details -> 'sexAtBirth',
      'schoolLastAttended', p.profile_details -> 'schoolLastAttended',
      'communityService', p.profile_details -> 'communityService',
      'familyDetails', p.profile_details -> 'familyDetails',
      'financialProfile', f.details
    )
    || jsonb_build_object(
      'fullName', p.full_name,
      'studentNumber', p.student_number,
      'degreeProgram', p.degree_program,
      'qpi', p.qpi,
      'householdIncome', p.household_income
    )
  from public.profiles p
  left join public.student_financial_profiles f on f.student_id = p.user_id
  where p.user_id = p_user_id;
$$;

-- A parent counts as answered when deceased, or when the employment status and
-- the annual income are recorded (0 is a valid income).
create or replace function public.parent_finances_answered(p_profile jsonb, p_parent text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_profile #>> array['familyDetails', p_parent || 'Deceased'], 'false') = 'true'
    or (
      coalesce(p_profile #>> array['financialProfile', p_parent, 'employmentStatus'], '')
        in ('employed', 'self-employed', 'unemployed')
      and coalesce(p_profile #>> array['financialProfile', p_parent, 'annualIncome'], '') ~ '^[0-9]+(\.[0-9]+)?$'
    );
$$;

-- Same checks as 20261028000000 plus the FORM 230-SCH core items. Mirrors
-- getProfileCompleteness() (group `application`) in src/lib/profile.js.
create or replace function public.missing_application_profile_item(p_profile jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_standing text := public.profile_year_standing(p_profile);
  v_hs numeric := public.proof_numeric_value(p_profile ->> 'hsAverage');
  v_qpi numeric := public.proof_numeric_value(p_profile ->> 'qpi');
  v_income numeric := public.proof_numeric_value(p_profile ->> 'householdIncome');
begin
  if p_profile is null then return 'your profile'; end if;
  if char_length(btrim(coalesce(p_profile ->> 'fullName', ''))) < 2 then return 'Full name'; end if;
  if v_standing = '' then return 'Year standing'; end if;
  if v_standing <> 'incoming-1st' and coalesce(btrim(p_profile ->> 'studentNumber'), '') !~ '^[0-9]{4,12}$' then
    return 'AdDU student number';
  end if;
  if coalesce(btrim(p_profile ->> 'degreeProgram'), '') = '' then return 'Degree program'; end if;
  if coalesce(p_profile ->> 'academicStanding', '') not in ('good', 'probation', 'disqualified') then return 'Academic standing'; end if;
  if v_standing <> 'incoming-1st' and (v_qpi is null or v_qpi < 0 or v_qpi > 4) then return 'Annual QPI'; end if;
  if v_standing = 'incoming-1st' and (v_hs is null or v_hs < 60 or v_hs > 100 or v_hs <> trunc(v_hs)) then
    return 'Senior high school general average';
  end if;
  if v_income is null or v_income < 0 then return 'Annual household income'; end if;
  if coalesce(p_profile ->> 'citizenship', '') not in ('Filipino', 'Non-Filipino') then return 'Citizenship'; end if;
  if coalesce(p_profile ->> 'birthdate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'Birthdate'; end if;
  if coalesce(p_profile ->> 'sexAtBirth', '') not in ('Female', 'Male') then return 'Sex assigned at birth'; end if;
  if v_standing = 'incoming-1st'
    and char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,name}', ''))) = 0 then
    return 'Senior high school last attended';
  end if;
  if coalesce(p_profile ->> 'communityService', '') not in ('Yes', 'No') then
    return 'Willingness to render community service';
  end if;
  if coalesce(p_profile #>> '{financialProfile,economicStatus}', '') not in ('lower', 'middle', 'upper') then
    return 'Perceived economic status';
  end if;
  if not public.parent_finances_answered(p_profile, 'father') then return 'Father''s employment and income'; end if;
  if not public.parent_finances_answered(p_profile, 'mother') then return 'Mother''s employment and income'; end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submitting an in-scope application needs the financial situation answers,
-- and the database freezes the student's financial profile with them. Kept as
-- separate triggers so enforce_student_application_update is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.financial_answers_complete(p_answers jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_answers ->> 'otherIncomeAnswer', '') in ('yes', 'no')
    and coalesce(p_answers ->> 'difficultyAnswer', '') in ('yes', 'no')
    and (
      p_answers ->> 'difficultyAnswer' = 'no'
      or (
        char_length(btrim(coalesce(p_answers ->> 'difficultyReasons', ''))) > 0
        and char_length(btrim(coalesce(p_answers ->> 'difficultyCoping', ''))) > 0
      )
    )
    and coalesce(p_answers ->> 'allowanceEnough', '') in ('yes', 'no')
    and char_length(btrim(coalesce(p_answers ->> 'foodIntake', ''))) > 0
    and char_length(btrim(coalesce(p_answers ->> 'transportMode', ''))) > 0
    and coalesce(p_answers ->> 'allowanceDaily', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseFood', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseTransport', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseOther', '') ~ '^[0-9]+(\.[0-9]+)?$';
$$;

create or replace function public.require_application_financial_answers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_answers jsonb;
begin
  if public.current_profile_role() is distinct from 'student' then
    return new;
  end if;
  if not (old.status = 'Draft' and new.status = 'Submitted') then
    return new;
  end if;

  select * into v_scholarship from public.scholarships where id = new.scholarship_id;
  if not found
    or coalesce(v_scholarship.is_external, false)
    or not public.is_addu_in_scope_track(v_scholarship.title) then
    return new;
  end if;

  select answers into v_answers from public.application_financial_details where application_id = new.id;
  if v_answers is null or not public.financial_answers_complete(v_answers) then
    raise exception 'Complete the financial situation step before submitting.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists require_application_financial_answers on public.applications;
create trigger require_application_financial_answers
before update on public.applications
for each row execute function public.require_application_financial_answers();

create or replace function public.freeze_application_financial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Draft' and new.status = 'Submitted' then
    update public.application_financial_details d
    set financial_snapshot = coalesce(
          (select f.details from public.student_financial_profiles f where f.student_id = new.student_id),
          '{}'::jsonb
        ),
        updated_at = now()
    where d.application_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists freeze_application_financial_snapshot on public.applications;
create trigger freeze_application_financial_snapshot
after update on public.applications
for each row execute function public.freeze_application_financial_snapshot();

-- ---------------------------------------------------------------------------
-- Required documents: the generic "Application Form" upload is replaced by the
-- two pages that must stay on paper (the Punong Barangay's certification of the
-- residence photos and the signed affidavit of agreement), both printed from the
-- application itself. Same in-scope title rule and idempotent pattern as the
-- earlier backfills; mirrors DEFAULT_REQUIRED_DOCUMENTS in
-- src/lib/applicationRequirements.js.
-- ---------------------------------------------------------------------------
with scoped as (
  select
    id,
    case
      when jsonb_typeof(coalesce(required_documents, '[]'::jsonb)) = 'array'
        then coalesce(required_documents, '[]'::jsonb)
      else '[]'::jsonb
    end as docs
  from public.scholarships
  where public.is_addu_in_scope_track(title)
),
rebuilt as (
  select
    s.id,
    coalesce((
      select jsonb_agg(t.item order by t.ord)
      from jsonb_array_elements(s.docs) with ordinality as t(item, ord)
      where t.item ->> 'id' <> 'application-form'
    ), '[]'::jsonb)
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'barangay-residence-certification'
           ) then '[{
             "id": "barangay-residence-certification",
             "label": "Barangay certification of residence (signed by the Punong Barangay)",
             "documentTypes": ["Barangay Residence Certification"],
             "standing": "all"
           }]'::jsonb
           else '[]'::jsonb
         end
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'signed-affidavit'
           ) then '[{
             "id": "signed-affidavit",
             "label": "Signed affidavit of agreement (applicant and parents)",
             "documentTypes": ["Signed Affidavit of Agreement"],
             "standing": "all"
           }]'::jsonb
           else '[]'::jsonb
         end as docs
  from scoped s
)
update public.scholarships scholarship
set required_documents = rebuilt.docs
from rebuilt
where scholarship.id = rebuilt.id
  and scholarship.required_documents is distinct from rebuilt.docs;
