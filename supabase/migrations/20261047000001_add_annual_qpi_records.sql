-- ---------------------------------------------------------------------------
-- Record the annual QPI history table in the migration history.
--
-- `annual_qpi_records` was created directly in the deployed project and never
-- written to supabase/migrations or supabase/schema.sql, so a project built from
-- this repository had no such table. src/lib/auth.js (`updateUserProfile` and
-- `updateProfileFields`) upserts the current academic year into it whenever a QPI
-- is saved, so on a fresh project the QPI answer failed with
-- "Unable to save your annual QPI record." and the first-login academic profile
-- could not be completed.
--
-- This restates the live definition (uuid primary key, one row per student per
-- academic year, FK to profiles(user_id) with cascade, 0-4 QPI check) and its
-- owner-only RLS policy. It is idempotent, so applying it to the deployed project
-- changes nothing but the migration history.
-- ---------------------------------------------------------------------------

create table if not exists public.annual_qpi_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  academic_year text not null,
  qpi numeric not null check (qpi >= 0 and qpi <= 4),
  recorded_at timestamptz not null default now(),
  unique (user_id, academic_year)
);

alter table public.annual_qpi_records enable row level security;

-- A student reads and writes only their own QPI history; no staff role needs it.
drop policy if exists annual_qpi_records_self_access on public.annual_qpi_records;
create policy "annual_qpi_records_self_access" on public.annual_qpi_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
