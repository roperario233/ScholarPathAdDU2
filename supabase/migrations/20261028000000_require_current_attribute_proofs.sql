-- ---------------------------------------------------------------------------
-- Current proof of the profile answers before submission, and a complete
-- profile before an application is started.
--
-- Until now a Document Vault file proved a profile answer only when it was
-- uploaded through the vault with an attribute picked, so a grade report
-- uploaded from the application workspace never verified the QPI it showed.
-- The app now links every upload through one type-to-attribute map
-- (getProvenAttributes in src/lib/profile.js); this migration mirrors that map
-- and enforces the rules the readiness check
-- (getApplicationReadiness in src/lib/applicationRequirements.js) applies:
--
--   * Draft insert (in-scope tracks only): the "Needed to apply" answers for
--     the student's year standing must be complete
--     (getApplicationProfileGate in src/lib/profile.js).
--   * Draft -> Submitted: the year standing must be set, and every attached
--     file that satisfies a requirement proving a profile answer must be a
--     current proof of it: not Rejected, attesting the value the profile holds
--     now, and, for the annual QPI and household income, uploaded in the
--     current June-start academic year. A claim the profile makes (IP community
--     "Yes", PWD "Yes", employed, graduation honors) needs its own current proof
--     attached unless a catalog requirement already proves it
--     (getClaimProofRequirements). Pending is enough: verification still
--     happens at For Verification, and enforce_document_verification_before_progress
--     keeps the application there until every attached file is Verified.
--
-- Backfill: existing vault files gain the links their type proves (a file with
-- no attested value counts as current, as in the client); Good Moral Character
-- no longer proves academic standing; and every in-scope catalog entry asks for
-- proof of Filipino citizenship (DEFAULT_REQUIRED_DOCUMENTS). Existing Drafts
-- must attach that proof before submitting; submitted applications are
-- unaffected because the submit gate runs only on Draft -> Submitted.
-- ---------------------------------------------------------------------------

-- Preflight: the columns and helpers this migration builds on come from earlier
-- migrations. Stop with the name of the missing one instead of failing halfway.
do $$
declare
  v_missing text[] := '{}'::text[];
begin
  if to_regprocedure('public.current_profile_role()') is null then
    v_missing := array_append(v_missing, 'public.current_profile_role() (base schema)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'eligibility_attributes') then
    v_missing := array_append(v_missing, 'profiles.eligibility_attributes (20261005140000_add_profile_details.sql)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'linked_attributes') then
    v_missing := array_append(v_missing, 'documents.linked_attributes (20261007000000_add_document_linked_attributes.sql)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scholarships' and column_name = 'required_documents') then
    v_missing := array_append(v_missing, 'scholarships.required_documents (20261012000000_add_application_requirements.sql)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'attested_values') then
    v_missing := array_append(v_missing, 'documents.attested_values (20261013000000_add_document_attested_values.sql)');
  end if;
  if to_regclass('public.application_documents') is null then
    v_missing := array_append(v_missing, 'public.application_documents (base schema)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Apply the earlier migrations first. Missing: %', array_to_string(v_missing, '; ');
  end if;
end;
$$;

-- The in-scope title rule from 20261014000001, redefined here unchanged so this
-- migration also runs on a project where that one is still pending.
create or replace function public.is_addu_in_scope_track(p_title text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_title, ''))) ~ 'jubilee|grant[ -]?in[ -]?aid|(^|[^a-z])gia([^a-z]|$)|student assistant|working scholar';
$$;

-- A valid year standing value, or '' when unset.
create or replace function public.profile_year_standing(p_profile jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_profile ->> 'yearStanding', '') in ('incoming-1st', '1st', '2nd', '3rd', '4th', '5th')
      then p_profile ->> 'yearStanding'
    else ''
  end;
$$;

-- The profile attributes a document type proves for a year standing. Mirrors
-- getProvenAttributes() and VERIFIABLE_ATTRIBUTE_OPTIONS in src/lib/profile.js:
-- a type scoped to one standing applies to that standing or to an unset one.
create or replace function public.document_type_attributes(p_type text, p_year_standing text)
returns text[]
language sql
immutable
as $$
  with standing as (
    select
      coalesce(p_year_standing, '') = 'incoming-1st' as is_incoming,
      coalesce(p_year_standing, '') in ('1st', '2nd', '3rd', '4th', '5th') as is_continuing
  )
  select array_remove(array[
    case when p_type in ('Grade Report', 'Transcript') and not s.is_incoming then 'qpi' end,
    case when p_type = 'HS Report Card' and not s.is_continuing then 'hsAverage' end,
    case when (p_type in ('Grade Report', 'Transcript') and not s.is_incoming)
           or (p_type = 'HS Report Card' and not s.is_continuing) then 'academicStanding' end,
    case when p_type in ('Income Proof', 'Certificate of Indigency') then 'householdIncome' end,
    case when p_type in ('Certificate of Employment', 'Payslip') then 'employed' end,
    case when p_type = 'Certificate of Award' then 'honorsRank' end,
    case when p_type in ('PSA Birth Certificate', 'Philippine National ID', 'Driver''s License', 'Passport') then 'citizenship' end,
    case when p_type = 'Certificate of Tribal Membership' then 'ipCommunity' end,
    case when p_type in ('PWD ID', 'Medical Certificate') then 'pwd' end
  ], null)
  from standing s;
$$;

-- Whether the profile's current answer needs proof. Mirrors isProofRequired():
-- an answer that claims nothing (IP community "No", "Not employed", no honors)
-- needs no document, and a QPI is not asked of an incoming first-year.
create or replace function public.attribute_proof_required(p_key text, p_profile jsonb)
returns boolean
language sql
immutable
as $$
  select case p_key
    when 'qpi' then public.profile_year_standing(p_profile) <> 'incoming-1st'
    when 'hsAverage' then public.profile_year_standing(p_profile) = 'incoming-1st'
      or (public.profile_year_standing(p_profile) = '' and coalesce(btrim(p_profile ->> 'hsAverage'), '') <> '')
    when 'employed' then coalesce(btrim(p_profile ->> 'employed'), '') not in ('', 'Not employed')
    when 'honorsRank' then coalesce(btrim(p_profile ->> 'honorsRank'), '') <> ''
    when 'ipCommunity' then coalesce(p_profile ->> 'ipCommunity', '') = 'Yes'
    when 'pwd' then coalesce(p_profile ->> 'pwd', '') = 'Yes'
    else true
  end;
$$;

-- The June-start academic year of a moment, read on the Manila calendar.
create or replace function public.academic_year_start(p_at timestamptz)
returns integer
language sql
stable
as $$
  select extract(year from (p_at at time zone 'Asia/Manila'))::integer
    - case when extract(month from (p_at at time zone 'Asia/Manila')) < 6 then 1 else 0 end;
$$;

-- A numeric answer in its comparable form, or null when blank or not a number.
create or replace function public.proof_numeric_value(p_value text)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_value), '') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_value)::numeric
    else null
  end;
