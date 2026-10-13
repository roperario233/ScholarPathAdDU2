-- Keep application stage authority in the right workflow role. Department
-- Chairs may return a live application for central validation or endorse it;
-- terminal decisions, interviews, approval, and release stay with the central
-- Scholarship process roles described by the SOP.
drop policy if exists "chair_applications_status" on public.applications;
drop policy if exists "chair_applications_flag_for_validation" on public.applications;
drop policy if exists "chair_applications_endorse" on public.applications;
create policy "chair_applications_flag_for_validation" on public.applications
for update using (
  public.current_profile_role() = 'department_chair'
  and status in ('Submitted', 'Under Review')
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
) with check (
  public.current_profile_role() = 'department_chair'
  and status = 'For Verification'
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
);
create policy "chair_applications_endorse" on public.applications
for update using (
  public.current_profile_role() = 'department_chair'
  and status = 'For Verification'
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
) with check (
  public.current_profile_role() = 'department_chair'
  and status = 'Endorsed'
  and exists (
    select 1 from public.profiles p
    where p.user_id = applications.student_id
      and p.department = public.current_profile_department()
  )
);

-- Admissions Office administrators maintain only the AdDU internal catalog
-- through this prototype UI; external and government-linked entries remain
-- outside this management path.
drop policy if exists "admissions_office_scholarships_manage" on public.scholarships;
create policy "admissions_office_scholarships_manage" on public.scholarships
for all using (
  public.current_profile_role() = 'admissions_office'
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
) with check (
  public.current_profile_role() = 'admissions_office'
  and category = 'Internal Endowment'
  and is_external = false
  and rule_family in ('general-pool', 'honors', 'work-study')
);