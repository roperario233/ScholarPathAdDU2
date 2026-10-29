-- ---------------------------------------------------------------------------
-- FORM 230-SCH in the system: the printed form must be answered completely.
--
-- The Admissions Office confirmed that the student fills in the Application for
-- Financial Aid inside ScholarPath before an application is created, so the
-- printed form's remaining answers join the "Needed to apply" gate:
--
--   * personal:  religion, preferred pronouns
--   * address:   where the student stays while studying
--   * education: the senior high school (or the college a transferee left) with
--                its city and province, and the strand, for every applicant
--   * education: the number of graduates of the senior high school, and the
--                awards received or an explicit "none"
--   * family:    each listed parent's age (or date of death) and occupation, the
--                number of siblings, and each household list or an explicit
--                "none" (siblingsNone / householdAdultsNone)
--   * finances:  the employer of a working parent, the last employment and reason
--                of an unemployed one, and an answer to the assets and appliances
--                checklists (an item, "None of the above", or a typed "Others")
--   * other:     "Did you enjoy financial aid in senior high school / apply for or
--                receive a grant?" as one Yes/No answer, with the grant list
--                required when Yes
--
-- The printed form says "write NA for questions that are not applicable", so an
-- explicit none/NA answer counts as answered. Mirrors getProfileCompleteness()
-- (group `application`) in src/lib/profile.js; the document type map and the
-- other rules are unchanged from 20261044000000_require_parent_names.sql.
--
-- It also fixes a divergence: the AdDU student number is required of a *current*
-- student only, so an incoming first-year no longer has to supply one on the
-- server (the client already excluded them — see requiresStudentNumber()).
-- ---------------------------------------------------------------------------

-- The profile answers the gate reads, with the newly required descriptive fields.
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
      'religion', p.profile_details -> 'religion',
      'pronouns', p.profile_details -> 'pronouns',
      'completeAddress', p.profile_details -> 'completeAddress',
      'residingAddress', case
        when coalesce(p.profile_details ->> 'sameAsCompleteAddress', 'true') = 'false'
          then nullif(btrim(p.profile_details ->> 'residingAddress'), '')
        else nullif(btrim(p.profile_details ->> 'completeAddress'), '')
      end,
      'housingType', p.profile_details -> 'housingType',
      'housingOther', p.profile_details -> 'housingOther',
      'schoolLastAttended', p.profile_details -> 'schoolLastAttended',
      'awards', p.profile_details -> 'awards',
      'awardsNone', p.profile_details -> 'awardsNone',
      'ipGroupName', p.profile_details -> 'ipGroupName',
      'previousGrants', p.profile_details -> 'previousGrants',
      'previousGrantsAnswered', p.profile_details -> 'previousGrantsAnswered',
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

-- JSON helpers for the printed form's flags and lists. A stored value is only
-- trusted when it is the type the app writes, so a malformed row can never make
-- the gate raise instead of answering.
create or replace function public.jsonb_is_true(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_value = 'true'::jsonb, false);
$$;

create or replace function public.jsonb_array_empty(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select case when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) else 0 end = 0;
$$;

