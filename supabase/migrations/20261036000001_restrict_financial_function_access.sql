-- ---------------------------------------------------------------------------
-- 20261036000000 made student_profile_answers() return the student's financial
-- profile. It is SECURITY DEFINER and, like every public function, was callable
-- over /rest/v1/rpc by any signed-in user with any student's uuid, which would
-- let a Department Chair or another student read the office-only financial
-- details. Only the database triggers call it (as the function owner), the app
-- never does, so API roles lose EXECUTE. The new trigger functions are not
-- meant to be called as RPCs either.
-- ---------------------------------------------------------------------------
revoke execute on function public.student_profile_answers(uuid) from public, anon, authenticated;
revoke execute on function public.protect_application_financial_snapshot() from public, anon, authenticated;
revoke execute on function public.require_application_financial_answers() from public, anon, authenticated;
revoke execute on function public.freeze_application_financial_snapshot() from public, anon, authenticated;
