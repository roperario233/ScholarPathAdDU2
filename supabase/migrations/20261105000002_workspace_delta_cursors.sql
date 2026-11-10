-- Consistent update cursors let visible sessions refresh changed rows instead of
-- downloading every application/document/notification every 15 seconds.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

alter table public.documents
  add column if not exists updated_at timestamptz not null default now();
update public.documents
set updated_at = coalesce(verification_decided_at, uploaded_at, now())
where updated_at is null;

alter table public.notifications
  add column if not exists updated_at timestamptz not null default now();
update public.notifications
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.application_documents
  add column if not exists created_at timestamptz not null default now();

alter table public.application_case_officers
  add column if not exists updated_at timestamptz not null default now();
update public.application_case_officers
set updated_at = coalesce(left_at, joined_at, now())
where updated_at is null;

alter table public.application_interview_panelists
  add column if not exists updated_at timestamptz not null default now();
update public.application_interview_panelists
set updated_at = coalesce(removed_at, created_at, now())
where updated_at is null;

alter table public.scholarship_offers
  add column if not exists updated_at timestamptz not null default now();
update public.scholarship_offers
set updated_at = coalesce(responded_at, offered_at, now())
where updated_at is null;

create index if not exists documents_updated_at_id_idx
  on public.documents (updated_at, id);
create index if not exists notifications_profile_updated_at_id_idx
  on public.notifications (profile_id, updated_at, id);
create index if not exists application_case_officers_updated_at_id_idx
  on public.application_case_officers (updated_at, id);
create index if not exists application_interview_panelists_updated_at_id_idx
  on public.application_interview_panelists (updated_at, id);
create index if not exists scholarship_offers_updated_at_application_idx
  on public.scholarship_offers (updated_at, application_id);
create index if not exists application_grant_amounts_updated_at_application_idx
  on public.application_grant_amounts (updated_at, application_id);
create index if not exists application_waitlist_ranks_updated_at_application_idx
  on public.application_waitlist_ranks (updated_at, application_id);
create index if not exists application_documents_created_at_application_idx
  on public.application_documents (created_at, application_id);

drop trigger if exists touch_applications_updated_at on public.applications;
create trigger touch_applications_updated_at
  before update on public.applications
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_scholarships_updated_at on public.scholarships;
create trigger touch_scholarships_updated_at
  before update on public.scholarships
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_documents_updated_at on public.documents;
create trigger touch_documents_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_notifications_updated_at on public.notifications;
create trigger touch_notifications_updated_at
  before update on public.notifications
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_application_case_officers_updated_at on public.application_case_officers;
create trigger touch_application_case_officers_updated_at
  before update on public.application_case_officers
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_application_interview_panelists_updated_at on public.application_interview_panelists;
create trigger touch_application_interview_panelists_updated_at
  before update on public.application_interview_panelists
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_scholarship_offers_updated_at on public.scholarship_offers;
create trigger touch_scholarship_offers_updated_at
  before update on public.scholarship_offers
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_application_grant_amounts_updated_at on public.application_grant_amounts;
create trigger touch_application_grant_amounts_updated_at
  before update on public.application_grant_amounts
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_application_waitlist_ranks_updated_at on public.application_waitlist_ranks;
create trigger touch_application_waitlist_ranks_updated_at
  before update on public.application_waitlist_ranks
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_approval_levels_updated_at on public.approval_levels;
create trigger touch_approval_levels_updated_at
  before update on public.approval_levels
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_interview_locations_updated_at on public.interview_locations;
create trigger touch_interview_locations_updated_at
  before update on public.interview_locations
  for each row execute function public.touch_updated_at();
