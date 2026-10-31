-- ---------------------------------------------------------------------------
-- "Admissions Office Head" is renamed to "Admissions Office Admin".
--
-- This is a rename, not a change of authority: the second Admissions Office
-- lane keeps every capability it holds. It verifies each Document Vault file,
-- forwards the verified case to the interviewers of its scope, keeps the
-- override on the interview and approval moves, does the final check, releases
-- each scholarship's results, and owns the catalog, the approving levels,
-- announcements, venues, planning entries and the Accounts page.
--
-- What moves:
--   1. The eight check constraints that list the role.
--   2. Every stored role value. These columns hold it: profiles.role,
--      account_invitations.role, account_provisioning_log.role / actor_role,
--      application_case_officers.officer_role,
--      application_review_comments.author_role,
--      application_interview_notes.author_role, support_threads.last_message_by,
--      support_messages.sender_role, application_status_log.actor_role, and
--      documents.reviewed_by_role. The last two record the actor of a decision
--      rather than a permission; they move too, so the history reads with one
--      lane name.
--   3. The copy the app already wrote: the timeline note of a join, the
--      endorsement record's reviewer label, the status-log reasons, and the
--      notification rows. A rename that left those alone would show two names
--      for one lane in the same history.
--   4. The two role helpers: is_admissions_head() -> is_admissions_admin() and
--      require_admissions_head() -> require_admissions_admin(). A policy follows
--      a renamed function through its OID, so no policy expression is disturbed.
--   5. Every function body that compares a role against the literal. The role is
--      compared inline in 22 public functions, so those bodies are rewritten
--      from their *deployed* definitions inside this transaction: a
--      `create or replace` carrying a hand-copied body would silently revert a
--      fix made to the deployed function after this file was written, and the
--      only change intended here is the token. Step 8 refuses to commit if
--      anything still names the old value.
--   6. The policy names that carried "head", and the six policies whose
--      expressions compare current_profile_role() / sender_role against the
--      literal (a policy expression is a parsed tree, so the literal has to be
--      replaced by recreating the policy).
--
-- The application, the Edge Functions and supabase/schema.sql carry the new
-- value. Apply this migration first, then deploy the client and redeploy
-- notify-application-status, notify-document-verification,
-- notify-interview-update and manage-interview-event, which all read
-- profiles.role: the old value stops matching the policies, so a project that
-- applies the migration without deploying is left with an Admin lane that can
-- read its own profile and nothing else.
--
-- A seeded Administrator is converted by step 2, so no operator SQL is needed;
-- the first Admin of a fresh project is still created by hand, as before.
-- ---------------------------------------------------------------------------

-- 1. The constraints that list the role come off first, because their current
--    definition refuses the new value.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.account_invitations drop constraint if exists account_invitations_role_check;
alter table public.account_invitations drop constraint if exists account_invitations_scope_shape;
alter table public.application_case_officers drop constraint if exists application_case_officers_officer_role_check;
alter table public.application_interview_notes drop constraint if exists application_interview_notes_author_role_check;
alter table public.application_review_comments drop constraint if exists application_review_comments_author_role_check;
alter table public.support_messages drop constraint if exists support_messages_sender_role_check;
alter table public.support_threads drop constraint if exists support_threads_last_message_by_check;

-- 2. Every stored role value.
update public.profiles set role = 'admissions_admin' where role = 'admissions_head';
update public.account_invitations set role = 'admissions_admin' where role = 'admissions_head';
update public.account_provisioning_log set role = 'admissions_admin' where role = 'admissions_head';
update public.account_provisioning_log set actor_role = 'admissions_admin' where actor_role = 'admissions_head';
update public.application_case_officers set officer_role = 'admissions_admin' where officer_role = 'admissions_head';
update public.application_review_comments set author_role = 'admissions_admin' where author_role = 'admissions_head';
update public.application_interview_notes set author_role = 'admissions_admin' where author_role = 'admissions_head';
update public.support_threads set last_message_by = 'admissions_admin' where last_message_by = 'admissions_head';
update public.support_messages set sender_role = 'admissions_admin' where sender_role = 'admissions_head';
update public.application_status_log set actor_role = 'admissions_admin' where actor_role = 'admissions_head';
update public.documents set reviewed_by_role = 'admissions_admin' where reviewed_by_role = 'admissions_head';

-- 2b. The copy the app and its triggers already wrote. The timeline note of a
--     join, the endorsement record's reviewer label, the status-log reasons and
--     the notification rows all name the lane, so leaving them alone would put
--     two names for one lane in the same history. Only the lane name changes;
--     human-typed notes are untouched, and a note that named the lane reads the
--     same afterwards because this is a rename.
update public.application_status_log
set reason = replace(reason, 'Admissions Office Head', 'Admissions Office Admin')
where reason like '%Admissions Office Head%';

update public.notifications
set title = replace(title, 'Admissions Office Head', 'Admissions Office Admin'),
    body = replace(body, 'Admissions Office Head', 'Admissions Office Admin')
where title like '%Admissions Office Head%' or body like '%Admissions Office Head%';

