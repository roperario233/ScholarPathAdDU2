-- Corrects the AdDU Higher Education Unit (Jacinto Campus) undergraduate academic
-- hierarchy to four levels:
--
--   School -> Cluster -> Department -> Degree program
--
-- Before this migration `academic_programs` held only three, with the School level
-- stored in a column named `department` and the Cluster level stored in `category`
-- (a name that meant nothing). Three retired school names were still live:
--   * "College of Arts and Sciences (CAS)"      -> School of Arts and Sciences (SAS)
--   * "College of Business (COB)"               -> School of Business and Governance (SBG)
--   * "College of Computer Studies (CCS)"       -> removed as a school; Computer
--                                                  Studies becomes a SAS cluster
--
-- `value` is never renamed. It is the key written into `profiles.degree_program`,
-- compared against `scholarships.eligible_degrees`, and frozen into every
-- submitted application's profile snapshot, so only `label`, `school`, `cluster`,
-- and `department` change here.
--
-- `profiles.department` keeps holding the SCHOOL (it is the reviewer scope label in
-- the sidebar and the identity line), so step 7 re-scopes the stored school strings
-- to the corrected names. Historical snapshots keep the name they were written
-- with: `applications.profile_snapshot`, `applications.interview.school`, and
-- `department_reviews.department` are records of what was true at the time and are
-- deliberately not rewritten.
--
-- Mirrors src/lib/academicPrograms.js. Apply this before deploying a frontend that
-- reads the hierarchy; `loadSupabaseAcademicPrograms()` falls back to the bundled
-- catalog while the columns are missing, so the app stays readable either way.

-- 1. The School level already holds the school, so it keeps its data and takes the
--    correct name. `department` is then free to become the level it always meant.
alter table public.academic_programs rename column department to school;

alter table public.academic_programs add column if not exists cluster text;
alter table public.academic_programs add column if not exists department text;

-- 2. `category` was the misnamed cluster. `cluster` replaces it, so the duplicate
--    cannot drift.
alter table public.academic_programs drop column if exists category;

-- 3. The two programs the corrected hierarchy added. They are inserted first so the
--    department backfill below applies to them like every other row.
insert into public.academic_programs (value, label, school, cluster, department, sort_order) values
  ('BS Physics', 'BS Physics', 'School of Arts and Sciences (SAS)', 'Natural Sciences and Mathematics', 'Physics Department', 0),
  ('Bachelor of Early Childhood Education', 'Bachelor of Early Childhood Education', 'School of Education (SOE)', null, 'Teacher Education Department', 0)
on conflict (value) do update set
  label = excluded.label,
  school = excluded.school,
  cluster = excluded.cluster,
  department = excluded.department,
  updated_at = now();

-- 4. Retire the three "College of ..." school names. The CCS programs merge into
--    SAS because Computer Studies is a cluster there, not a school.
update public.academic_programs
set school = case school
    when 'College of Arts and Sciences (CAS)' then 'School of Arts and Sciences (SAS)'
    when 'College of Computer Studies (CCS)' then 'School of Arts and Sciences (SAS)'
    when 'College of Business (COB)' then 'School of Business and Governance (SBG)'
    else school
  end,
  updated_at = now()
where school in (
  'College of Arts and Sciences (CAS)',
  'College of Computer Studies (CCS)',
  'College of Business (COB)'
);


-- 5. Backfill the Department level, one statement per department. Grouping by
--    department keeps the mapping auditable: a reviewer can read which programs a
--    department offers without decoding a 59-row VALUES list.
--
--    School of Arts and Sciences (SAS)
--    Cluster: Computer Studies
update public.academic_programs set cluster = 'Computer Studies', department = 'Computer Science Department'
where value in ('BS Computer Science', 'BS Data Science');

update public.academic_programs set cluster = 'Computer Studies', department = 'Information Technology and Information Systems Department'
where value in ('BS Information Systems', 'BS Information Technology');

--    Cluster: Natural Sciences and Mathematics
update public.academic_programs set cluster = 'Natural Sciences and Mathematics', department = 'Biology Department'
where value in ('BS Biology Major in General Biology', 'BS Biology Major in Medical Biology');

update public.academic_programs set cluster = 'Natural Sciences and Mathematics', department = 'Chemistry Department'
where value in ('BS Chemistry');

update public.academic_programs set cluster = 'Natural Sciences and Mathematics', department = 'Environmental Science Department'
where value in ('BS Environmental Science');

update public.academic_programs set cluster = 'Natural Sciences and Mathematics', department = 'Mathematics Department'
where value in ('BS Mathematics');

