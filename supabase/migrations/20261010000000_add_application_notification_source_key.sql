-- Stable source keys let the server-side status notifier safely retry an
-- application transition without duplicating the student's in-app alert.
alter table public.notifications
  add column if not exists source_key text;

create unique index if not exists notifications_profile_source_key_unique
  on public.notifications (profile_id, source_key);

-- One department-review audit record per chair/application pair; backfill-safe
-- cleanup retains the newest row if an earlier prototype run created duplicates.
delete from public.department_reviews older
using public.department_reviews newer
where older.application_id = newer.application_id
  and older.reviewer_id = newer.reviewer_id
  and older.application_id is not null
  and (older.created_at, older.id) < (newer.created_at, newer.id);

drop index if exists public.department_reviews_application_reviewer_unique;
create unique index department_reviews_application_reviewer_unique
  on public.department_reviews (application_id, reviewer_id);