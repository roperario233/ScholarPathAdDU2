-- ---------------------------------------------------------------------------
-- One-time privacy redaction for Consultation 2, request #8.
--
-- Before this change the reason a reviewer typed when rejecting an application
-- was written into `applications.timeline`, copied by the status-log trigger
-- into `application_status_log.reason`, and rendered to the student by
-- StatusHistoryList. FORM 230-SCH affidavit clause 6 keeps the results and the
-- minutes of the deliberations confidential, so the reason now stays in the
-- staff-only `application_review_comments` thread and the student only ever sees
-- "Application not accepted." (APPLICATION_REJECTION_NOTICE in
-- src/lib/constants.js). This file removes the reasons that are already stored
-- in student-readable columns.
--
-- This is a data script, not a migration: nothing runs it automatically, it
-- changes no schema, and it is safe to re-run (it only touches rows whose text
-- is not already the notice). Do NOT touch `documents.rejection_reason` here:
-- document resubmission reasons stay visible, because they tell the student what
-- to correct (request #3).
--
-- Run it once, in the Supabase SQL editor, after the app change is deployed.
-- `session_replication_role = replica` keeps the append-only status log and the
-- application triggers out of the way; if that statement is refused, run the
-- file against a role with that privilege instead of adding a history row.
-- ---------------------------------------------------------------------------

-- What will change (read-only preview; run this block first if you want a count).
-- select count(*) from public.application_status_log
--  where to_status = 'Rejected' and reason is distinct from 'Application not accepted.';
-- select count(*) from public.applications
--  where timeline @> '[{"stage":"Rejected"}]';

begin;

set local session_replication_role = replica;

-- 1. The append-only audit log: keep the row, replace the reason with the notice
--    the student is allowed to see.
update public.application_status_log
   set reason = 'Application not accepted.'
 where to_status = 'Rejected'
   and reason is distinct from 'Application not accepted.';

-- 2. The application timeline (readable by the student, `select *` for every
--    role). Only the note of the Rejected entry changes; every other entry and
--    the array order are preserved.
update public.applications a
   set timeline = (
     select jsonb_agg(
              case
                when entry.value ->> 'stage' = 'Rejected'
                  then jsonb_set(entry.value, '{note}', to_jsonb('Application not accepted.'::text))
                else entry.value
              end
              order by entry.ord
            )
       from jsonb_array_elements(a.timeline) with ordinality as entry(value, ord)
   )
 where a.timeline @> '[{"stage":"Rejected"}]';

commit;

-- Verify afterwards:
--   select to_status, reason, count(*)
--     from public.application_status_log
--    where to_status = 'Rejected'
--    group by 1, 2;
--   select a.id, e.value ->> 'stage', e.value ->> 'note'
--     from public.applications a,
--          jsonb_array_elements(a.timeline) as e(value)
--    where e.value ->> 'stage' = 'Rejected';
-- Both should read "Application not accepted." The recorded reasons remain in
-- application_review_comments for the Admissions Office and the Department Chair.
