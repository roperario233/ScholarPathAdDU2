-- Scope Admissions Office catalog management to the three Appendix A tracks.
--
-- The system tracks only Grant-in-Aid (GIA), the Jubilee Scholarship Fund, and
-- the Student Assistant (Working Scholars) Program. The previous policy gated
-- writes on `category = 'Internal Endowment'` + rule family, which had two
-- consequences: the Head could edit the donor endowments and corporate entries
-- that shared those values, and the Student Assistant program (stored under the
-- `Specialized Service` category) could not be saved at all. The title predicate
-- is the same one the student Explorer, the application gate, and
-- enforce_student_application_update() already use
-- (is_addu_in_scope_track(), defined in 20261014000001).

drop policy if exists "admissions_office_scholarships_manage" on public.scholarships;
create policy "admissions_office_scholarships_manage" on public.scholarships
for all using (
  public.is_admissions_head()
  and public.is_addu_in_scope_track(title)
) with check (
  public.is_admissions_head()
  and public.is_addu_in_scope_track(title)
);
