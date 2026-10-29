-- ---------------------------------------------------------------------------
-- Repair: restore the documented SAS approval routing.
--
-- `approval_levels` is data, not schema: the Admissions Office Head owns it on
-- the `admin-catalog` page (ApprovalLevelsCard), so it drifts when the setting
-- is changed during a demonstration. It had drifted into a dead end for the
-- School of Arts and Sciences:
--
--   * SAS · Computer Studies was set to `dean`, but the only `dean` account is
--     scoped to the School of Business and Governance. `reviewer_scopes_to_student()`
--     checks scope before the level, so no account could approve an SAS
--     applicant: the case would stop at `Recommended` with an empty approver
--     queue, and the Assistant Dean of that cluster was in scope but was not the
--     configured level.
--   * A school-level SAS row had been added pointing at `dean` for the same
--     reason. The migration seed
--     (20261050000000_interviewer_role_and_approval_routing.sql) never had one,
--     and `approver_role_for_student()` already falls back to
--     `department_chair`, so the row is kept but points at the documented
--     default instead of at a dean who holds no SAS scope.
--
-- Restoring the seed is the smallest change that removes the dead end: the
-- Computer Studies cluster returns to `assistant_dean` (the account already
-- scoped to it becomes the approver) and SAS falls back to a Chairperson.
--
-- This is a data script, not a migration: nothing runs it automatically, it
-- changes no schema, and it is safe to re-run. A fresh project built from
-- `schema.sql` or the migrations already has the correct seed, so this file only
-- repairs a deployed project that drifted.
--
-- Known gaps this repair does not close (they are provisioning, not routing):
--   * SOE still resolves to `dean` with no dean account scoped to it.
--   * SEA resolves to `department_chair`; the only Chairperson account is the
--     SAS IT and IS Department chair, so an SEA case has no approver yet.
--   * SAS departments other than Computer Studies need their own Chairperson
--     account before a case there can be approved.
-- Create the missing accounts from the Head's Accounts page
-- (20261051000000_account_provisioning.sql) rather than by seeding SQL.
-- ---------------------------------------------------------------------------

-- What will change (read-only preview; run this block first if you want a count).
-- select school, coalesce(cluster, '(school level)') as level, approver_role
--   from public.approval_levels
--  where school = 'School of Arts and Sciences (SAS)';

begin;

-- The cluster row decides before the school row, so this is the one that
-- unblocks a Computer Studies applicant.
update public.approval_levels
   set approver_role = 'assistant_dean',
       updated_at = now(),
       updated_by = null
 where school = 'School of Arts and Sciences (SAS)'
   and cluster = 'Computer Studies';

-- The school-level row: the documented default, not a dean who holds no SAS scope.
update public.approval_levels
   set approver_role = 'department_chair',
       updated_at = now(),
       updated_by = null
 where school = 'School of Arts and Sciences (SAS)'
   and cluster is null;

-- Verify inside the transaction: every application must resolve to a role that
-- at least one active, in-scope account holds.
-- select a.id, a.status, ap.school, ap.cluster,
--        public.approver_role_for_student(a.student_id) as approver_role
--   from public.applications a
--   join public.profiles s on s.user_id = a.student_id
--   left join public.academic_programs ap on ap.value = s.degree_program
--  order by ap.school, a.id;

commit;

-- Applied once to the deployed project alongside this file, as an operator
-- action on the Head's Accounts page (display name only; no routing effect):
-- the `dean` account scoped to SBG still carried a stale
-- "(Department Chair, SEA)" suffix, which contradicted its role and school in
-- the sidebar and on every review surface.
-- update public.profiles set full_name = 'Miguel' where role = 'dean';
