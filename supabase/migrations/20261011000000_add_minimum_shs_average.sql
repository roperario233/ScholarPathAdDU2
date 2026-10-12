-- Add the incoming first-year academic floor to the internal scholarship catalog.
-- Incoming first-years have no collegiate QPI, so the general pool gates them on
-- their senior high school general average instead (see getAcademicRequirement
-- in src/lib/eligibility.js). This is additive and safe to run on the existing
-- scholarships table; a NULL value falls back to the internal rule default in
-- the client (GENERAL_POOL_SHS_AVERAGE_FLOOR).
alter table public.scholarships add column if not exists minimum_shs_average numeric(5, 2);
