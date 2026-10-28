-- ---------------------------------------------------------------------------
-- Restore public.parent_name_answered(jsonb, text).
--
-- 20261044000000_require_parent_names.sql creates this predicate and
-- 20261046000000_require_complete_form_230_sch.sql keeps calling it from
-- missing_application_profile_item(), but the deployed project was missing it:
--
--   select public.parent_name_answered('{}'::jsonb, 'father');
--   ERROR: 42883: function public.parent_name_answered(jsonb, unknown) does not exist
--
-- missing_application_profile_item() is plpgsql, so the missing function is only
-- resolved when the gate reaches that line, which means every Draft insert and
-- Draft -> Submitted move that passed the earlier answers failed with
-- "function public.parent_name_answered(jsonb, text) does not exist" instead of
-- reporting the next missing answer.
--
-- This recreates the function exactly as 20261044000000 defines it (and as
-- supabase/schema.sql records it) and re-applies the EXECUTE revokes. It is
-- idempotent: running it on a project that already has the function is a no-op
-- apart from the revokes.
-- ---------------------------------------------------------------------------

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
