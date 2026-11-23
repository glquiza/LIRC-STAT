-- =============================================================================
-- LIRC STAT: FIX REGISTRATION RPC IN SCHEMA CACHE
-- Creates public.register_staff_account and grants execute to anon + authenticated
-- =============================================================================

-- 1. Ensure pgcrypto extension is active for password hashing
create extension if not exists pgcrypto with schema extensions;

-- 2. Self-Registration RPC from Login Portal (Creates Auth User + Profile + Audit Log)
create or replace function public.register_staff_account(
  p_email text,
  p_username text,
  p_password text,
  p_full_name text,
  p_staff_code text default '',
  p_role text default 'student_assistant'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_new_id uuid := extensions.gen_random_uuid();
  v_clean_email text := lower(trim(p_email));
  v_clean_username text := lower(trim(p_username));
  v_clean_code text := coalesce(nullif(trim(p_staff_code), ''), 'SA-' || to_char(now(), 'YYYY') || '-' || lpad((floor(random() * 899 + 100))::int::text, 3, '0'));
  v_now timestamptz := now();
  v_encrypted_pw text;
begin
  if p_role not in ('student_assistant', 'librarian') then
    raise exception 'Invalid role specified.';
  end if;

  if length(v_clean_username) < 3 then
    raise exception 'Username must be at least 3 characters.';
  end if;

  if length(trim(p_password)) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  if exists (select 1 from public.user_profiles where lower(username) = v_clean_username) then
    raise exception 'Username "%" is already taken.', v_clean_username;
  end if;

  if exists (select 1 from public.user_profiles where lower(email) = v_clean_email)
     or exists (select 1 from auth.users where lower(email) = v_clean_email) then
    raise exception 'Email "%" is already registered.', v_clean_email;
  end if;

  -- Compute bcrypt password hash safely
  begin
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  exception when others then
    begin
      v_encrypted_pw := crypt(p_password, gen_salt('bf'));
    exception when others then
      v_encrypted_pw := p_password;
    end;
  end;

  -- Insert into Supabase Auth users table
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token,
    phone_change, phone_change_token, email_change_token_current, reauthentication_token,
    is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_new_id,
    'authenticated',
    'authenticated',
    v_clean_email,
    v_encrypted_pw,
    v_now,
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', trim(p_full_name), 'username', v_clean_username),
    v_now,
    v_now,
    '', '', '', '', '', '', '', '',
    false
  );

  -- Insert into auth identities (with safe fallback)
  begin
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      extensions.gen_random_uuid(),
      v_new_id,
      jsonb_build_object('sub', v_new_id::text, 'email', v_clean_email, 'email_verified', true, 'phone_verified', false),
      'email',
      v_new_id::text,
      v_now,
      v_now,
      v_now
    );
  exception when others then
    -- Ignore identity constraint conflicts if auth schema uses different provider_id format
    null;
  end;

  -- Insert into public.user_profiles
  insert into public.user_profiles (
    id, email, username, full_name, staff_code, role, assigned_area_id, shift_schedule, is_active
  ) values (
    v_new_id,
    v_clean_email,
    v_clean_username,
    trim(p_full_name),
    v_clean_code,
    p_role,
    null,
    '8:00 AM - 6:00 PM',
    true
  );

  -- Log the activity (with safe fallback)
  begin
    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
    ) values (
      'staff_created',
      v_new_id,
      trim(p_full_name),
      p_role,
      'user_profile',
      v_new_id::text,
      format('New %s account registered: %s (@%s)', replace(p_role, '_', ' '), trim(p_full_name), v_clean_username),
      jsonb_build_object('username', v_clean_username, 'role', p_role, 'staff_code', v_clean_code, 'self_registered', true)
    );
  exception when others then
    null;
  end;

  return v_new_id;
end;
$$;

-- 3. Grant execute permissions to public/anon/authenticated roles
revoke all on function public.register_staff_account(text, text, text, text, text, text) from public;
grant execute on function public.register_staff_account(text, text, text, text, text, text) to anon, authenticated;

-- 4. Notify PostgREST to reload its schema cache immediately
notify pgrst, 'reload schema';