update public.academic_programs set cluster = 'Natural Sciences and Mathematics', department = 'Physics Department'
where value in ('BS Physics');

--    Cluster: Social Sciences
update public.academic_programs set cluster = 'Social Sciences', department = 'Anthropology Department'
where value in ('AB Anthropology');

update public.academic_programs set cluster = 'Social Sciences', department = 'Development Studies Department'
where value in ('AB Development Studies');

update public.academic_programs set cluster = 'Social Sciences', department = 'Economics Department'
where value in ('AB Economics');

update public.academic_programs set cluster = 'Social Sciences', department = 'International Studies Department'
where value in ('AB International Studies Major in American Studies', 'AB International Studies Major in Asian Studies');

update public.academic_programs set cluster = 'Social Sciences', department = 'Islamic Studies Department'
where value in ('AB Islamic Studies Minor in Education');

update public.academic_programs set cluster = 'Social Sciences', department = 'Political Science and History Department'
where value in ('AB Political Science');

update public.academic_programs set cluster = 'Social Sciences', department = 'Psychology Department'
where value in ('AB Psychology', 'BS Psychology');

update public.academic_programs set cluster = 'Social Sciences', department = 'Social Work Department'
where value in ('BS Social Work');

update public.academic_programs set cluster = 'Social Sciences', department = 'Sociology Department'
where value in ('BS Sociology');

--    Cluster: Humanities and Letters
update public.academic_programs set cluster = 'Humanities and Letters', department = 'Communication Department'
where value in ('AB Communications');

update public.academic_programs set cluster = 'Humanities and Letters', department = 'Languages, Literature, and Arts Department'
where value in (
  'AB English Language',
  'AB Interdisciplinary Studies Minor in Language and Literature',
  'AB Interdisciplinary Studies Minor in Media and Business',
  'AB Interdisciplinary Studies Minor in Media and Philosophy',
  'AB Interdisciplinary Studies Minor in Media and Technology',
  'AB Interdisciplinary Studies Minor in Philosophy and Theology'
);

update public.academic_programs set cluster = 'Humanities and Letters', department = 'Philosophy Department'
where value in ('AB Philosophy');


--    School of Business and Governance (SBG)
--    Cluster: Accountancy
update public.academic_programs set cluster = 'Accountancy', department = 'Accountancy Department'
where value in ('BS Accountancy');

update public.academic_programs set cluster = 'Accountancy', department = 'Management Accounting Department'
where value in ('BS Management Accounting');

--    Cluster: Business and Management
update public.academic_programs set cluster = 'Business and Management', department = 'Business Management Department'
where value in ('BS Business Management');

update public.academic_programs set cluster = 'Business and Management', department = 'Entrepreneurship Department'
where value in ('BS Entrepreneurship', 'BS Entrepreneurship Major in Agri-Business');

update public.academic_programs set cluster = 'Business and Management', department = 'Finance Department'
where value in ('BS Finance');

update public.academic_programs set cluster = 'Business and Management', department = 'Human Resource Development and Management Department'
where value in ('BS Human Resource Development and Management');

update public.academic_programs set cluster = 'Business and Management', department = 'Marketing Department'
where value in ('BS Marketing');

update public.academic_programs set cluster = 'Business and Management', department = 'Public Management and Governance Department'
where value in ('BS Public Management');

--    School of Engineering and Architecture (SEA): direct under SEA, no clusters.
update public.academic_programs set cluster = null, department = 'Architecture Department'
where value in ('BS Architecture');

update public.academic_programs set cluster = null, department = 'Aerospace Engineering Department'
where value in ('BS Aerospace Engineering (Academic Research)', 'BS Aerospace Engineering (Industry and Technopreneurship)');

update public.academic_programs set cluster = null, department = 'Chemical Engineering Department'
where value in ('BS Chemical Engineering');

update public.academic_programs set cluster = null, department = 'Civil Engineering Department'
where value in (
  'BS Civil Engineering (Construction Engineering and Management)',
  'BS Civil Engineering (Structural)',
  'BS Civil Engineering (Transportation)'
);

update public.academic_programs set cluster = null, department = 'Computer Engineering Department'
where value in ('BS Computer Engineering');

update public.academic_programs set cluster = null, department = 'Electrical Engineering Department'
where value in ('BS Electrical Engineering');

update public.academic_programs set cluster = null, department = 'Electronics Engineering Department'
where value in ('BS Electronics Engineering');

update public.academic_programs set cluster = null, department = 'Industrial Engineering Department'
where value in ('BS Industrial Engineering');

