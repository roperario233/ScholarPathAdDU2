-- Role-scoped stage totals computed in the database instead of by downloading
-- every application. The function is SECURITY INVOKER on purpose: row-level
-- security on public.applications is the single statement of who may see which
-- case (the student's own, the Admissions Office's all, a reviewer's scope through
-- reviewer_scopes_to_student()), so a count can never reveal a case the caller
-- could not list. It returns counts only: no student, no snapshot, no finance.
--
-- The client uses it to check, after every background refresh, that the cases it
-- holds in memory match what the database says the caller can see, and to
-- reconcile in full when they do not.
create or replace function public.get_application_stage_counts()
returns table (
  status text,
  scholarship_id uuid,
  application_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select a.status, a.scholarship_id, count(*)::bigint as application_count
  from public.applications a
  group by a.status, a.scholarship_id;
$$;

revoke all on function public.get_application_stage_counts() from public, anon;
grant execute on function public.get_application_stage_counts() to authenticated;
