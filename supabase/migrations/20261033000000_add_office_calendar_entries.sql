-- Office calendar planning entries.
--
-- The Admissions Office calendar already derives the SOP step-5 interviews, the
-- in-scope AdDU catalog deadlines, and the recorded stage decisions from records
-- the app holds. The office also plans its own work (a verification window
-- closing, a results-release target date, an internal meeting), and no existing
-- table holds that: `custom_deadlines` is student-owned and owner-scoped, so an
-- entry written there would be invisible to the rest of the office.
--
-- The Admissions Office Head publishes and removes entries; both office lanes
-- and every Department Chair read them. Students never see them, and no
-- notification or delivery is generated for one: these are planning dates, not
-- reminders.
--
-- `id` is text because the client generates `office-<uuid>` ids, matching the
-- custom_deadlines convention so one entry keeps one identity everywhere.

create table if not exists public.office_calendar_entries (
  id text primary key,
  title text not null,
  entry_date date not null,
  kind text not null default 'office' check (kind in ('office', 'deadline', 'meeting')),
  notes text not null default '',
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists office_calendar_entries_entry_date_idx
on public.office_calendar_entries (entry_date);

alter table public.office_calendar_entries enable row level security;

drop policy if exists "staff_office_calendar_entries_read" on public.office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_insert" on public.office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_update" on public.office_calendar_entries;
drop policy if exists "admissions_head_office_calendar_entries_delete" on public.office_calendar_entries;

-- Both office lanes and Department Chairs read the office's planning dates.
create policy "staff_office_calendar_entries_read" on public.office_calendar_entries
for select using (
  public.current_profile_role() in ('admissions_office', 'admissions_head', 'department_chair')
);

-- Only the Admissions Office Head publishes, corrects, or removes an entry. The
-- update lane keeps the client's id-keyed upsert retry-safe.
create policy "admissions_head_office_calendar_entries_insert" on public.office_calendar_entries
for insert with check (public.is_admissions_head() and created_by = auth.uid());

create policy "admissions_head_office_calendar_entries_update" on public.office_calendar_entries
for update using (public.is_admissions_head()) with check (public.is_admissions_head());

create policy "admissions_head_office_calendar_entries_delete" on public.office_calendar_entries
for delete using (public.is_admissions_head());
