-- Account provisioning: the Admissions Office Head invites staff and reviewer
-- accounts from inside the app instead of an operator seeding them in SQL.
--
-- How it works
--   * The Head records an invitation (email, role, and the level of the School ->
--     Cluster -> Department hierarchy the role owns) with `invite_account()`.
--   * Nothing is created for the person yet. When an account whose email is
--     CONFIRMED matches an open invitation, the profile is given the invited role
--     and scope (`claim_account_invitation()`). That happens on insert for a
--     provider that arrives verified (Google) and on the email_confirmed_at
--     transition for email/password sign-ups. A personal Gmail address works.
--   * Roles are therefore assigned only by the database, never by the client.
--     `guard_profile_privileged_columns` closes the gap that let a signed-in user
--     update their own `profiles.role` (profiles_self_read_write is `for all`).
--
-- Deploy prerequisite: Authentication -> Providers -> Email -> "Confirm email"
-- must be ON. With it off, Supabase marks an email/password account confirmed at
-- creation without proving the address, and anyone could claim an invitation by
-- signing up with the invited address.
--
-- The bootstrap Admissions Office Head is still created once by an operator.

-- 1. Account status. A deactivated account keeps its profile and history but
--    holds no role: current_profile_role() answers null for it, and that one
--    function gates every role policy.
alter table public.profiles add column if not exists deactivated_at timestamptz;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$ select role from public.profiles where user_id = auth.uid() and deactivated_at is null limit 1 $$;

-- 2. Privileged profile columns are not client-writable. Only direct client
--    sessions ('authenticated' / 'anon') are restricted: the SQL editor, the
--    service role, the auth server, and the security-definer provisioning
--    functions below run as other database roles, so they pass. This is a
--    security-invoker trigger on purpose: current_user is the caller.
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
    -- The client's profile-ensure upsert may only ever create a student.
    new.role := 'student';
    new.review_school := null;
    new.review_cluster := null;
    new.review_department := null;
    new.deactivated_at := null;
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
    raise exception 'Account role, review scope, and status are managed by the Admissions Office Head.'
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

-- 3. Invitations. Written only by the functions below.
create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  full_name text check (full_name is null or char_length(btrim(full_name)) between 1 and 200),
  role text not null check (role in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer')),
  review_school text,
  review_cluster text,
  review_department text,
  -- The school label `profiles.department` carries for a scoped reviewer (panel
  -- suggestions and the legacy Chairperson fallback compare it).
  home_school text,
  invited_by uuid references public.profiles (user_id) on delete set null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_at timestamptz,
  claimed_by uuid references public.profiles (user_id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (user_id) on delete set null,
  revoked_reason text,
  constraint account_invitations_closed_once check (claimed_at is null or revoked_at is null),
  constraint account_invitations_scope_shape check (
    (
      role in ('admissions_office', 'admissions_head')
      and review_school is null and review_cluster is null and review_department is null and home_school is null
    )
    or (
      role not in ('admissions_office', 'admissions_head')
      and home_school is not null
      and (review_school is not null or review_department is not null)
    )
  )
);

-- One open invitation per address.
create unique index if not exists account_invitations_open_email_idx
  on public.account_invitations (email)
  where claimed_at is null and revoked_at is null;

alter table public.account_invitations enable row level security;
drop policy if exists "admissions_head_account_invitations_read" on public.account_invitations;
create policy "admissions_head_account_invitations_read" on public.account_invitations
for select using (public.is_admissions_head());
revoke insert, update, delete on public.account_invitations from anon, authenticated;

-- 4. Append-only record of who provisioned what.
create table if not exists public.account_provisioning_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'invited', 'invitation_renewed', 'invitation_revoked', 'invitation_claimed',
    'scope_changed', 'deactivated', 'reactivated'
  )),
  actor_id uuid references public.profiles (user_id) on delete set null,
  actor_role text,
  target_user_id uuid references public.profiles (user_id) on delete set null,
  target_email text,
  role text,
  review_school text,
  review_cluster text,
  review_department text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists account_provisioning_log_created_idx
  on public.account_provisioning_log (created_at desc);

