-- ---------------------------------------------------------------------------
-- Maintenance queries for the out-of-scope program cleanup (issue #3).
--
-- Run these manually; the migration creates no data changes. There is no
-- automatic deletion: the team decides how to handle each row.
--
-- In scope (Appendix A): Grant-in-Aid (GIA), Jubilee Scholarship Fund, and the
-- Student Assistant (SA) Program. "In scope" is decided by title, matching
-- public.is_addu_in_scope_track().
-- ---------------------------------------------------------------------------

-- 1. Find applications whose scholarship is not one of the three in-scope tracks.
select a.id, p.full_name, s.title, s.rule_family, s.is_external, a.status, a.updated_at
from public.applications a
join public.scholarships s on s.id = a.scholarship_id
left join public.profiles p on p.user_id = a.student_id
where not public.is_addu_in_scope_track(s.title)
order by a.updated_at desc;

-- 2. Optional: deactivate the out-of-scope *internal* catalog rows so they stop
--    appearing in the Explorer. External and government-linked rows are left
--    alone (they are tracked-only by design). Review the result of query 1
--    before running this.
-- update public.scholarships
--   set is_active = false, updated_at = now()
--   where category = 'Internal Endowment'
--     and coalesce(is_external, false) = false
--     and not public.is_addu_in_scope_track(title);
