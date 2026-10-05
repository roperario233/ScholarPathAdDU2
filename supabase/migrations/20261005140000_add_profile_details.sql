-- My Profile details: a short bio and the extended attributes the Smart
-- Eligibility Checker reads (citizenship, academic standing, applicant type,
-- year level, honors standing, senior high school strand and average, the
-- Exclusion Flag Hierarchy answers, and sponsor ties). The attributes mirror
-- the `profileDraft` keys listed in src/lib/profile.js
-- (ELIGIBILITY_ATTRIBUTE_KEYS). Both columns are additive; existing rows keep
-- working, and the client tolerates a project where this migration is pending.
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists eligibility_attributes jsonb not null default '{}'::jsonb;

alter table profiles drop constraint if exists profiles_bio_length_check;
alter table profiles add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 280);
