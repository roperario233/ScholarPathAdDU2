-- ---------------------------------------------------------------------------
-- Account-level privacy consent (RA 10173).
--
-- The app already discloses what it collects (the FORM 230-SCH notice, the
-- affidavit, and the cookie and storage notice), but nothing recorded that a person
-- had actually seen a notice and accepted it. This adds one version and one
-- timestamp per account:
--
--   privacy_consent_version  the notice version the account accepted
--   privacy_consented_at     when it was accepted
--
-- Both are written only by record_privacy_consent() below, and the existing
-- guard_profile_privileged_columns trigger is extended so a direct client session
-- cannot type them in. The version is free text on purpose: the client copy owns
-- the string (src/lib/legalDocs.js PRIVACY_NOTICE_VERSION), so changing the notice
-- never needs a migration, and the RPC only checks the shape.
--
-- Idempotent per version: re-recording the same version does not rewrite the
-- timestamp, so a page reload is not a new decision.
--
-- Client accompaniment (ship the migration with the client build):
--   src/lib/legalDocs.js          the copy and PRIVACY_NOTICE_VERSION
--   src/lib/privacyConsent.js     the browser-storage choice (device preference)
--   src/components/PrivacyConsentModal.jsx
--   src/lib/auth.js               getProfilePrivacyConsent / recordProfilePrivacyConsent
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists privacy_consent_version text;
alter table public.profiles add column if not exists privacy_consented_at timestamptz;

-- Shape only, never a list of allowed versions.
alter table public.profiles drop constraint if exists profiles_privacy_consent_version_check;
alter table public.profiles
  add constraint profiles_privacy_consent_version_check
  check (
    privacy_consent_version is null
    or (
      privacy_consent_version = btrim(privacy_consent_version)
      and char_length(privacy_consent_version) between 1 and 32
    )
  );

-- 2. The privilege guard, extended. It is a security-invoker trigger keyed on
--    current_user, so the SQL editor, the service role, the auth server, and the
--    security-definer RPCs below pass; only a direct 'authenticated'/'anon' session
--    is restricted.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The client's profile-ensure upsert may only ever create a student, and a
    -- fresh account has not been asked for consent yet.
    new.role := 'student';
    new.review_school := null;
    new.review_cluster := null;
    new.review_department := null;
    new.deactivated_at := null;
    new.privacy_consent_version := null;
    new.privacy_consented_at := null;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.review_school is distinct from old.review_school
     or new.review_cluster is distinct from old.review_cluster
     or new.review_department is distinct from old.review_department
     or new.deactivated_at is distinct from old.deactivated_at
     -- For staff, `department` is the school label that scopes the account. A
     -- student still writes it from their degree program.
     or (old.role <> 'student' and new.department is distinct from old.department) then
    raise exception 'Account role, review scope, and status are managed by the Admissions Office Admin.'
      using errcode = '42501';
  end if;

  -- Consent is evidence, so it is written by the RPC and never typed in directly.
  if new.privacy_consent_version is distinct from old.privacy_consent_version
     or new.privacy_consented_at is distinct from old.privacy_consented_at then
    raise exception 'Privacy consent is recorded by the app, not written directly.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute procedure public.guard_profile_privileged_columns();

-- 3. The one writer. A signed-in account records its own consent, and the function
--    re-checks the caller rather than trusting the body. It answers quietly when the
--    version is already recorded, so a reload (or a second tab) is not a new
--    decision and cannot move the timestamp.
create or replace function public.record_privacy_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := btrim(coalesce(p_version, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to record your consent.'
      using errcode = '42501';
  end if;

  if char_length(v_version) not between 1 and 32 then
    raise exception 'A privacy notice version is required.'
      using errcode = '22023';
  end if;

  update public.profiles
     set privacy_consent_version = v_version,
         privacy_consented_at = now()
   where user_id = auth.uid()
     and deactivated_at is null
     and privacy_consent_version is distinct from v_version;
end;
$$;

revoke all on function public.record_privacy_consent(text) from public;
revoke all on function public.record_privacy_consent(text) from anon;
grant execute on function public.record_privacy_consent(text) to authenticated;

notify pgrst, 'reload schema';

