-- Catch-up migration for the Standard Procedure stage pipeline. The stage
-- payloads, the event timeline, and the widened status check were added to
-- supabase/schema.sql without a migration, so deployed projects never received
-- them and every status write that carries a timeline failed with
-- "Could not find the 'timeline' column of 'applications' in the schema cache".
-- Additive and safe to re-run.

alter table public.applications add column if not exists endorsement jsonb;
alter table public.applications add column if not exists interview jsonb;
alter table public.applications add column if not exists deliberation jsonb;
alter table public.applications add column if not exists release jsonb;
alter table public.applications add column if not exists timeline jsonb not null default '[]'::jsonb;

-- Cover the SOP stage sequence (Endorsed, Interview, Recommended, Released).
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('Draft', 'Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'));

-- Department review audit rows reference the application they decide on.
alter table public.department_reviews add column if not exists application_id uuid references public.applications(id) on delete cascade;

-- Ask PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';