$$;

-- Whether a file is still a current proof of one answer. Mirrors
-- getProofStaleReason() in src/lib/verification.js: the value it was uploaded
-- to prove must match the profile now (QPI and the senior high school average
-- to two decimals), and an annual proof must be from the current academic
-- year. A file with no attested value for the key counts as current.
create or replace function public.document_proof_is_current(
  p_attested jsonb,
  p_uploaded_at timestamptz,
  p_key text,
  p_profile jsonb,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
as $$
begin
  if coalesce(p_attested, '{}'::jsonb) ? p_key then
    if p_key in ('qpi', 'hsAverage') then
      if round(public.proof_numeric_value(p_attested ->> p_key), 2)
        is distinct from round(public.proof_numeric_value(p_profile ->> p_key), 2) then
        return false;
      end if;
    elsif p_key = 'householdIncome' then
      if public.proof_numeric_value(p_attested ->> p_key)
        is distinct from public.proof_numeric_value(p_profile ->> p_key) then
        return false;
      end if;
    elsif nullif(btrim(p_attested ->> p_key), '') is distinct from nullif(btrim(p_profile ->> p_key), '') then
      return false;
    end if;
  end if;
  if p_key in ('qpi', 'householdIncome') and p_uploaded_at is not null
    and public.academic_year_start(p_uploaded_at) <> public.academic_year_start(p_now) then
    return false;
  end if;
  return true;
end;
$$;

-- The profile the gates read: the core columns plus the eligibility answers.
create or replace function public.student_profile_answers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.eligibility_attributes, '{}'::jsonb)
    || jsonb_build_object(
      'fullName', p.full_name,
      'studentNumber', p.student_number,
      'degreeProgram', p.degree_program,
      'qpi', p.qpi,
      'householdIncome', p.household_income
    )
  from public.profiles p
  where p.user_id = p_user_id;
$$;

-- The first "Needed to apply" answer still missing for the standing, or null
-- when the profile is complete. Mirrors getProfileCompleteness() (group
-- `application`) in src/lib/profile.js.
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
  return null;
end;
$$;

