-- ---------------------------------------------------------------------------
-- FORM 230-SCH "Applicant Status". A student answers Incoming First Year,
-- Current Ateneo Student (College), or Transferee. The year standing already
-- carries the first two, so only the transferee answer is stored, in
-- `profiles.eligibility_attributes` -> `isTransferee` ('Yes' / 'No').
--
-- The answer is part of "Needed to apply", matching the `applicantStatus` item in
-- getProfileCompleteness() (src/lib/profile.js), and a transferee records the
-- college last attended in the same `schoolLastAttended` block. Mirrored here so
-- the student application trigger refuses a Draft started from a profile that has
-- not answered it.
--
-- CREATE OR REPLACE preserves the function's existing EXECUTE grants; it adds none.
-- The gate function is not revoked from the API roles (20261036000001 restricts the
-- financial helpers), so this migration does not make it unreachable over
-- /rest/v1/rpc.
-- ---------------------------------------------------------------------------
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
begin
  if p_profile is null then return 'your profile'; end if;
  if char_length(btrim(coalesce(p_profile ->> 'fullName', ''))) < 2 then return 'Full name'; end if;
  if v_standing = '' then return 'Year standing'; end if;
  if v_transferee not in ('Yes', 'No') then return 'Applicant status'; end if;
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
  if coalesce(btrim(p_profile ->> 'civilStatus'), '') = '' then return 'Civil status'; end if;
  if v_standing = 'incoming-1st' and coalesce(btrim(p_profile ->> 'hsStrand'), '') = '' then
    return 'Senior high school strand';
  end if;
  if coalesce(btrim(p_profile ->> 'completeAddress'), '') = '' then return 'Complete address'; end if;
  if coalesce(p_profile ->> 'ipCommunity', '') not in ('Yes', 'No') then return 'IP community'; end if;
  if coalesce(p_profile ->> 'pwd', '') not in ('Yes', 'No') then return 'Person with Disability (PWD)'; end if;
  if coalesce(p_profile ->> 'employed', '') not in ('Not employed', 'Part-time', 'Full-time', 'Self-employed') then
    return 'Employment status';
  end if;
  if coalesce(p_profile ->> 'birthdate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'Birthdate'; end if;
  if coalesce(p_profile ->> 'sexAtBirth', '') not in ('Female', 'Male') then return 'Sex assigned at birth'; end if;
  -- A transferee records the college last attended instead of a senior high school.
  if (v_standing = 'incoming-1st' or v_transferee = 'Yes')
    and char_length(btrim(coalesce(p_profile #>> '{schoolLastAttended,name}', ''))) = 0 then
    return case when v_transferee = 'Yes' then 'College last attended' else 'Senior high school last attended' end;
  end if;
  if coalesce(p_profile ->> 'communityService', '') not in ('Yes', 'No') then
    return 'Willingness to render community service';
  end if;
  if coalesce(p_profile #>> '{financialProfile,economicStatus}', '') not in ('lower', 'middle', 'upper') then
    return 'Perceived economic status';
  end if;
  if not public.parent_finances_answered(p_profile, 'father') then return 'Father''s employment and income'; end if;
  if not public.parent_finances_answered(p_profile, 'mother') then return 'Mother''s employment and income'; end if;
  -- A Philippine mobile number: 09XXXXXXXXX, +639XXXXXXXXX or 9XXXXXXXXX (formatting ignored).
  if regexp_replace(coalesce(p_profile ->> 'phone', ''), '\D', '', 'g') !~ '^(63|0)?9[0-9]{9}$' then
    return 'Philippine mobile number';
  end if;
  return null;
end;
$$;
