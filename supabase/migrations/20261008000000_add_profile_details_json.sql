-- Descriptive My Profile details that are NOT inputs to the Smart Eligibility
-- Checker: religion, civil status, complete and residing address, country, the
-- same-as toggle, and family details (parents, family position, siblings). The
-- field keys mirror PROFILE_DETAIL_KEYS in src/lib/profile.js.
--
-- Additive and separate from eligibility_attributes: existing rows keep working,
-- and the client tolerates a project where this migration is pending (the fields
-- are then kept on the device only).
alter table profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;