-- One of the printed form's checkbox groups (assets, appliances): an item,
-- "None of the above", or a typed "Others" is an answer. Mirrors
-- isOptionGroupAnswered() in src/lib/profile.js.
create or replace function public.financial_option_group_answered(p_profile jsonb, p_group text, p_keys text[])
returns boolean
language sql
immutable
as $$
  select public.jsonb_is_true(p_profile #> array[p_group, 'none'])
    or btrim(coalesce(p_profile #>> array[p_group, 'others'], '')) <> ''
    or exists (
      select 1
      from unnest(p_keys) as key
      where public.jsonb_is_true(p_profile #> array[p_group, key])
    );
$$;


-- The first "Needed to apply" answer still missing for the standing, or null when
-- the Application Form is complete. Mirrors getProfileCompleteness() in
-- src/lib/profile.js; keep the two in step when an answer is added or removed.
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
  v_transferee text := coalesce(p_profile ->> 'isTransferee', '');
  v_family jsonb := coalesce(p_profile -> 'familyDetails', '{}'::jsonb);
  v_financial jsonb := coalesce(p_profile -> 'financialProfile', '{}'::jsonb);
  v_parent text;
  v_age numeric;
  v_employment text;
begin
  if p_profile is null then return 'your profile'; end if;
  if char_length(btrim(coalesce(p_profile ->> 'fullName', ''))) < 2 then return 'Full name'; end if;
  if v_standing = '' then return 'Year standing'; end if;
  if v_transferee not in ('Yes', 'No') then return 'Applicant status'; end if;
  -- An AdDU student number belongs to a current student: an incoming first-year
  -- has not been issued one and a transferee's record is at the college they left.
  if v_transferee = 'No' and v_standing <> 'incoming-1st'
    and coalesce(btrim(p_profile ->> 'studentNumber'), '') !~ '^[0-9]{4,12}$' then
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
  if coalesce(btrim(p_profile ->> 'civilStatus'), '') = '' then return 'Civil status'; end if;
  -- The printed form asks every applicant for their strand, not only an incoming
  -- first-year.
  if coalesce(btrim(p_profile ->> 'hsStrand'), '') = '' then return 'Senior high school strand'; end if;
  if coalesce(btrim(p_profile ->> 'completeAddress'), '') = '' then return 'Complete address'; end if;
  if coalesce(btrim(p_profile ->> 'housingType'), '') = '' then return 'Where you stay while studying'; end if;
  if not public.parent_name_answered(p_profile, 'father') then return 'Father''s name'; end if;
  if not public.parent_name_answered(p_profile, 'mother') then return 'Mother''s name'; end if;
  if coalesce(p_profile ->> 'ipCommunity', '') not in ('Yes', 'No') then return 'IP community'; end if;
  if coalesce(p_profile ->> 'pwd', '') not in ('Yes', 'No') then return 'Person with Disability (PWD)'; end if;
  if coalesce(p_profile ->> 'employed', '') not in ('Not employed', 'Part-time', 'Full-time', 'Self-employed') then
    return 'Employment status';
  end if;
  if coalesce(p_profile ->> 'birthdate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'Birthdate'; end if;
  if coalesce(p_profile ->> 'sexAtBirth', '') not in ('Female', 'Male') then return 'Sex assigned at birth'; end if;
  if coalesce(btrim(p_profile ->> 'religion'), '') = '' then return 'Religion'; end if;
  if coalesce(btrim(p_profile ->> 'pronouns'), '') = '' then return 'Preferred pronouns'; end if;
  -- The printed form asks for the senior high school (the college a transferee
  -- left), its city, and its province.
  if char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,name}', ''))) = 0
    or char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,city}', ''))) = 0
    or char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,province}', ''))) = 0 then
    return case when v_transferee = 'Yes'
      then 'College last attended (name, city, and province)'
      else 'Senior high school last attended (name, city, and province)' end;
  end if;
  -- "No awards received" is a recorded answer.
  if public.jsonb_is_true(p_profile -> 'awardsNone') = false
    and coalesce(btrim(p_profile ->> 'awards'), '') = '' then
    return 'Awards received';
  end if;
  if coalesce(p_profile ->> 'communityService', '') not in ('Yes', 'No') then
    return 'Willingness to render community service';
  end if;
  if public.proof_numeric_value(p_profile ->> 'graduatingClassSize') is null
    or public.proof_numeric_value(p_profile ->> 'graduatingClassSize') < 1 then
    return 'Number of graduates of your senior high school';
  end if;
  if coalesce(p_profile ->> 'previousGrantsAnswered', '') not in ('Yes', 'No') then
    return 'Financial aid already received';
  end if;
  if coalesce(p_profile ->> 'previousGrantsAnswered', '') = 'Yes'
    and public.jsonb_array_empty(p_profile -> 'previousGrants') then
    return 'Grants applied for or received';
  end if;
  if coalesce(p_profile #>> '{financialProfile,economicStatus}', '') not in ('lower', 'middle', 'upper') then
    return 'Perceived economic status';
  end if;
  if not public.parent_finances_answered(p_profile, 'father') then return 'Father''s employment and income'; end if;
  if not public.parent_finances_answered(p_profile, 'mother') then return 'Mother''s employment and income'; end if;
  -- Each listed parent's age (or date of death) and occupation, then the employer
  -- of a working parent and the last employment detail of an unemployed one.
  foreach v_parent in array array['father', 'mother'] loop
    if public.jsonb_is_true(v_family -> (v_parent || 'Unknown')) = false then
      if public.jsonb_is_true(v_family -> (v_parent || 'Deceased')) then
        if coalesce(v_family ->> (v_parent || 'DateOfDeath'), '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          return case when v_parent = 'father' then 'Father''s date of death' else 'Mother''s date of death' end;
        end if;
      else
        v_age := public.proof_numeric_value(v_family ->> (v_parent || 'Age'));
        if v_age is null or v_age < 15 or v_age > 120 then
          return case when v_parent = 'father' then 'Father''s age' else 'Mother''s age' end;
        end if;
      end if;
      if btrim(coalesce(v_family ->> (v_parent || 'Occupation'), '')) = '' then
        return case when v_parent = 'father' then 'Father''s occupation' else 'Mother''s occupation' end;
      end if;
    end if;
  end loop;
  if public.proof_numeric_value(v_family ->> 'numberOfSiblings') is null
    or public.proof_numeric_value(v_family ->> 'numberOfSiblings') < 0 then
    return 'Number of siblings';
  end if;
  if public.jsonb_is_true(v_family -> 'siblingsNone') = false
    and public.jsonb_array_empty(v_family -> 'siblings') then
    return 'Siblings (names and ages), or none';
  end if;
  if public.jsonb_is_true(v_family -> 'householdAdultsNone') = false
    and public.jsonb_array_empty(v_family -> 'householdAdults') then
    return 'Other adults in the household, or none';
  end if;
  foreach v_parent in array array['father', 'mother'] loop
    if public.jsonb_is_true(v_family -> (v_parent || 'Unknown'))
      or public.jsonb_is_true(v_family -> (v_parent || 'Deceased')) then
      continue;
    end if;
    v_employment := coalesce(v_financial #>> array[v_parent, 'employmentStatus'], '');
    if v_employment in ('employed', 'self-employed')
      and btrim(coalesce(v_financial #>> array[v_parent, 'employer'], '')) = '' then
      return case when v_parent = 'father' then 'Father''s employer or business' else 'Mother''s employer or business' end;
    end if;
    if v_employment = 'unemployed'
      and (btrim(coalesce(v_financial #>> array[v_parent, 'lastEmployed'], '')) = ''
        or btrim(coalesce(v_financial #>> array[v_parent, 'unemploymentReason'], '')) = '') then
      return case when v_parent = 'father' then 'Father''s last employment and reason' else 'Mother''s last employment and reason' end;
    end if;
  end loop;
  if not public.financial_option_group_answered(
    v_financial, 'assets', array['house', 'lot', 'car', 'puv', 'motorcycle', 'realEstate', 'heavyEquipment']
  ) then
    return 'Assets owned by the family';
  end if;
  if not public.financial_option_group_answered(
    v_financial, 'appliances', array['smartphones', 'aircon', 'laptop', 'postpaidInternet']
  ) then
    return 'Appliances and services owned by the family';
  end if;
  -- A Philippine mobile number: 09XXXXXXXXX, +639XXXXXXXXX or 9XXXXXXXXX (formatting ignored).
  if regexp_replace(coalesce(p_profile ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^(63|0)?9[0-9]{9}$' then
    return 'Philippine mobile number';
  end if;
  return null;
end;
$$;

-- The gate functions are internal: the app evaluates the same rules client-side,
-- so no API caller needs to execute them (20261040000000_restrict_profile_gate_function_access.sql).
revoke execute on function public.missing_application_profile_item(jsonb) from public, anon, authenticated;
revoke execute on function public.financial_option_group_answered(jsonb, text, text[]) from public, anon, authenticated;
revoke execute on function public.jsonb_is_true(jsonb) from public, anon, authenticated;
revoke execute on function public.jsonb_array_empty(jsonb) from public, anon, authenticated;
revoke execute on function public.student_profile_answers(uuid) from public, anon, authenticated;

