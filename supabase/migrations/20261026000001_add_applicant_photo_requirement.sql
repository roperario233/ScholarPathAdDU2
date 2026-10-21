-- Two verifiable photo requirements for the in-scope AdDU tracks.
--
-- Every in-scope track now asks for a recent 2x2 ID photo of the applicant and
-- photos of their residence (the General Pool already asked for residence
-- photos). Both are ordinary Document Vault files (`Applicant Photo`,
-- `Photos of Residence`), so the Admissions Office verifies them through the
-- existing document-review pipeline and they gate submission exactly like the
-- other required documents.
--
-- The defaults live in src/lib/applicationRequirements.js; keep this backfill
-- identical. Entries are matched by title (the same rule as
-- is_addu_in_scope_track() in 20261014000001) because the catalog contains many
-- donor endowments stored as `general-pool` that the app cannot apply to. A
-- Head can remove either item per catalog entry in the Scholarship catalog.
--
-- Existing Drafts must attach both before submitting; applications already
-- submitted or past the draft stage are unaffected because the submit gate runs
-- only on the Draft -> Submitted transition.

with scoped as (
  select
    id,
    case
      when jsonb_typeof(coalesce(required_documents, '[]'::jsonb)) = 'array'
        then coalesce(required_documents, '[]'::jsonb)
      else '[]'::jsonb
    end as docs
  from public.scholarships
  where lower(btrim(coalesce(title, ''))) ~ 'jubilee|grant[ -]?in[ -]?aid|(^|[^a-z])gia([^a-z]|$)|student assistant|working scholar'
),
rebuilt as (
  select
    s.id,
    s.docs
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'applicant-photo'
           ) then '[{
             "id": "applicant-photo",
             "label": "Recent 2x2 ID photo of the applicant",
             "documentTypes": ["Applicant Photo"],
             "standing": "all"
           }]'::jsonb
           else '[]'::jsonb
         end
      || case
           when not exists (
             select 1 from jsonb_array_elements(s.docs) item
             where item ->> 'id' = 'residence-photos'
           ) then '[{
             "id": "residence-photos",
             "label": "Photos of residence",
             "documentTypes": ["Photos of Residence"],
             "standing": "all"
           }]'::jsonb
           else '[]'::jsonb
         end as docs
  from scoped s
)
update public.scholarships scholarship
set required_documents = rebuilt.docs
from rebuilt
where scholarship.id = rebuilt.id
  and scholarship.required_documents is distinct from rebuilt.docs;