update public.applications
set timeline = replace(timeline::text, 'Admissions Office Head', 'Admissions Office Admin')::jsonb
where timeline::text like '%Admissions Office Head%';

update public.applications
set endorsement = replace(endorsement::text, 'Admissions Office Head', 'Admissions Office Admin')::jsonb
where endorsement::text like '%Admissions Office Head%';

-- 3. The same constraints come back with the new value only.
alter table public.profiles add constraint profiles_role_check
check (role in ('student', 'admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

alter table public.account_invitations add constraint account_invitations_role_check
check (role in ('admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

alter table public.account_invitations add constraint account_invitations_scope_shape check (
  (
    role in ('admissions_office', 'admissions_admin')
    and review_school is null and review_cluster is null and review_department is null and home_school is null
  )
  or (
    role not in ('admissions_office', 'admissions_admin')
    and home_school is not null
    and (review_school is not null or review_department is not null)
  )
);

alter table public.application_case_officers add constraint application_case_officers_officer_role_check
check (officer_role in ('admissions_office', 'admissions_admin'));

alter table public.application_interview_notes add constraint application_interview_notes_author_role_check
check (author_role in ('admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

alter table public.application_review_comments add constraint application_review_comments_author_role_check
check (author_role in ('admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

alter table public.support_messages add constraint support_messages_sender_role_check
check (sender_role in ('student', 'admissions_office', 'admissions_admin', 'assistant'));

alter table public.support_threads add constraint support_threads_last_message_by_check
check (last_message_by in ('student', 'admissions_office', 'admissions_admin', 'assistant'));

-- 4. The two role helpers. is_admissions_admin() is the single predicate behind
--    every Admin policy, and require_admissions_admin() the guard behind the
--    account-provisioning RPCs, so both are named for the lane they test.
alter function public.is_admissions_head() rename to is_admissions_admin;
alter function public.require_admissions_head() rename to require_admissions_admin;

-- 5. The function bodies that compare a role against the literal, rewritten from
--    what is actually deployed. Renaming a function leaves the text of the
--    bodies that call it untouched, so both the literal and the two helper names
--    are replaced.
do $$
declare
  fn record;
  patched text;
begin
  for fn in
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%admissions_head%'
  loop
    patched := replace(fn.definition, '''admissions_head''', '''admissions_admin''');
    patched := replace(patched, 'Admissions Office Head', 'Admissions Office Admin');
    patched := replace(patched, 'is_admissions_head', 'is_admissions_admin');
    patched := replace(patched, 'require_admissions_head', 'require_admissions_admin');
    execute patched;
  end loop;
end $$;

-- 6. The policy names that carried the lane name.
do $$
declare
  p record;
  renamed text;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like 'admissions\_head\_%'
        or policyname like 'approval\_levels\_head\_%'
      )
  loop
    renamed := replace(p.policyname, 'approval_levels_head_', 'approval_levels_admin_');
    renamed := replace(renamed, 'admissions_head_', 'admissions_admin_');
    execute format('alter policy %I on public.%I rename to %I', p.policyname, p.tablename, renamed);
  end loop;
end $$;

-- 7. The six policies whose expression compares the role literal.
drop policy if exists "staff_application_documents_access" on public.application_documents;
create policy "staff_application_documents_access" on public.application_documents
for all using (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'department_chair'))
with check (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'department_chair'));

drop policy if exists "approval_levels_staff_read" on public.approval_levels;
create policy "approval_levels_staff_read" on public.approval_levels
for select using (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

drop policy if exists "admissions_office_interview_locations_read" on public.interview_locations;
create policy "admissions_office_interview_locations_read" on public.interview_locations
for select using (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'));

drop policy if exists "staff_office_calendar_entries_read" on public.office_calendar_entries;
create policy "staff_office_calendar_entries_read" on public.office_calendar_entries
for select using (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'department_chair'));

drop policy if exists "staff_read_profiles" on public.profiles;
create policy "staff_read_profiles" on public.profiles
for select using (public.current_profile_role() in ('admissions_office', 'admissions_admin', 'department_chair'));

drop policy if exists "support_messages_insert" on public.support_messages;
create policy "support_messages_insert" on public.support_messages
for insert with check (
  sender_id = auth.uid()
  and sender_role = public.current_profile_role()
  and sender_role in ('student', 'admissions_office', 'admissions_admin')
  and (
    public.is_admissions_office()
    or exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.student_id = auth.uid()
    )
  )
);

-- 8. The rename is complete, or the migration does not commit.
do $$
declare
  v_functions int;
  v_policies int;
  v_constraints int;
begin
  select count(*) into v_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%admissions_head%';

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public'
    and (
      policyname like '%admissions_head%'
      or qual like '%admissions_head%'
      or coalesce(with_check, '') like '%admissions_head%'
    );

  select count(*) into v_constraints
  from pg_constraint
  where pg_get_constraintdef(oid) like '%admissions_head%';

  if v_functions > 0 or v_policies > 0 or v_constraints > 0 then
    raise exception 'The role rename is incomplete: % function(s), % polic(ies) and % constraint(s) still name admissions_head.',
      v_functions, v_policies, v_constraints;
  end if;
end $$;

notify pgrst, 'reload schema';
