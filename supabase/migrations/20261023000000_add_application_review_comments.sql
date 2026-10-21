-- ---------------------------------------------------------------------------
-- Staff review comments for the endorsement workflow.
--
-- The Admissions Office and the Department Chair discuss one application in a
-- single internal thread. Comments are staff-only and append-only: there is no
-- student policy, and no update or delete policy. A Department Chair reads and
-- writes only on applications of students in the chair's department, matching
-- the review scopes already used by applications and documents.
--
-- Additive and safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.application_review_comments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid not null references public.profiles(user_id) on delete cascade,
  author_role text not null check (author_role in ('admissions_office', 'department_chair')),
  author_name text not null,
  kind text not null default 'note' check (kind in ('note', 'question', 'decision')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists application_review_comments_application_idx
  on public.application_review_comments (application_id, created_at);

alter table public.application_review_comments enable row level security;

drop policy if exists "staff_review_comments_read" on public.application_review_comments;
create policy "staff_review_comments_read" on public.application_review_comments
for select using (
  public.current_profile_role() = 'admissions_office'
  or (
    public.current_profile_role() = 'department_chair'
    and exists (
      select 1
      from public.applications a
      join public.profiles p on p.user_id = a.student_id
      where a.id = application_review_comments.application_id
        and p.department = public.current_profile_department()
    )
  )
);

drop policy if exists "staff_review_comments_insert" on public.application_review_comments;
create policy "staff_review_comments_insert" on public.application_review_comments
for insert with check (
  author_id = auth.uid()
  and author_role = public.current_profile_role()
  and (
    public.current_profile_role() = 'admissions_office'
    or (
      public.current_profile_role() = 'department_chair'
      and exists (
        select 1
        from public.applications a
        join public.profiles p on p.user_id = a.student_id
        where a.id = application_id
          and p.department = public.current_profile_department()
      )
    )
  )
);

notify pgrst, 'reload schema';