create or replace function public.enforce_student_application_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scholarship public.scholarships%rowtype;
  v_profile jsonb;
  v_standing text;
  v_is_incoming boolean;
  v_item jsonb;
  v_types text[];
  v_keys text[];
  v_covered text[] := '{}'::text[];
  v_claim text;
  v_missing text;
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
    -- Profile first: an in-scope application starts only from a complete
    -- profile, because the answers decide its required documents.
    if found and coalesce(v_scholarship.is_external, false) = false
      and public.is_addu_in_scope_track(v_scholarship.title) then
      v_missing := public.missing_application_profile_item(public.student_profile_answers(new.student_id));
      if v_missing is not null then
        raise exception 'Complete your profile before applying: %.', v_missing using errcode = '23514';
      end if;
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

  v_profile := coalesce(public.student_profile_answers(new.student_id), '{}'::jsonb);
  v_missing := public.missing_application_profile_item(v_profile);
  if v_missing is not null then
    raise exception 'Complete your profile before submitting: %.', v_missing using errcode = '23514';
  end if;
  v_standing := public.profile_year_standing(v_profile);
  v_is_incoming := v_standing = 'incoming-1st';

  for v_item in select value from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) loop
    if (v_item ->> 'standing') = 'incoming' and not v_is_incoming then continue; end if;
    if (v_item ->> 'standing') = 'continuing' and v_is_incoming then continue; end if;
    v_types := array(select jsonb_array_elements_text(coalesce(v_item -> 'documentTypes', '[]'::jsonb)));
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type = any(v_types)
    ) then
      raise exception 'Attach the required document: %.', v_item ->> 'label' using errcode = '23514';
    end if;

    -- The answers this requirement proves for the student, as in
    -- getRequirementProvenAttributes().
    v_keys := array(
      select distinct key
      from unnest(v_types) t(type), unnest(public.document_type_attributes(t.type, v_standing)) key
      where public.attribute_proof_required(key, v_profile)
    );
    v_covered := v_covered || v_keys;
    if cardinality(v_keys) > 0 and not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and d.document_type = any(v_types)
        and not exists (
          select 1 from unnest(v_keys) key
          where (key = any(d.linked_attributes) or key = any(public.document_type_attributes(d.document_type, v_standing)))
            and not public.document_proof_is_current(d.attested_values, d.uploaded_at, key, v_profile)
        )
    ) then
      raise exception 'Upload a current proof for: %. Your profile answer changed after the attached file was uploaded, or the file is from an earlier academic year.', v_item ->> 'label' using errcode = '23514';
    end if;
  end loop;

  -- Claims the profile makes need their own current proof, unless a catalog
  -- requirement already proves them (getClaimProofRequirements).
  foreach v_claim in array array['employed', 'honorsRank', 'ipCommunity', 'pwd'] loop
    if v_claim = any(v_covered) or not public.attribute_proof_required(v_claim, v_profile) then continue; end if;
    if not exists (
      select 1
      from public.application_documents ad
      join public.documents d on d.id = ad.document_id
      where ad.application_id = new.id
        and d.verification_status <> 'Rejected'
        and v_claim = any(public.document_type_attributes(d.document_type, v_standing))
        and public.document_proof_is_current(d.attested_values, d.uploaded_at, v_claim, v_profile)
    ) then
      raise exception 'Attach a current proof of your % answer.', case v_claim
        when 'employed' then 'employment'
        when 'honorsRank' then 'graduation honors'
        when 'ipCommunity' then 'IP community'
        else 'PWD'
      end using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_student_application_update on public.applications;
create trigger enforce_student_application_update
  before insert or update on public.applications
  for each row execute function public.enforce_student_application_update();

-- Backfill: every vault file gains the links its type proves for its owner's
-- standing, and Good Moral Character no longer proves academic standing.
update public.documents d
set linked_attributes = array(
  select distinct key
  from unnest(
    array_remove(d.linked_attributes, case when d.document_type = 'Good Moral Character' then 'academicStanding' end)
    || public.document_type_attributes(d.document_type, public.profile_year_standing(p.eligibility_attributes))
  ) key
  order by key
)
from public.profiles p
where p.user_id = d.owner_id
  and (
    not (public.document_type_attributes(d.document_type, public.profile_year_standing(p.eligibility_attributes)) <@ d.linked_attributes)
    or (d.document_type = 'Good Moral Character' and 'academicStanding' = any(d.linked_attributes))
  );

-- Backfill: every in-scope catalog entry asks for proof of Filipino
-- citizenship. Matched by title like 20261026000001; the item is appended, and
-- a Head can remove it per catalog entry in the Scholarship catalog.
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
    s.docs
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'citizenship-proof'
           ) then '[{
             "id": "citizenship-proof",
             "label": "Proof of Filipino citizenship",
             "documentTypes": ["PSA Birth Certificate", "Philippine National ID", "Driver''s License", "Passport"],
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
