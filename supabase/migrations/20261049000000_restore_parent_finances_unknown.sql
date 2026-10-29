-- ---------------------------------------------------------------------------
-- Restore the "unknown / not listed" clause in public.parent_finances_answered.
--
-- 20261044000000_require_parent_names.sql makes a parent marked Unknown / not
-- listed (familyDetails.fatherUnknown / motherUnknown) need no employment and
-- income answer, mirroring isParentFinancesAnswered() in src/lib/profile.js. The
-- deployed project still had the earlier definition, which only honoured
-- `Deceased`, so the gate kept reporting "Father's employment and income" /
-- "Mother's employment and income" on a Draft insert (and on Draft -> Submitted)
-- for a student who had marked that parent unknown:
--
--   Complete your profile before applying: Father's employment and income.
--
-- This recreates the function exactly as 20261044000000 and supabase/schema.sql
-- define it. It is idempotent: running it on a project that already has the
-- clause is a no-op. The function is only called from
-- missing_application_profile_item(), so no other definition changes.
-- ---------------------------------------------------------------------------

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

revoke execute on function public.parent_finances_answered(jsonb, text) from public, anon, authenticated;
