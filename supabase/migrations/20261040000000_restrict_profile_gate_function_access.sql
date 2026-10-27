-- ---------------------------------------------------------------------------
-- The profile gate helpers were still callable over /rest/v1/rpc.
--
-- public.missing_application_profile_item(jsonb) answers "what is still missing
-- from this profile?" and had the default EXECUTE grant, so anon and every signed
-- in user could call it with any JSON they liked. It reads no rows and reveals no
-- data, but the app never calls it over the API: the client evaluates the same
-- rule locally (getProfileCompleteness() in src/lib/profile.js) and the server
-- repeats it through the trigger below.
--
-- public.enforce_student_application_update() had the same default grant even
-- though it is only ever a trigger. PostgreSQL does not check EXECUTE when it
-- invokes a trigger function, and both functions run as the owner (the trigger is
-- SECURITY DEFINER), so the application path keeps working. Nothing in RLS or in
-- the client references either function as an RPC.
--
-- 20261036000001 restricted the financial helpers; this closes the profile gate.
-- ---------------------------------------------------------------------------
revoke execute on function public.missing_application_profile_item(jsonb) from public, anon, authenticated;
revoke execute on function public.enforce_student_application_update() from public, anon, authenticated;
