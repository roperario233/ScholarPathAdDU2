-- The Student Assistant (SA) Program is published as the Working Scholar
-- Program (WSP), the name the Office of Admission and Aid leaflet uses, and it
-- is open only to the programs the leaflet lists — not to every academic
-- program, as the catalog previously recorded with eligible_degrees = '{ALL}'.
--
-- Data only. public.is_addu_in_scope_track() already matches "working scholar",
-- so the renamed row stays in scope for the catalog policy and the application
-- triggers, and existing applications keep their scholarship_id. The program
-- list mirrors WORKING_SCHOLAR_ELIGIBLE_DEGREES in src/lib/eligibility.js, which
-- is the rule the Smart Eligibility Checker applies; keep the two in step.

update public.scholarships
set
  title = 'Working Scholar Program (WSP)',
  eligible_degrees = array[
    'BS Business Management',
    'BS Entrepreneurship',
    'BS Entrepreneurship Major in Agri-Business',
    'BS Finance',
    'BS Human Resource Development and Management',
    'BS Management Accounting',
    'BS Marketing',
    'BS Mathematics',
    'BS Public Management',
    'AB Communications',
    'AB Development Studies',
    'AB Economics',
    'AB English Language',
    'AB Interdisciplinary Studies Minor in Language and Literature',
    'AB Interdisciplinary Studies Minor in Media and Business',
    'AB Interdisciplinary Studies Minor in Media and Philosophy',
    'AB Interdisciplinary Studies Minor in Media and Technology',
    'AB Interdisciplinary Studies Minor in Philosophy and Theology',
    'AB International Studies Major in American Studies',
    'AB International Studies Major in Asian Studies',
    'AB Philosophy',
    'AB Political Science',
    'AB Psychology',
    'BS Sociology'
  ]::text[]
where coalesce(is_external, false) = false
  and lower(btrim(coalesce(title, ''))) ~ 'student assistant|working scholar';
