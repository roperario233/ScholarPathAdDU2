-- ---------------------------------------------------------------------------
-- Address and family proofs.
--
-- The Address and Family details answers were the last My Profile groups that
-- could not be verified: no document type proved them, so no badge could read
-- Verified. This migration mirrors the four new entries in
-- VERIFIABLE_ATTRIBUTE_OPTIONS (src/lib/profile.js) and makes every in-scope
-- track ask for their proof, so they gate a submission exactly like the grade
-- report and the citizenship proof do:
--
--   completeAddress  <- Proof of Billing, Certificate of Residency
--   residingAddress  <- Proof of Billing, Certificate of Residency
--   parents          <- PSA Birth Certificate (already proves citizenship)
--   householdMembers <- Certificate of Residency
--
-- One barangay certificate of residency answers both rows, and a PSA birth
-- certificate answers the family row and the citizenship row at once, so a
-- student uploads at most two files for the four answers.
--
-- The family answers are marked compareValue: false in the client and are never
-- attested, so document_proof_is_current() keeps them current: it only compares
-- the keys a file recorded in attested_values. The residing address IS compared,
-- so student_profile_answers() now resolves it the same way getAttributeValue()
-- does (the "same as my complete address" toggle applied).
--
-- Backfill: existing vault files gain the links their type proves (an uploaded
-- PSA birth certificate starts proving the parents' names), and every in-scope
-- catalog entry gains the two requirement rows. Existing Drafts must attach them
-- before submitting; submitted applications are unaffected because the submit
-- gate runs only on Draft -> Submitted.
-- ---------------------------------------------------------------------------

-- Preflight: the columns and helpers this migration builds on. Stop with the
-- name of the missing migration instead of failing halfway.
do $preflight$
declare
  v_missing text[] := '{}'::text[];
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'linked_attributes') then
    v_missing := array_append(v_missing, 'documents.linked_attributes (20261007000000_add_document_linked_attributes.sql)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_details') then
    v_missing := array_append(v_missing, 'profiles.profile_details (20261008000000_add_profile_details_json.sql)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scholarships' and column_name = 'required_documents') then
    v_missing := array_append(v_missing, 'scholarships.required_documents (20261012000000_add_application_requirements.sql)');
  end if;
  if to_regprocedure('public.document_type_attributes(text, text)') is null then
    v_missing := array_append(v_missing, 'public.document_type_attributes(text, text) (20261028000000_require_current_attribute_proofs.sql)');
  end if;
  if to_regprocedure('public.is_addu_in_scope_track(text)') is null then
    v_missing := array_append(v_missing, 'public.is_addu_in_scope_track(text) (20261014000001_scope_student_applications_to_internal_tracks.sql)');
  end if;
  -- student_profile_answers() below joins this table, so it must exist first.
  if to_regclass('public.student_financial_profiles') is null then
    v_missing := array_append(v_missing, 'public.student_financial_profiles (20261036000000_add_application_financial_details.sql)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Apply the earlier migrations first. Missing: %', array_to_string(v_missing, '; ');
  end if;
end;
$preflight$;

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
    case when p_type in ('PWD ID', 'Medical Certificate') then 'pwd' end,
    -- Address and family answers (getAttributeValue() in src/lib/profile.js).
    case when p_type in ('Proof of Billing', 'Certificate of Residency') then 'completeAddress' end,
    case when p_type in ('Proof of Billing', 'Certificate of Residency') then 'residingAddress' end,
    case when p_type = 'PSA Birth Certificate' then 'parents' end,
    case when p_type = 'Certificate of Residency' then 'householdMembers' end
  ], null)
  from standing s;
$$;


-- The profile the gates read: the core columns, the eligibility answers, the
-- descriptive details the gate needs, the student's financial profile, and now
-- the residing address resolved through the "same as my complete address" toggle
-- so an address proof is compared against the value the client attested.
-- CREATE OR REPLACE keeps the EXECUTE revokes from 20261036000001.
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
      'civilStatus', p.profile_details -> 'civilStatus',
      'completeAddress', p.profile_details -> 'completeAddress',
      'residingAddress', case
        when coalesce(p.profile_details ->> 'sameAsCompleteAddress', 'true') = 'false'
          then nullif(btrim(p.profile_details ->> 'residingAddress'), '')
        else nullif(btrim(p.profile_details ->> 'completeAddress'), '')
      end,
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
      'householdIncome', p.household_income,
      'phone', p.phone
    )
  from public.profiles p
  left join public.student_financial_profiles f on f.student_id = p.user_id
  where p.user_id = p_user_id;
$$;

-- Backfill: every vault file gains the links its type proves for its owner's
-- standing, so an already uploaded PSA birth certificate proves the parents'
-- names the same way a new upload does.
update public.documents d
set linked_attributes = array(
  select distinct key
  from unnest(
    d.linked_attributes
    || public.document_type_attributes(d.document_type, public.profile_year_standing(p.eligibility_attributes))
  ) key
  order by key
)
from public.profiles p
where p.user_id = d.owner_id
  and not (public.document_type_attributes(d.document_type, public.profile_year_standing(p.eligibility_attributes)) <@ d.linked_attributes);

-- Backfill: every in-scope catalog entry asks for proof of the address and of
-- the family details. Matched by title like 20261026000001; the items are
-- appended, and a Head can remove either one per catalog entry in the
-- Scholarship catalog.
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
             where item ->> 'id' = 'address-proof'
           ) then '[{
             "id": "address-proof",
             "label": "Proof of address (utility bill or barangay certificate of residency)",
             "documentTypes": ["Proof of Billing", "Certificate of Residency"],
             "standing": "all"
           }]'::jsonb
           else '[]'::jsonb
         end
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'family-proof'
           ) then '[{
             "id": "family-proof",
             "label": "Proof of family details (PSA birth certificate or barangay certificate of residency)",
             "documentTypes": ["PSA Birth Certificate", "Certificate of Residency"],
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
