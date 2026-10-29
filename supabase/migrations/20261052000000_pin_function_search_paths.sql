-- Pin the search_path on the fifteen helper functions the linter reports as
-- `function_search_path_mutable`.
--
-- Every SECURITY DEFINER function in this schema already sets
-- `search_path = public`. These fifteen are SECURITY INVOKER, so a caller cannot
-- use them to reach an object it could not reach itself, but leaving their
-- search_path at the role default is still the gap the Supabase linter flags
-- (lint 0011): an unqualified name inside them resolves through whatever
-- search_path the session happens to carry.
--
-- All of them are read-only helpers, so pinning the path changes no behaviour:
--
--   * the profile gate and proof checks (`missing_application_profile_item`,
--     `parent_name_answered`, `parent_finances_answered`, `jsonb_is_true`,
--     `jsonb_array_empty`, `financial_option_group_answered`,
--     `financial_multi_select_answered`, `financial_answers_complete`,
--     `profile_year_standing`, `attribute_proof_required`);
--   * the proof comparison (`document_proof_is_current`, `proof_numeric_value`);
--   * the taxonomy and catalog predicates (`document_type_attributes`,
--     `is_addu_in_scope_track` — the latter backs the
--     `admissions_office_scholarships_manage` policy);
--   * the academic-year boundary (`academic_year_start`).
--
-- `alter function ... set search_path` does not change privileges, so the
-- functions whose EXECUTE was revoked from anon/authenticated by
-- 20261040000000_restrict_profile_gate_function_access.sql stay revoked: they
-- are reachable only from the trigger path, exactly as before.

alter function public.academic_year_start(timestamp with time zone)
  set search_path = public;

alter function public.attribute_proof_required(text, jsonb)
  set search_path = public;

alter function public.document_proof_is_current(jsonb, timestamp with time zone, text, jsonb, timestamp with time zone)
  set search_path = public;

alter function public.document_type_attributes(text, text)
  set search_path = public;

alter function public.financial_answers_complete(jsonb)
  set search_path = public;

alter function public.financial_multi_select_answered(jsonb)
  set search_path = public;

alter function public.financial_option_group_answered(jsonb, text, text[])
  set search_path = public;

alter function public.is_addu_in_scope_track(text)
  set search_path = public;

alter function public.jsonb_array_empty(jsonb)
  set search_path = public;

alter function public.jsonb_is_true(jsonb)
  set search_path = public;

alter function public.missing_application_profile_item(jsonb)
  set search_path = public;

alter function public.parent_finances_answered(jsonb, text)
  set search_path = public;

alter function public.parent_name_answered(jsonb, text)
  set search_path = public;

alter function public.profile_year_standing(jsonb)
  set search_path = public;

alter function public.proof_numeric_value(text)
  set search_path = public;
