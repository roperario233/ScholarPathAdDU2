-- Controlled operator import for already-provisioned students. The import RPC
-- writes a complete Submitted application graph without producing submit
-- notifications, and rechecks the business gates that service-role writes would
-- otherwise bypass in enforce_student_application_update().
create table if not exists public.application_import_batches (
  id uuid primary key,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'completed', 'partial')),
  attempted_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.application_import_records (
  source_key text primary key check (source_key ~ '^[0-9a-f]{64}$'),
  batch_id uuid not null references public.application_import_batches(id) on delete cascade,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  imported_at timestamptz not null default now()
);
create index if not exists application_import_records_batch_idx
  on public.application_import_records (batch_id, imported_at);

alter table public.application_import_batches enable row level security;
alter table public.application_import_records enable row level security;
revoke all on public.application_import_batches from public, anon, authenticated;
revoke all on public.application_import_records from public, anon, authenticated;
grant select on public.application_import_batches to service_role;
grant select on public.application_import_records to service_role;

create or replace function public.application_import_profile_answers(p_snapshot jsonb, p_financial_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'fullName', p_snapshot ->> 'fullName',
    'studentNumber', p_snapshot ->> 'studentNumber',
    'degreeProgram', p_snapshot ->> 'degreeProgram',
    'department', p_snapshot ->> 'department',
    'yearStanding', p_snapshot ->> 'yearStanding',
    'isTransferee', p_snapshot #>> '{eligibility,isTransferee}',
    'qpi', case when p_snapshot #>> '{academic,credential}' = 'qpi' then p_snapshot #>> '{academic,value}' end,
    'hsAverage', case when p_snapshot #>> '{academic,credential}' = 'hsAverage' then p_snapshot #>> '{academic,value}' end,
    'householdIncome', p_snapshot #>> '{householdIncome,value}',
    'citizenship', p_snapshot #>> '{citizenship,value}',
    'academicStanding', p_snapshot #>> '{eligibility,academicStanding,value}',
    'honorsRank', p_snapshot #>> '{eligibility,honorsRank,value}',
    'graduatingClassSize', p_snapshot #>> '{eligibility,graduatingClassSize}',
    'isOnPrepaidPlan', coalesce(p_snapshot #> '{eligibility,isOnPrepaidPlan}', 'false'::jsonb),
    'hasSiblingOnAid', coalesce(p_snapshot #> '{eligibility,hasSiblingOnAid}', 'false'::jsonb),
    'hasOtherActiveScholarship', coalesce(p_snapshot #> '{eligibility,hasOtherActiveScholarship}', 'false'::jsonb),
    'hsStrand', p_snapshot #>> '{eligibility,hsStrand}',
    'programChoice2', p_snapshot #>> '{eligibility,programChoices,0}',
    'programChoice3', p_snapshot #>> '{eligibility,programChoices,1}',
    'ipCommunity', p_snapshot #>> '{background,ipCommunity,value}',
    'pwd', p_snapshot #>> '{background,pwd,value}',
    'employed', p_snapshot #>> '{background,employed,value}',
    'ipGroupName', p_snapshot #>> '{background,ipGroupName}',
    'civilStatus', p_snapshot #>> '{personal,civilStatus}',
    'religion', p_snapshot #>> '{personal,religion}',
    'religionOther', p_snapshot #>> '{personal,religionOther}',
    'birthdate', p_snapshot #>> '{personal,birthdate}',
    'sexAtBirth', p_snapshot #>> '{personal,sexAtBirth}',
    'pronouns', p_snapshot #>> '{personal,pronouns}',
    'phone', p_snapshot #>> '{personal,phone}',
    'completeAddress', p_snapshot #>> '{address,completeAddress}',
    'residingAddress', p_snapshot #>> '{address,residingAddress}',
    'country', p_snapshot #>> '{address,country}',
    'housingType', p_snapshot #>> '{address,housingType}',
    'housingOther', p_snapshot #>> '{address,housingOther}',
    'schoolLastAttended', coalesce(p_snapshot #> '{education,schoolLastAttended}', '{}'::jsonb),
    'awards', coalesce(p_snapshot #>> '{education,awards}', ''),
    'awardsNone', coalesce(nullif(btrim(p_snapshot #>> '{education,awards}'), '') is null, false),
    'familyDetails', coalesce(p_snapshot -> 'family', '{}'::jsonb)
      || jsonb_build_object(
        'siblingsNone', public.jsonb_array_empty(p_snapshot #> '{family,siblings}'),
        'householdAdultsNone', public.jsonb_array_empty(p_snapshot #> '{family,householdAdults}')
      ),
    'previousGrants', coalesce(p_snapshot #> '{aid,previousGrants}', '[]'::jsonb),
    'previousGrantsAnswered', case
      when public.jsonb_array_empty(p_snapshot #> '{aid,previousGrants}') then 'No'
      else 'Yes'
    end,
    'communityService', p_snapshot #>> '{aid,communityService}',
    'financialProfile', coalesce(p_financial_snapshot, '{}'::jsonb)
  );
$$;
revoke all on function public.application_import_profile_answers(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.import_submitted_application_batch(
  p_batch_id uuid,
  p_manifest_hash text,
  p_records jsonb,
  p_finalize boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.application_import_batches%rowtype;
  v_record jsonb;
  v_application jsonb;
  v_document jsonb;
  v_existing public.application_import_records%rowtype;
  v_existing_document public.documents%rowtype;
  v_owner_id uuid;
  v_scholarship_id uuid;
  v_application_id uuid;
  v_submitted_at timestamptz;
  v_certified_at timestamptz;
  v_academic_value numeric;
  v_academic_floor numeric;
  v_income numeric;
  v_profile jsonb;
  v_missing text;
  v_standing text;
  v_is_incoming boolean;
  v_scholarship public.scholarships%rowtype;
  v_financial_profile jsonb;
  v_documents jsonb;
  v_item jsonb;
  v_types text[];
  v_keys text[];
  v_covered text[];
  v_claim text;
  v_source_key text;
  v_payload_hash text;
  v_document_id uuid;
  v_index integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_application_ids jsonb := '[]'::jsonb;
  v_record_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Application import requires the service role.' using errcode = '42501';
  end if;
  if p_batch_id is null or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A batch UUID and SHA-256 manifest hash are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_records, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 25 then
    raise exception 'Each import request must contain at most 25 records.' using errcode = '22023';
  end if;

  insert into public.application_import_batches (id, manifest_hash)
  values (p_batch_id, p_manifest_hash)
  on conflict (id) do nothing;
  select * into v_batch from public.application_import_batches where id = p_batch_id for update;
  if v_batch.manifest_hash <> p_manifest_hash then
    raise exception 'The batch ID is already associated with a different manifest.' using errcode = '23505';
  end if;

  for v_record in select value from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_index := v_index + 1;
    begin
      v_application := v_record -> 'application';
      v_documents := v_record -> 'documents';
      v_source_key := v_record ->> 'source_key';
      v_payload_hash := v_record ->> 'payload_hash';

      v_covered := '{}'::text[];
      if jsonb_typeof(v_application) is distinct from 'object'
        or jsonb_typeof(v_documents) is distinct from 'array'
        or coalesce(v_source_key, '') !~ '^[0-9a-f]{64}$'
        or coalesce(v_payload_hash, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'The record manifest shape is invalid.' using errcode = '22023';
      end if;
      if jsonb_array_length(v_documents) < 1 or jsonb_array_length(v_documents) > 50 then
        raise exception 'A submitted application must include 1 to 50 document records.' using errcode = '22023';
      end if;

      select * into v_existing
      from public.application_import_records
      where source_key = v_source_key
      for update;
      if found then
        if v_existing.payload_hash <> v_payload_hash then
          raise exception 'An imported source record changed after it was committed.' using errcode = '23505';
        end if;
        v_skipped := v_skipped + 1;
        v_application_ids := v_application_ids || jsonb_build_array(v_existing.application_id);
        continue;
      end if;

      v_application_id := nullif(v_application ->> 'id', '')::uuid;
      v_owner_id := nullif(v_application ->> 'student_id', '')::uuid;
      v_scholarship_id := nullif(v_application ->> 'scholarship_id', '')::uuid;
      v_submitted_at := nullif(v_application ->> 'submitted_at', '')::timestamptz;
      v_certified_at := nullif(v_application ->> 'certified_at', '')::timestamptz;
      if v_application_id is null or v_owner_id is null or v_scholarship_id is null
        or v_submitted_at is null or v_certified_at is null
        or v_submitted_at > now() + interval '5 minutes'
        or v_certified_at > now() + interval '5 minutes'
        or nullif(btrim(v_application ->> 'statement'), '') is null
        or jsonb_typeof(v_application -> 'profile_snapshot') is distinct from 'object'
        or coalesce((v_application #>> '{profile_snapshot,version}')::integer, 0) <> 4
        or jsonb_typeof(v_application -> 'financial_snapshot') is distinct from 'object'
        or (v_application -> 'financial_snapshot') = '{}'::jsonb
        or jsonb_typeof(v_application -> 'financial_answers') is distinct from 'object' then
        raise exception 'The Submitted application is missing required form, snapshot, or date fields.' using errcode = '23514';
      end if;

      if exists (
        select 1 from jsonb_object_keys(v_application) as fields(key)
        where fields.key not in ('id', 'student_id', 'scholarship_id', 'submitted_at', 'certified_at', 'statement', 'profile_snapshot', 'financial_snapshot', 'financial_answers')
      ) then
        raise exception 'The application record contains unsupported fields.' using errcode = '22023';
      end if;

      if exists (select 1 from public.applications a where a.id = v_application_id) then
        raise exception 'The application UUID is already in use.' using errcode = '23505';
      end if;
      if exists (
        select 1 from public.applications a
        where a.student_id = v_owner_id
          and a.scholarship_id = v_scholarship_id
          and a.status not in ('Draft', 'Released', 'Declined', 'Rejected')
      ) then
        raise exception 'The student already has an open application for this scholarship.' using errcode = '23505';
      end if;
      if not exists (
        select 1 from public.profiles p
        where p.user_id = v_owner_id
          and p.role = 'student'
          and p.deactivated_at is null
      ) then
        raise exception 'The owner must be an active, already-provisioned student.' using errcode = '23514';
      end if;

      select * into v_scholarship from public.scholarships where id = v_scholarship_id;
      if not found or coalesce(v_scholarship.is_external, true)
        or not coalesce(v_scholarship.is_matchable, false)
        or coalesce(v_scholarship.rule_family, '') not in ('general-pool', 'honors', 'work-study')
        or not public.is_addu_in_scope_track(v_scholarship.title)
        or (v_scholarship.deadline is not null and v_scholarship.deadline < (v_submitted_at at time zone 'Asia/Manila')::date) then
        raise exception 'The application does not match an in-scope AdDU scholarship and valid submission date.' using errcode = '23514';
      end if;

      v_financial_profile := v_application -> 'financial_snapshot';
      v_profile := public.application_import_profile_answers(v_application -> 'profile_snapshot', v_financial_profile);
      v_missing := public.missing_application_profile_item(v_profile);
      if v_missing is not null then
        raise exception 'The owner profile is incomplete for submission: %.', v_missing using errcode = '23514';
      end if;
      v_standing := public.profile_year_standing(v_profile);
      v_is_incoming := v_standing = 'incoming-1st';
      v_income := nullif(v_profile ->> 'householdIncome', '')::numeric;
      if v_income is null or v_income < 0
        or coalesce(v_profile ->> 'citizenship', '') <> 'Filipino'
        or coalesce(v_profile ->> 'academicStanding', '') = 'disqualified'
        or coalesce(v_profile ->> 'isOnPrepaidPlan', 'false') = 'true'
        or coalesce(v_profile ->> 'hasOtherActiveScholarship', 'false') = 'true' then
        raise exception 'The submitted profile does not pass the universal or AdDU exclusion gate.' using errcode = '23514';
      end if;
      if v_is_incoming then
        v_academic_value := nullif(v_profile ->> 'hsAverage', '')::numeric;
        v_academic_floor := case when v_scholarship.rule_family = 'general-pool' then coalesce(v_scholarship.minimum_shs_average, 85) else 60 end;
        if v_academic_value is null or v_academic_value < 60 or v_academic_value > 100 or v_academic_value < v_academic_floor then
          raise exception 'The senior high school average does not meet the scholarship requirement.' using errcode = '23514';
        end if;
      else
        v_academic_value := nullif(v_profile ->> 'qpi', '')::numeric;
        v_academic_floor := case when v_scholarship.rule_family = 'general-pool' then coalesce(v_scholarship.minimum_qpi, 2.5) else 0 end;
        if v_academic_value is null or v_academic_value < 0 or v_academic_value > 4 or v_academic_value < v_academic_floor then
          raise exception 'The QPI does not meet the scholarship requirement.' using errcode = '23514';
        end if;
      end if;
      if v_scholarship.rule_family = 'general-pool' then
        if v_income > coalesce(v_scholarship.maximum_income, 250000)
          or v_profile ->> 'degreeProgram' in ('BS Nursing', 'BS Architecture') then
          raise exception 'The profile does not pass the General Pool income or degree rule.' using errcode = '23514';
        end if;
      elsif v_scholarship.rule_family = 'honors' then
        if coalesce(v_profile ->> 'honorsRank', '') not in ('Valedictorian', 'Salutatorian')
          or coalesce((v_profile ->> 'graduatingClassSize')::integer, 0) < 80 then
          raise exception 'The profile does not pass the Jubilee honors or graduating-class rule.' using errcode = '23514';
        end if;
      elsif v_scholarship.rule_family = 'work-study' then
        if v_profile ->> 'degreeProgram' is null
          or not coalesce(v_profile ->> 'degreeProgram' = any(v_scholarship.eligible_degrees), false) then
          raise exception 'The degree program is not eligible for the Working Scholar Program.' using errcode = '23514';
        end if;
      end if;
      if not public.financial_answers_complete(v_application -> 'financial_answers') then
        raise exception 'The application financial answers are incomplete.' using errcode = '23514';
      end if;
      -- INSERT bypasses update-trigger delivery hooks. The importer creates one
      -- system timeline event and audit row explicitly and sends no submit alert.
      insert into public.applications (
        id, student_id, scholarship_id, status, document_status, submitted_at,
        updated_at, timeline, statement, profile_snapshot, certified_at
      ) values (
        v_application_id, v_owner_id, v_scholarship_id, 'Submitted', 'Pending', v_submitted_at,
        now(), jsonb_build_array(jsonb_build_object(
          'id', 'ev-' || gen_random_uuid()::text,
          'stage', 'Submitted',
          'note', 'Previously submitted application imported into ScholarPath.',
          'actor', 'System',
          'at', (v_submitted_at at time zone 'Asia/Manila')::date::text
        )),
        v_application ->> 'statement', v_application -> 'profile_snapshot', v_certified_at
      );

      for v_document in select value from jsonb_array_elements(v_documents) loop
        v_document_id := nullif(v_document ->> 'id', '')::uuid;
        if v_document_id is null
          or coalesce(v_document ->> 'owner_id', '') <> v_owner_id::text
          or coalesce(v_document ->> 'storage_path', '') !~ ('^' || v_owner_id::text || '/' || v_document_id::text || '/[^/]+$')
          or nullif(btrim(v_document ->> 'document_type'), '') is null
          or nullif(btrim(v_document ->> 'file_name'), '') is null
          or jsonb_typeof(coalesce(v_document -> 'linked_attributes', '[]'::jsonb)) <> 'array'
          or jsonb_typeof(coalesce(v_document -> 'attested_values', '{}'::jsonb)) <> 'object' then
          raise exception 'A document record is missing valid owner, type, path, or proof metadata.' using errcode = '23514';
        end if;
        if not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'documents' and o.name = v_document ->> 'storage_path'
        ) then
          raise exception 'A referenced private document object is missing.' using errcode = '23514';
        end if;

        insert into public.documents (
          id, owner_id, title, file_name, document_type, storage_path,
          verification_status, linked_attributes, attested_values, uploaded_at
        ) values (
          v_document_id, v_owner_id,
          coalesce(nullif(btrim(v_document ->> 'title'), ''), v_document ->> 'document_type'),
          v_document ->> 'file_name', v_document ->> 'document_type', v_document ->> 'storage_path',
          'Pending', array(select jsonb_array_elements_text(coalesce(v_document -> 'linked_attributes', '[]'::jsonb))),
          coalesce(v_document -> 'attested_values', '{}'::jsonb),
          coalesce(nullif(v_document ->> 'uploaded_at', '')::timestamptz, v_submitted_at)
        ) on conflict (id) do nothing;

        select * into v_existing_document from public.documents where id = v_document_id;
        if not found or v_existing_document.owner_id <> v_owner_id
          or v_existing_document.storage_path <> v_document ->> 'storage_path'
          or v_existing_document.document_type <> v_document ->> 'document_type'
          or v_existing_document.verification_status = 'Rejected'
          or v_existing_document.uploaded_at > v_submitted_at then
          raise exception 'A linked document is not a valid, current file owned by the student.' using errcode = '23514';
        end if;
        insert into public.application_documents (application_id, document_id)
        values (v_application_id, v_document_id)
        on conflict (application_id, document_id) do nothing;
      end loop;

      for v_item in select value from jsonb_array_elements(coalesce(v_scholarship.required_documents, '[]'::jsonb)) loop
        if (v_item ->> 'standing') = 'incoming' and not v_is_incoming then continue; end if;
        if (v_item ->> 'standing') = 'continuing' and v_is_incoming then continue; end if;
        v_types := array(select jsonb_array_elements_text(coalesce(v_item -> 'documentTypes', '[]'::jsonb)));
        if not exists (
          select 1 from public.application_documents ad
          join public.documents d on d.id = ad.document_id
          where ad.application_id = v_application_id
            and d.verification_status <> 'Rejected'
            and d.document_type = any(v_types)
        ) then
          raise exception 'A required application document is missing.' using errcode = '23514';
        end if;

        v_keys := array(
          select distinct attr.key
          from unnest(v_types) as t(type)
          cross join lateral unnest(public.document_type_attributes(t.type, v_standing)) as attr(key)
          where public.attribute_proof_required(attr.key, v_profile)
        );
        v_covered := coalesce(v_covered, '{}'::text[]) || coalesce(v_keys, '{}'::text[]);
        if cardinality(v_keys) > 0 and not exists (
          select 1 from public.application_documents ad
          join public.documents d on d.id = ad.document_id
          where ad.application_id = v_application_id
            and d.verification_status <> 'Rejected'
            and d.document_type = any(v_types)
            and not exists (
              select 1 from unnest(v_keys) as required(key)
              where (required.key = any(d.linked_attributes) or required.key = any(public.document_type_attributes(d.document_type, v_standing)))
                and not public.document_proof_is_current(d.attested_values, d.uploaded_at, required.key, v_profile, v_submitted_at)
            )
        ) then
          raise exception 'A required document does not prove the submitted profile values.' using errcode = '23514';
        end if;
      end loop;

      foreach v_claim in array array['employed', 'honorsRank', 'ipCommunity', 'pwd'] loop
        if v_claim = any(coalesce(v_covered, '{}'::text[])) or not public.attribute_proof_required(v_claim, v_profile) then continue; end if;
        if not exists (
          select 1 from public.application_documents ad
          join public.documents d on d.id = ad.document_id
          where ad.application_id = v_application_id
            and d.verification_status <> 'Rejected'
            and v_claim = any(public.document_type_attributes(d.document_type, v_standing))
            and public.document_proof_is_current(d.attested_values, d.uploaded_at, v_claim, v_profile, v_submitted_at)
        ) then
          raise exception 'A claimed profile answer has no current attached proof.' using errcode = '23514';
        end if;
      end loop;

      insert into public.application_financial_details (application_id, student_id, answers, financial_snapshot)
      values (v_application_id, v_owner_id, v_application -> 'financial_answers', v_financial_profile);
      insert into public.application_status_log (application_id, from_status, to_status, actor_id, actor_role, reason, created_at)
      values (v_application_id, null, 'Submitted', null, 'system', 'Previously submitted application imported into ScholarPath.', v_submitted_at);
      insert into public.application_import_records (source_key, batch_id, payload_hash, application_id)
      values (v_source_key, p_batch_id, v_payload_hash, v_application_id);

      v_inserted := v_inserted + 1;
      v_application_ids := v_application_ids || jsonb_build_array(v_application_id);
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_index,
        'code', sqlstate,
        'message', left(sqlerrm, 300)
      ));
    end;
  end loop;

  update public.application_import_batches b
  set attempted_rows = b.attempted_rows + v_index,
      imported_rows = b.imported_rows + v_inserted,
      skipped_rows = b.skipped_rows + v_skipped,
      failed_rows = b.failed_rows + v_failed,
      status = case when p_finalize then case when b.failed_rows + v_failed > 0 then 'partial' else 'completed' end else 'running' end,
      completed_at = case when p_finalize then now() else null end
  where b.id = p_batch_id;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'attempted', v_index,
    'imported', v_inserted,
    'skipped', v_skipped,
    'failed', v_failed,
    'applicationIds', v_application_ids,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_submitted_application_batch(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_submitted_application_batch(uuid, text, jsonb, boolean) to service_role;
