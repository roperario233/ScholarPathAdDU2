-- Document Vault storage.
--
-- File bytes live in a private Supabase Storage bucket (`documents`); the
-- documents table keeps the metadata and records the object path in
-- storage_path. Viewing uses short-lived signed URLs. Students manage only their
-- own folder (documents/<auth.uid()>/<documentId>/<file>); the Admissions Office
-- reads every document; a Department Chair reads documents owned by students in
-- the chair's department (the first path segment is the owner's user_id).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents_storage_owner_access" on storage.objects;
create policy "documents_storage_owner_access" on storage.objects
for all to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "documents_storage_admissions_office_read" on storage.objects;
create policy "documents_storage_admissions_office_read" on storage.objects
for select to authenticated
using (bucket_id = 'documents' and public.current_profile_role() = 'admissions_office');

drop policy if exists "documents_storage_chair_read" on storage.objects;
create policy "documents_storage_chair_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_profile_role() = 'department_chair'
  and exists (
    select 1 from public.profiles p
    where p.user_id::text = (storage.foldername(name))[1]
      and p.department = public.current_profile_department()
  )
);

-- The matching table policy, so a Chair can also see the document metadata row
-- (mirrors chair_applications_read, scoped by the owner's department).
drop policy if exists "chair_documents_read" on public.documents;
create policy "chair_documents_read" on public.documents
for select using (
  public.current_profile_role() = 'department_chair'
  and exists (
    select 1 from public.profiles p
    where p.user_id = documents.owner_id
      and p.department = public.current_profile_department()
  )
);
