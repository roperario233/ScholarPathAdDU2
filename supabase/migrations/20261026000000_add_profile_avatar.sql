-- Profile photos.
--
-- A profile photo is personal: it appears in the signed-in user's header and My
-- Profile only. It is not a Document Vault file and is never sent with an
-- application; each application asks for its own verified 2x2 ID photo instead.
--
-- The bytes live in a private `avatars` bucket and profiles.avatar_path records
-- the current object key (`<user_id>/<timestamp>-<file>`). Viewing uses a
-- short-lived signed URL, and the owner-only storage policy means no other role
-- can read someone else's avatar. The bucket is configured here so an existing
-- project and a fresh `schema.sql` install behave the same way.

alter table public.profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_owner_access" on storage.objects;
create policy "avatars_owner_access" on storage.objects
for all to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
