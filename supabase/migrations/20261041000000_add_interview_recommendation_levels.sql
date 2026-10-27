-- ---------------------------------------------------------------------------
-- SOP step 5 evaluation notes carry a recommendation level, not a 1-5 rating.
--
-- Consultation 2, request #7: the panel should say what it recommends (highly
-- recommended ... deferred) instead of scoring the applicant out of five, and
-- the deliberation (SOP step 6) should read that level.
--
-- Additive: `rating` stays so a note recorded earlier still displays, nothing
-- backfills a level, and the insert policy is unchanged. The level is staff-only
-- like the rest of the note (application_interview_notes has no student policy),
-- so a student never sees the panel's recommendation.
-- ---------------------------------------------------------------------------
alter table public.application_interview_notes
  add column if not exists recommendation_level text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.application_interview_notes'::regclass
       and conname = 'application_interview_notes_recommendation_level_check'
  ) then
    alter table public.application_interview_notes
      add constraint application_interview_notes_recommendation_level_check
      check (
        recommendation_level is null
        or recommendation_level in (
          'highly_recommended',
          'recommended',
          'recommended_with_reservation',
          'not_recommended',
          'deferred'
        )
      );
  end if;
end
$$;

comment on column public.application_interview_notes.recommendation_level is
  'The panel''s recommendation for this applicant (input to the SOP step 6 deliberation). Null on a note that only records observations; the legacy `rating` stays readable.';