alter table public.account_provisioning_log enable row level security;
drop policy if exists "admissions_head_account_provisioning_log_read" on public.account_provisioning_log;
create policy "admissions_head_account_provisioning_log_read" on public.account_provisioning_log
for select using (public.is_admissions_head());
revoke insert, update, delete on public.account_provisioning_log from anon, authenticated;

-- 5. Helpers.
create or replace function public.require_admissions_head()
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null or not public.is_admissions_head() then
    raise exception 'Only the Admissions Office Head can manage accounts.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Validates a role's scope against the academic hierarchy and returns exactly the
-- levels the role owns (the shape profiles_review_scope_check and
-- reviewer_scopes_to_student() read):
--   Dean            -> review_school
--   Assistant Dean  -> review_school + review_cluster
--   Chairperson     -> review_department
--   Interviewer     -> the narrowest one level given
-- `home_school` is the school label for profiles.department.
create or replace function public.normalize_provisioned_scope(
  p_role text,
  p_school text,
  p_cluster text,
  p_department text
)
returns table (scope_school text, scope_cluster text, scope_department text, home_school text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_school text := nullif(btrim(coalesce(p_school, '')), '');
  v_cluster text := nullif(btrim(coalesce(p_cluster, '')), '');
  v_department text := nullif(btrim(coalesce(p_department, '')), '');
begin
  if p_role in ('admissions_office', 'admissions_head') then
    return query select null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_role not in ('dean', 'assistant_dean', 'department_chair', 'interviewer') then
    raise exception 'Choose a role for this account.';
  end if;
  if v_school is null then
    raise exception 'Choose the school this role belongs to.';
  end if;
  if not exists (select 1 from public.academic_programs ap where ap.school = v_school) then
    raise exception 'That school is not in the academic program catalog.';
  end if;

  if p_role = 'dean' then
    return query select v_school, null::text, null::text, v_school;
  elsif p_role = 'assistant_dean' then
    if v_cluster is null then
      raise exception 'Choose the cluster an Assistant Dean oversees.';
    end if;
    if not exists (select 1 from public.academic_programs ap where ap.school = v_school and ap.cluster = v_cluster) then
      raise exception 'That cluster does not belong to the chosen school.';
    end if;
    return query select v_school, v_cluster, null::text, v_school;
  elsif p_role = 'department_chair' then
    if v_department is null then
      raise exception 'Choose the department a Chairperson leads.';
    end if;
    if not exists (select 1 from public.academic_programs ap where ap.school = v_school and ap.department = v_department) then
      raise exception 'That department does not belong to the chosen school.';
    end if;
    return query select null::text, null::text, v_department, v_school;
  else
    -- Interviewer: one level, the narrowest provided.
    if v_department is not null then
      if not exists (select 1 from public.academic_programs ap where ap.school = v_school and ap.department = v_department) then
        raise exception 'That department does not belong to the chosen school.';
      end if;
      return query select null::text, null::text, v_department, v_school;
    elsif v_cluster is not null then
      if not exists (select 1 from public.academic_programs ap where ap.school = v_school and ap.cluster = v_cluster) then
        raise exception 'That cluster does not belong to the chosen school.';
      end if;
      return query select v_school, v_cluster, null::text, v_school;
    else
      return query select v_school, null::text, null::text, v_school;
    end if;
  end if;
end;
$$;

revoke all on function public.require_admissions_head() from public, anon;
grant execute on function public.require_admissions_head() to authenticated;
revoke all on function public.normalize_provisioned_scope(text, text, text, text) from public, anon, authenticated;

-- 6. Claiming. Called only from the auth triggers below, never by a client. A
--    failure must never block sign-up or email confirmation, so callers swallow it.
create or replace function public.claim_account_invitation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_invite public.account_invitations;
begin
  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = p_user_id;
  -- An unverified address proves nothing, so it never claims a role.
  if v_email is null or v_confirmed is null then
    return;
  end if;

  select * into v_invite
    from public.account_invitations i
   where i.email = v_email
     and i.claimed_at is null
     and i.revoked_at is null
     and i.expires_at > now()
   for update;
  if not found then
    return;
  end if;

  insert into public.profiles (user_id, full_name, role, email, department, review_school, review_cluster, review_department)
  values (
    p_user_id,
    coalesce(v_invite.full_name, split_part(v_email, '@', 1)),
    v_invite.role,
    v_email,
    v_invite.home_school,
    v_invite.review_school,
    v_invite.review_cluster,
    v_invite.review_department
  )
  on conflict (user_id) do update set
    role = excluded.role,
    department = excluded.department,
    review_school = excluded.review_school,
    review_cluster = excluded.review_cluster,
    review_department = excluded.review_department,
    full_name = coalesce(v_invite.full_name, profiles.full_name),
    deactivated_at = null,
    updated_at = now();

  update public.account_invitations
     set claimed_at = now(), claimed_by = p_user_id
   where id = v_invite.id;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_user_id, target_email, role, review_school, review_cluster, review_department)
  values ('invitation_claimed', null, 'system', p_user_id, v_email, v_invite.role, v_invite.review_school, v_invite.review_cluster, v_invite.review_department);
