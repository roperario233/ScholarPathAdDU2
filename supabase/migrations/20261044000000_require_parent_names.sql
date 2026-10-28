-- ---------------------------------------------------------------------------
-- My Profile is the application form: parents' names are needed to apply.
--
-- Per the Admissions Office interview, a student's completed My Profile is the
-- FORM 230-SCH application, and the form asks for each parent's name. Family
-- details used to count for nothing in the profile gate, so a student could reach
-- 100% with that part of the form empty.
--
-- Each parent's name is now required unless the student marks that parent
-- "Unknown / not listed" (familyDetails.fatherUnknown / motherUnknown). An unknown
-- parent, like a deceased one, also needs no employment and income answer.
-- Siblings and other household members stay optional.
--
-- Mirrors getProfileCompleteness() (group `application`), isParentNameAnswered(),
-- and isParentFinancesAnswered() in src/lib/profile.js.
-- student_profile_answers() already passes `familyDetails` through, so only the
-- two predicates change. The gate runs on a Draft insert and on Draft ->
-- Submitted (enforce_student_application_update), so a submitted application,
-- whose snapshot is frozen, is unaffected.
--
-- CREATE OR REPLACE keeps the EXECUTE revokes from 20261040000000.
-- ---------------------------------------------------------------------------

-- A parent counts as answered when deceased or unknown, or when the employment
-- status and the annual income are recorded (0 is a valid income).
create or replace function public.parent_finances_answered(p_profile jsonb, p_parent text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_profile #>> array['familyDetails', p_parent || 'Deceased'], 'false') = 'true'
    or coalesce(p_profile #>> array['familyDetails', p_parent || 'Unknown'], 'false') = 'true'
    or (
      coalesce(p_profile #>> array['financialProfile', p_parent, 'employmentStatus'], '')
        in ('employed', 'self-employed', 'unemployed')
      and coalesce(p_profile #>> array['financialProfile', p_parent, 'annualIncome'], '') ~ '^[0-9]+(\.[0-9]+)?$'
    );
$$;

-- A parent's name is answered when it is filled in or the parent is unknown.
create or replace function public.parent_name_answered(p_profile jsonb, p_parent text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_profile #>> array['familyDetails', p_parent || 'Unknown'], 'false') = 'true'
    or char_length(btrim(coalesce(p_profile #>> array['familyDetails', p_parent || 'Name'], ''))) > 0;
$$;

revoke execute on function public.parent_name_answered(jsonb, text) from public, anon, authenticated;

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
  if v_transferee = 'No' and coalesce(btrim(p_profile ->> 'studentNumber'), '') !~ '^[0-9]{4,12}$' then
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
  if not public.parent_name_answered(p_profile, 'father') then return 'Father''s name'; end if;
  if not public.parent_name_answered(p_profile, 'mother') then return 'Mother''s name'; end if;
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
  if regexp_replace(coalesce(p_profile ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^(63|0)?9[0-9]{9}$' then
    return 'Philippine mobile number';
  end if;
  return null;
end;
$$;