update public.academic_programs set cluster = null, department = 'Mechanical Engineering Department'
where value in ('BS Mechanical Engineering');

update public.academic_programs set cluster = null, department = 'Robotics Engineering Department'
where value in ('BS Robotics Engineering');

--    School of Education (SOE): direct under SOE, no clusters.
update public.academic_programs set cluster = null, department = 'Teacher Education Department'
where value in (
  'Bachelor of Early Childhood Education',
  'Bachelor of Elementary Education',
  'Bachelor of Secondary Education',
  'Bachelor of Secondary Education Major in English',
  'Bachelor of Secondary Education Major in Mathematics',
  'Bachelor of Secondary Education Major in Science',
  'Bachelor of Secondary Education Major in Social Studies'
);

--    School of Nursing (SON): direct under SON, no clusters.
update public.academic_programs set cluster = null, department = 'Nursing Department'
where value in ('BS Nursing');

-- 6. The printed program name for the BPM. The `value` stays because profiles and
--    the catalog already reference it.
update public.academic_programs
set label = 'Bachelor of Public Management (BPM)', updated_at = now()
where value = 'BS Public Management';

-- 7. Every program now names its department, so the level is required. A cluster
--    stays nullable on purpose: SEA, SOE, and SON have no sub-clusters.
alter table public.academic_programs alter column department set not null;

-- 8. Renumber `sort_order` as school -> cluster -> department -> program, so the
--    picker renders the hierarchy in order whether it is reading Supabase or the
--    bundled catalog. The department array states the documented order; programs
--    inside a department fall back to alphabetical by value.
with ordered as (
  select id,
    row_number() over (
      order by
        array_position(array[
          'School of Arts and Sciences (SAS)',
          'School of Business and Governance (SBG)',
          'School of Engineering and Architecture (SEA)',
          'School of Education (SOE)',
          'School of Nursing (SON)'
        ], school),
        array_position(array[
          'Computer Studies',
          'Natural Sciences and Mathematics',
          'Social Sciences',
          'Humanities and Letters',
          'Accountancy',
          'Business and Management'
        ], cluster) nulls first,
        array_position(array[
          'Computer Science Department',
          'Information Technology and Information Systems Department',
          'Biology Department',
          'Chemistry Department',
          'Environmental Science Department',
          'Mathematics Department',
          'Physics Department',
          'Anthropology Department',
          'Development Studies Department',
          'Economics Department',
          'International Studies Department',
          'Islamic Studies Department',
          'Political Science and History Department',
          'Psychology Department',
          'Social Work Department',
          'Sociology Department',
          'Communication Department',
          'Languages, Literature, and Arts Department',
          'Philosophy Department',
          'Accountancy Department',
          'Management Accounting Department',
          'Business Management Department',
          'Entrepreneurship Department',
          'Finance Department',
          'Human Resource Development and Management Department',
          'Marketing Department',
          'Public Management and Governance Department',
          'Architecture Department',
          'Aerospace Engineering Department',
          'Chemical Engineering Department',
          'Civil Engineering Department',
          'Computer Engineering Department',
          'Electrical Engineering Department',
          'Electronics Engineering Department',
          'Industrial Engineering Department',
          'Mechanical Engineering Department',
          'Robotics Engineering Department',
          'Teacher Education Department',
          'Nursing Department'
        ], department),
        value
    ) - 1 as sort_order
  from public.academic_programs
)
update public.academic_programs ap
set sort_order = ordered.sort_order, updated_at = now()
from ordered
where ap.id = ordered.id;

-- 9. `profiles.department` stores the school, so the stored scope strings move to
--    the corrected names in the same transaction. Without this a Department Chair
--    scoped to "College of Computer Studies (CCS)" and a student whose program now
--    reports "School of Arts and Sciences (SAS)" would never match.
update public.profiles
set department = 'School of Arts and Sciences (SAS)', updated_at = now()
where department in ('College of Arts and Sciences (CAS)', 'College of Computer Studies (CCS)');

update public.profiles
set department = 'School of Business and Governance (SBG)', updated_at = now()
where department = 'College of Business (COB)';

-- Verification (run after applying):
--   select school, cluster, department, count(*)
--     from public.academic_programs group by 1, 2, 3 order by 1, 2, 3;
--   select role, department, count(*) from public.profiles group by 1, 2 order by 1, 2;
--   select count(*) from public.academic_programs;                 -- expect 59
--   select count(*) from public.academic_programs
--    where school like 'College of%' or department is null;        -- expect 0