end;
$$;

revoke all on function public.claim_account_invitation(uuid) from public, anon, authenticated;

-- New sign-ups: a provider that arrives verified claims on insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, role, email, student_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'ScholarPath user'),
    -- Public registration cannot grant privileged roles. A staff or reviewer role
    -- arrives only through an invitation the Admissions Office Head recorded.
    'student',
    new.email,
    nullif(new.raw_user_meta_data->>'student_id', '')
  )
  on conflict (user_id) do nothing;

  begin
    perform public.claim_account_invitation(new.id);
  exception when others then
    raise warning 'claim_account_invitation failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Email/password sign-ups claim once the address is confirmed.
create or replace function public.claim_invitation_on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  begin
    perform public.claim_account_invitation(new.id);
  exception when others then
    raise warning 'claim_account_invitation failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.claim_invitation_on_email_confirmed() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute procedure public.claim_invitation_on_email_confirmed();

-- 7. Head-only operations. Each one re-checks the caller and logs itself.
create or replace function public.invite_account(
  p_email text,
  p_full_name text,
  p_role text,
  p_school text default null,
  p_cluster text default null,
  p_department text default null
)
returns public.account_invitations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_scope record;
  v_row public.account_invitations;
begin
  if v_email !~ '^[^@ ]+@[^@ ]+[.][^@ ]+$' or char_length(v_email) > 320 then
    raise exception 'Enter a valid email address.';
  end if;
  if p_role is null or p_role not in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer') then
    raise exception 'Choose a role for this account.';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then
    raise exception 'An account already exists for this email address. Invite a different address, or change that account from the account list.';
  end if;

  select * into v_scope from public.normalize_provisioned_scope(p_role, p_school, p_cluster, p_department);

  -- An expired invitation never blocks a new one for the same address.
  update public.account_invitations
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'Expired - replaced by a new invitation'
   where email = v_email and claimed_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from public.account_invitations where email = v_email and claimed_at is null and revoked_at is null) then
    raise exception 'This email address already has a pending invitation.';
  end if;

  insert into public.account_invitations (email, full_name, role, review_school, review_cluster, review_department, home_school, invited_by)
  values (v_email, v_name, p_role, v_scope.scope_school, v_scope.scope_cluster, v_scope.scope_department, v_scope.home_school, v_actor)
  returning * into v_row;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_email, role, review_school, review_cluster, review_department)
  values ('invited', v_actor, 'admissions_head', v_email, p_role, v_scope.scope_school, v_scope.scope_cluster, v_scope.scope_department);

  return v_row;
end;
$$;

create or replace function public.renew_account_invitation(p_invitation_id uuid)
returns public.account_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_row public.account_invitations;
begin
  update public.account_invitations
     set expires_at = now() + interval '30 days'
   where id = p_invitation_id and claimed_at is null and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception 'That invitation is no longer open.';
  end if;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_email, role, review_school, review_cluster, review_department)
  values ('invitation_renewed', v_actor, 'admissions_head', v_row.email, v_row.role, v_row.review_school, v_row.review_cluster, v_row.review_department);
  return v_row;
end;
$$;

create or replace function public.revoke_account_invitation(p_invitation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.account_invitations;
begin
  if v_reason is null then
    raise exception 'A reason is required to revoke an invitation.';
  end if;

  update public.account_invitations
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason
   where id = p_invitation_id and claimed_at is null and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception 'That invitation is no longer open.';
  end if;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_email, role, review_school, review_cluster, review_department, reason)
  values ('invitation_revoked', v_actor, 'admissions_head', v_row.email, v_row.role, v_row.review_school, v_row.review_cluster, v_row.review_department, v_reason);
