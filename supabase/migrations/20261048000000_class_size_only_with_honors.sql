-- ---------------------------------------------------------------------------
-- The number of graduates of the senior high school is asked only when the
-- student claims a graduation honors standing (Valedictorian / Salutatorian),
-- because it exists to support that claim. Mirrors getProfileCompleteness() in
-- src/lib/profile.js; every other rule is unchanged from
-- 20261046000000_require_complete_form_230_sch.sql.
-- ---------------------------------------------------------------------------

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
  -- The class size supports an honors standing, so it is asked only when one is claimed.
  if coalesce(btrim(p_profile ->> 'honorsRank'), '') <> ''
    and (public.proof_numeric_value(p_profile ->> 'graduatingClassSize') is null
      or public.proof_numeric_value(p_profile ->> 'graduatingClassSize') < 1) then
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

revoke execute on function public.missing_application_profile_item(jsonb) from public, anon, authenticated;