end;
$$;

create or replace function public.update_account_scope(
  p_user_id uuid,
  p_role text,
  p_school text default null,
  p_cluster text default null,
  p_department text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_old_role text;
  v_email text;
  v_scope record;
begin
  if p_user_id = v_actor then
    raise exception 'You cannot change your own account. Ask another Admissions Office Head.';
  end if;
  select p.role, p.email into v_old_role, v_email from public.profiles p where p.user_id = p_user_id;
  if not found or v_old_role = 'student' then
    raise exception 'Only staff and reviewer accounts can be changed here.';
  end if;
  if p_role is null or p_role not in ('admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer') then
    raise exception 'Choose a role for this account.';
  end if;

  select * into v_scope from public.normalize_provisioned_scope(p_role, p_school, p_cluster, p_department);

  update public.profiles
     set role = p_role,
         department = v_scope.home_school,
         review_school = v_scope.scope_school,
         review_cluster = v_scope.scope_cluster,
         review_department = v_scope.scope_department,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_user_id, target_email, role, review_school, review_cluster, review_department)
  values ('scope_changed', v_actor, 'admissions_head', p_user_id, v_email, p_role, v_scope.scope_school, v_scope.scope_cluster, v_scope.scope_department);
end;
$$;

create or replace function public.deactivate_account(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_profile public.profiles;
begin
  if v_reason is null then
    raise exception 'A reason is required to deactivate an account.';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot deactivate your own account.';
  end if;
  select * into v_profile from public.profiles p where p.user_id = p_user_id;
  if not found or v_profile.role = 'student' then
    raise exception 'Only staff and reviewer accounts can be deactivated here.';
  end if;
  if v_profile.deactivated_at is not null then
    raise exception 'That account is already deactivated.';
  end if;

  update public.profiles set deactivated_at = now(), updated_at = now() where user_id = p_user_id;

  -- End the person's open sessions so a refresh token cannot outlive the
  -- deactivation; an access token already issued expires on its own and holds no
  -- role in the meantime (current_profile_role() is null).
  begin
    delete from auth.sessions where user_id = p_user_id;
  exception when others then
    raise warning 'Could not end sessions for %: %', p_user_id, sqlerrm;
  end;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_user_id, target_email, role, review_school, review_cluster, review_department, reason)
  values ('deactivated', v_actor, 'admissions_head', p_user_id, v_profile.email, v_profile.role, v_profile.review_school, v_profile.review_cluster, v_profile.review_department, v_reason);
end;
$$;

create or replace function public.reactivate_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_admissions_head();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles p where p.user_id = p_user_id;
  if not found or v_profile.role = 'student' or v_profile.deactivated_at is null then
    raise exception 'That account is not deactivated.';
  end if;

  update public.profiles set deactivated_at = null, updated_at = now() where user_id = p_user_id;

  insert into public.account_provisioning_log (action, actor_id, actor_role, target_user_id, target_email, role, review_school, review_cluster, review_department)
  values ('reactivated', v_actor, 'admissions_head', p_user_id, v_profile.email, v_profile.role, v_profile.review_school, v_profile.review_cluster, v_profile.review_department);
end;
$$;

revoke all on function public.invite_account(text, text, text, text, text, text) from public, anon;
revoke all on function public.renew_account_invitation(uuid) from public, anon;
revoke all on function public.revoke_account_invitation(uuid, text) from public, anon;
revoke all on function public.update_account_scope(uuid, text, text, text, text) from public, anon;
revoke all on function public.deactivate_account(uuid, text) from public, anon;
revoke all on function public.reactivate_account(uuid) from public, anon;
grant execute on function public.invite_account(text, text, text, text, text, text) to authenticated;
grant execute on function public.renew_account_invitation(uuid) to authenticated;
grant execute on function public.revoke_account_invitation(uuid, text) to authenticated;
grant execute on function public.update_account_scope(uuid, text, text, text, text) to authenticated;
grant execute on function public.deactivate_account(uuid, text) to authenticated;
grant execute on function public.reactivate_account(uuid) to authenticated;
