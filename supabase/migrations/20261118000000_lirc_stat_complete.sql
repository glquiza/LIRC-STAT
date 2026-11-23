-- =============================================================================
-- LIRC STAT – Learning Information and Resource Center
-- Statistical Tracking and Analysis Tool
-- Complete Supabase PostgreSQL Schema, RLS Policies, RPCs & Initial Seed Data
-- =============================================================================
-- Target: Supabase Postgres 15+ / 17+
-- Timezone reference: Asia/Manila (UTC+08:00)
-- Operating schedule: 8:00 AM to 6:00 PM (21 thirty-minute intervals)
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- 1. CORE TABLES
-- -----------------------------------------------------------------------------

-- 1A. Six Monitored Library Areas
create table if not exists public.library_areas (
  id bigint generated always as identity primary key,
  code text not null unique,
  slug text not null unique,
  name text not null unique,
  description text not null default '',
  floor_location text not null default 'Main Library',
  capacity integer not null default 60 check (capacity > 0 and capacity <= 2000),
  color_hex text not null default '#2563eb',
  icon_name text not null default 'BookOpen',
  display_order integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 1B. User Profiles (Librarians & Student Assistants)
-- Note: Student Assistants are NOT permanently tied to one library area;
-- assigned_area_id is optional/informational only.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null unique,
  full_name text not null,
  staff_code text not null default '',
  role text not null check (role in ('librarian', 'student_assistant')),
  assigned_area_id bigint references public.library_areas(id) on delete set null,
  shift_schedule text not null default '8:00 AM - 6:00 PM',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_assigned_area_id_idx on public.user_profiles (assigned_area_id);
create index if not exists user_profiles_role_idx on public.user_profiles (role);
create index if not exists user_profiles_active_role_idx on public.user_profiles (is_active, role);

-- 1C. Temporary Area Monitoring Sessions
-- Activated when a Student Assistant selects an area; closed on "Exit Area".
create table if not exists public.monitoring_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  user_name text not null default '',
  staff_code text not null default '',
  area_id bigint not null references public.library_areas(id) on delete cascade,
  area_name text not null default '',
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  records_submitted integer not null default 0 check (records_submitted >= 0),
  created_at timestamptz not null default now()
);

create index if not exists monitoring_sessions_user_id_idx on public.monitoring_sessions (user_id);
create index if not exists monitoring_sessions_area_id_idx on public.monitoring_sessions (area_id);
create index if not exists monitoring_sessions_active_idx on public.monitoring_sessions (status, started_at desc) where status = 'active';
create unique index if not exists monitoring_sessions_one_active_per_user_idx on public.monitoring_sessions (user_id) where status = 'active';
create index if not exists monitoring_sessions_started_at_idx on public.monitoring_sessions (started_at desc);

-- 1D. Occupancy Records (Every 30 minutes, 8:00 AM - 6:00 PM, Duplicate-Protected)
create table if not exists public.occupancy_records (
  id bigint generated always as identity primary key,
  record_date date not null,
  time_slot text not null check (
    time_slot in (
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
      '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
      '17:00', '17:30', '18:00'
    )
  ),
  area_id bigint not null references public.library_areas(id) on delete cascade,
  occupancy_count integer not null check (occupancy_count >= 0 and occupancy_count <= 2000),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  recorded_by_name text not null default '',
  session_id bigint references public.monitoring_sessions(id) on delete set null,
  notes text not null default '',
  recorded_at timestamptz not null default now(),
  is_off_hours_entry boolean not null default false,
  is_corrected boolean not null default false,
  correction_count integer not null default 0 check (correction_count >= 0),
  last_corrected_by uuid references public.user_profiles(id) on delete set null,
  last_corrected_by_name text,
  last_corrected_at timestamptz,
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint occupancy_records_date_slot_area_unique unique (record_date, time_slot, area_id)
);

-- Ensure columns exist if upgrading an existing database
alter table public.occupancy_records add column if not exists session_id bigint references public.monitoring_sessions(id) on delete set null;
alter table public.occupancy_records add column if not exists recorded_at timestamptz not null default now();
alter table public.occupancy_records add column if not exists is_off_hours_entry boolean not null default false;
alter table public.occupancy_records add column if not exists is_corrected boolean not null default false;
alter table public.occupancy_records add column if not exists correction_count integer not null default 0;
alter table public.occupancy_records add column if not exists last_corrected_by uuid references public.user_profiles(id) on delete set null;
alter table public.occupancy_records add column if not exists last_corrected_by_name text;
alter table public.occupancy_records add column if not exists last_corrected_at timestamptz;
alter table public.occupancy_records add column if not exists correction_reason text;

create index if not exists occupancy_records_area_id_idx on public.occupancy_records (area_id);
create index if not exists occupancy_records_recorded_by_idx on public.occupancy_records (recorded_by);
create index if not exists occupancy_records_session_id_idx on public.occupancy_records (session_id);
create index if not exists occupancy_records_last_corrected_by_idx on public.occupancy_records (last_corrected_by);
create index if not exists occupancy_records_date_area_idx on public.occupancy_records (record_date, area_id);
create index if not exists occupancy_records_date_slot_idx on public.occupancy_records (record_date desc, time_slot desc);

-- 1E. Immutable System Activity Logs
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  action_type text not null check (
    action_type in (
      'occupancy_submitted',
      'record_corrected',
      'record_backfilled',
      'session_started',
      'session_ended',
      'report_generated',
      'report_exported',
      'user_login',
      'user_logout',
      'staff_created',
      'staff_updated',
      'area_updated',
      'backup_exported'
    )
  ),
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_name text not null default 'System',
  actor_role text not null default 'system',
  area_id bigint references public.library_areas(id) on delete set null,
  area_name text,
  target_type text,
  target_id text,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_actor_id_idx on public.activity_logs (actor_id);
create index if not exists activity_logs_area_id_idx on public.activity_logs (area_id);
create index if not exists activity_logs_action_type_idx on public.activity_logs (action_type);
create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);

-- 1F. Saved Statistical Reports (Specific Date, Month, or Date Range)
create table if not exists public.saved_reports (
  id bigint generated always as identity primary key,
  report_type text not null default 'monthly' check (report_type in ('daily', 'monthly', 'range')),
  start_date date not null,
  end_date date not null,
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  report_title text not null,
  total_occupancy bigint not null default 0,
  total_days_recorded integer not null default 0,
  total_missing_slots integer not null default 0,
  top_area_name text not null default '',
  export_format text not null default 'preview',
  generated_by uuid references public.user_profiles(id) on delete set null,
  generated_by_name text not null default '',
  remarks text not null default '',
  created_at timestamptz not null default now()
);

alter table public.saved_reports add column if not exists report_type text not null default 'monthly';
alter table public.saved_reports add column if not exists start_date date not null default current_date;
alter table public.saved_reports add column if not exists end_date date not null default current_date;
alter table public.saved_reports add column if not exists total_occupancy bigint not null default 0;
alter table public.saved_reports add column if not exists total_missing_slots integer not null default 0;
alter table public.saved_reports add column if not exists export_format text not null default 'preview';

create index if not exists saved_reports_generated_by_idx on public.saved_reports (generated_by);
create index if not exists saved_reports_dates_idx on public.saved_reports (start_date, end_date);
create index if not exists saved_reports_created_at_idx on public.saved_reports (created_at desc);

-- -----------------------------------------------------------------------------
-- 2. PRIVATE SECURITY HELPER FUNCTIONS (NOT EXPOSED BY POSTGREST)
-- -----------------------------------------------------------------------------

create or replace function private.is_librarian()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and up.role = 'librarian'
      and up.is_active = true
  );
$$;

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and up.is_active = true
  );
$$;

revoke all on function private.is_librarian() from public, anon;
revoke all on function private.is_active_staff() from public, anon;
grant execute on function private.is_librarian() to authenticated;
grant execute on function private.is_active_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY (RLS) & LEAST-PRIVILEGE GRANTS
-- -----------------------------------------------------------------------------

alter table public.library_areas enable row level security;
alter table public.user_profiles enable row level security;
alter table public.monitoring_sessions enable row level security;
alter table public.occupancy_records enable row level security;
alter table public.activity_logs enable row level security;
alter table public.saved_reports enable row level security;

-- Explicit table grants
grant usage on schema public to anon, authenticated;

revoke all on public.library_areas from anon;
revoke all on public.user_profiles from anon;
revoke all on public.monitoring_sessions from anon;
revoke all on public.occupancy_records from anon;
revoke all on public.activity_logs from anon;
revoke all on public.saved_reports from anon;

grant select, insert, update on public.library_areas to authenticated;
grant select, update, delete on public.user_profiles to authenticated;
grant select, insert, update on public.monitoring_sessions to authenticated;
grant select, insert, update on public.occupancy_records to authenticated;
grant select on public.activity_logs to authenticated;
grant select, insert on public.saved_reports to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- Drop old policies if re-running idempotently
drop policy if exists "library_areas_select_staff" on public.library_areas;
drop policy if exists "library_areas_manage_librarian" on public.library_areas;
drop policy if exists "library_areas_insert_librarian" on public.library_areas;
drop policy if exists "user_profiles_select_self_or_librarian" on public.user_profiles;
drop policy if exists "user_profiles_update_librarian" on public.user_profiles;
drop policy if exists "user_profiles_delete_librarian" on public.user_profiles;
drop policy if exists "monitoring_sessions_select_staff" on public.monitoring_sessions;
drop policy if exists "monitoring_sessions_insert_self" on public.monitoring_sessions;
drop policy if exists "monitoring_sessions_update_self_or_librarian" on public.monitoring_sessions;
drop policy if exists "occupancy_records_select_staff" on public.occupancy_records;
drop policy if exists "occupancy_records_insert_staff" on public.occupancy_records;
drop policy if exists "occupancy_records_update_librarian_only" on public.occupancy_records;
drop policy if exists "activity_logs_select_self_or_librarian" on public.activity_logs;
drop policy if exists "saved_reports_select_librarian" on public.saved_reports;
drop policy if exists "saved_reports_insert_librarian" on public.saved_reports;

-- library_areas policies
create policy "library_areas_select_staff"
  on public.library_areas
  for select
  to authenticated
  using ((select private.is_active_staff()));

create policy "library_areas_insert_librarian"
  on public.library_areas
  for insert
  to authenticated
  with check ((select private.is_librarian()));

create policy "library_areas_manage_librarian"
  on public.library_areas
  for update
  to authenticated
  using ((select private.is_librarian()))
  with check ((select private.is_librarian()));

-- user_profiles policies
create policy "user_profiles_select_self_or_librarian"
  on public.user_profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_librarian()));

create policy "user_profiles_update_librarian"
  on public.user_profiles
  for update
  to authenticated
  using ((select private.is_librarian()))
  with check ((select private.is_librarian()));

create policy "user_profiles_delete_librarian"
  on public.user_profiles
  for delete
  to authenticated
  using ((select private.is_librarian()) and id <> (select auth.uid()));

-- monitoring_sessions policies
create policy "monitoring_sessions_select_staff"
  on public.monitoring_sessions
  for select
  to authenticated
  using ((select private.is_active_staff()));

create policy "monitoring_sessions_insert_self"
  on public.monitoring_sessions
  for insert
  to authenticated
  with check ((select private.is_active_staff()) and user_id = (select auth.uid()));

create policy "monitoring_sessions_update_self_or_librarian"
  on public.monitoring_sessions
  for update
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_librarian()))
  with check (user_id = (select auth.uid()) or (select private.is_librarian()));

-- occupancy_records policies
-- Student Assistants can read and submit new records, NEVER overwrite/update or delete.
-- Only Librarians can UPDATE (correct) existing records. Nobody can DELETE historical records.
create policy "occupancy_records_select_staff"
  on public.occupancy_records
  for select
  to authenticated
  using ((select private.is_active_staff()));

create policy "occupancy_records_insert_staff"
  on public.occupancy_records
  for insert
  to authenticated
  with check ((select private.is_active_staff()) and recorded_by = (select auth.uid()));

create policy "occupancy_records_update_librarian_only"
  on public.occupancy_records
  for update
  to authenticated
  using ((select private.is_active_staff()))
  with check ((select private.is_active_staff()));

-- activity_logs policies (immutable — written strictly via audited RPCs)
create policy "activity_logs_select_self_or_librarian"
  on public.activity_logs
  for select
  to authenticated
  using (actor_id = (select auth.uid()) or (select private.is_librarian()));

-- saved_reports policies
create policy "saved_reports_select_librarian"
  on public.saved_reports
  for select
  to authenticated
  using ((select private.is_librarian()));

create policy "saved_reports_insert_librarian"
  on public.saved_reports
  for insert
  to authenticated
  with check ((select private.is_librarian()));

-- -----------------------------------------------------------------------------
-- 4. APPLICATION RPC FUNCTIONS (SERVER-SYNCHRONIZED TIME, SESSIONS, AUDIT LOGS)
-- -----------------------------------------------------------------------------

-- 4A. Public Login Directory (for one-click portal login without exposing private fields)
drop function if exists public.get_login_directory();
create or replace function public.get_login_directory()
returns table (
  id uuid,
  username text,
  email text,
  full_name text,
  staff_code text,
  role text,
  shift_schedule text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    up.id,
    up.username,
    up.email,
    up.full_name,
    up.staff_code,
    up.role,
    up.shift_schedule
  from public.user_profiles up
  where up.is_active = true
  order by
    case when up.role = 'librarian' then 0 else 1 end,
    up.staff_code asc,
    up.full_name asc;
$$;

-- 4B. Resolve username -> email for login
create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select up.email
  from public.user_profiles up
  where up.is_active = true
    and (lower(up.username) = lower(trim(p_identifier)) or lower(up.email) = lower(trim(p_identifier)))
  limit 1;
$$;

-- 4B2. Self-Registration RPC from Login Portal (Creates Auth User + Profile + Audit Log)
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
set search_path = ''
as $$
declare
  v_new_id uuid := extensions.gen_random_uuid();
  v_clean_email text := lower(trim(p_email));
  v_clean_username text := lower(trim(p_username));
  v_clean_code text := coalesce(nullif(trim(p_staff_code), ''), 'SA-' || to_char(now(), 'YYYY') || '-' || lpad((floor(random() * 899 + 100))::int::text, 3, '0'));
  v_now timestamptz := now();
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
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now,
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', trim(p_full_name), 'username', v_clean_username),
    v_now,
    v_now,
    '', '', '', '', '', '', '', '',
    false
  );

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

  return v_new_id;
end;
$$;

-- 4C. Server-Synchronized Official Clock & Active 30-Minute Interval Detection
create or replace function public.get_server_clock()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now_utc timestamptz := now();
  v_local timestamp := v_now_utc at time zone 'Asia/Manila';
  v_hour int := extract(hour from v_local)::int;
  v_minute int := extract(minute from v_local)::int;
  v_total_minutes int := v_hour * 60 + v_minute;
  v_is_operating boolean := (v_total_minutes >= 480 and v_total_minutes <= 1109); -- 08:00 to 18:29
  v_slot_minutes int;
  v_detected_slot text := null;
  v_next_boundary_mins int;
  v_seconds_into_min int := extract(second from v_local)::int;
  v_seconds_until_next int := 0;
begin
  if v_is_operating then
    v_slot_minutes := least(1080, (v_total_minutes / 30) * 30);
    v_detected_slot := lpad((v_slot_minutes / 60)::text, 2, '0') || ':' || lpad((v_slot_minutes % 60)::text, 2, '0');
    v_next_boundary_mins := ((v_total_minutes / 30) + 1) * 30;
    v_seconds_until_next := greatest(0, (v_next_boundary_mins - v_total_minutes) * 60 - v_seconds_into_min);
  end if;

  return jsonb_build_object(
    'server_utc', v_now_utc,
    'manila_timestamp', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS+08:00'),
    'record_date', to_char(v_local::date, 'YYYY-MM-DD'),
    'display_date', to_char(v_local, 'FMMonth DD, YYYY'),
    'display_time', to_char(v_local, 'FMHH12:MI:SS AM'),
    'detected_slot', v_detected_slot,
    'is_operating_hours', v_is_operating,
    'seconds_until_next_slot', v_seconds_until_next,
    'timezone', 'Asia/Manila (UTC+8)'
  );
end;
$$;

-- 4D. Start Temporary Area Monitoring Session (Student Assistant Workflow)
create or replace function public.start_monitoring_session(p_area_id bigint)
returns public.monitoring_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_area public.library_areas;
  v_session public.monitoring_sessions;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid and is_active = true;
  if not found then
    raise exception 'Active user profile not found.';
  end if;

  select * into v_area from public.library_areas where id = p_area_id and is_active = true;
  if not found then
    raise exception 'Selected library area was not found or is inactive.';
  end if;

  -- Close any existing active session for this user so one SA monitors one area at a time
  update public.monitoring_sessions
  set status = 'completed', ended_at = v_now
  where user_id = v_uid and status = 'active';

  insert into public.monitoring_sessions (
    user_id, user_name, staff_code, area_id, area_name, status, started_at, records_submitted
  ) values (
    v_profile.id, v_profile.full_name, v_profile.staff_code, v_area.id, v_area.name, 'active', v_now, 0
  )
  returning * into v_session;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'session_started',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    v_area.id,
    v_area.name,
    'monitoring_session',
    v_session.id::text,
    format('%s started monitoring %s', v_profile.full_name, v_area.name),
    jsonb_build_object('session_id', v_session.id, 'area_code', v_area.code)
  );

  return v_session;
end;
$$;

-- 4E. Exit Library Area Monitoring Session
create or replace function public.exit_monitoring_session(p_session_id bigint default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_session public.monitoring_sessions;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid and is_active = true;
  if not found then
    raise exception 'Active user profile not found.';
  end if;

  if p_session_id is not null then
    update public.monitoring_sessions
    set status = 'completed', ended_at = v_now
    where id = p_session_id and user_id = v_uid and status = 'active'
    returning * into v_session;
  else
    update public.monitoring_sessions
    set status = 'completed', ended_at = v_now
    where user_id = v_uid and status = 'active'
    returning * into v_session;
  end if;

  if found then
    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
    ) values (
      'session_ended',
      v_profile.id,
      v_profile.full_name,
      v_profile.role,
      v_session.area_id,
      v_session.area_name,
      'monitoring_session',
      v_session.id::text,
      format('%s exited %s (%s record(s) submitted)', v_profile.full_name, v_session.area_name, v_session.records_submitted),
      jsonb_build_object('session_id', v_session.id, 'records_submitted', v_session.records_submitted)
    );
    return true;
  end if;

  return false;
end;
$$;

-- 4F. Submit Occupancy Record (Server-Time Auto-Interval, Strict Duplicate Blocking, Audit Log)
create or replace function public.submit_occupancy_record(
  p_area_id bigint,
  p_occupancy_count integer,
  p_notes text default '',
  p_session_id bigint default null,
  p_fallback_slot text default null
)
returns public.occupancy_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_area public.library_areas;
  v_now_utc timestamptz := now();
  v_local timestamp := v_now_utc at time zone 'Asia/Manila';
  v_record_date date := v_local::date;
  v_total_minutes int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_is_operating boolean := (v_total_minutes >= 480 and v_total_minutes <= 1109);
  v_slot_minutes int;
  v_time_slot text;
  v_is_off_hours boolean := false;
  v_existing_id bigint;
  v_record public.occupancy_records;
  v_valid_slots text[] := array[
    '08:00','08:30','09:00','09:30','10:00','10:30',
    '11:00','11:30','12:00','12:30','13:00','13:30',
    '14:00','14:30','15:00','15:30','16:00','16:30',
    '17:00','17:30','18:00'
  ];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid and is_active = true;
  if not found then
    raise exception 'Active staff account required.';
  end if;

  if p_occupancy_count is null or p_occupancy_count < 0 or p_occupancy_count > 2000 then
    raise exception 'INVALID_COUNT: Student occupancy count must be an integer between 0 and 2000.';
  end if;

  select * into v_area from public.library_areas where id = p_area_id and is_active = true;
  if not found then
    raise exception 'Selected library area was not found.';
  end if;

  -- Server-synchronized interval detection (cannot be tampered with during operating hours)
  if v_is_operating then
    v_slot_minutes := least(1080, (v_total_minutes / 30) * 30);
    v_time_slot := lpad((v_slot_minutes / 60)::text, 2, '0') || ':' || lpad((v_slot_minutes % 60)::text, 2, '0');
    v_is_off_hours := false;
  else
    -- Testing / Off-Hours Fallback (timestamps remain strictly server-synchronized)
    if p_fallback_slot is null or not (p_fallback_slot = any(v_valid_slots)) then
      raise exception 'OFF_HOURS_SLOT_REQUIRED: Outside library operating hours (8:00 AM - 6:00 PM). Select a valid 30-minute interval for off-hours recording.';
    end if;
    v_time_slot := p_fallback_slot;
    v_is_off_hours := true;
  end if;

  -- Strict duplicate prevention
  select id into v_existing_id
  from public.occupancy_records
  where record_date = v_record_date
    and time_slot = v_time_slot
    and area_id = p_area_id;

  if v_existing_id is not null then
    raise exception 'DUPLICATE_RECORD: An occupancy record already exists for % at % on %. Duplicate submissions are blocked; contact the Librarian for authorized corrections.',
      v_area.name, v_time_slot, to_char(v_record_date, 'Mon DD, YYYY');
  end if;

  insert into public.occupancy_records (
    record_date,
    time_slot,
    area_id,
    occupancy_count,
    recorded_by,
    recorded_by_name,
    session_id,
    notes,
    recorded_at,
    is_off_hours_entry,
    created_at,
    updated_at
  ) values (
    v_record_date,
    v_time_slot,
    v_area.id,
    p_occupancy_count,
    v_profile.id,
    v_profile.full_name,
    p_session_id,
    coalesce(trim(p_notes), ''),
    v_now_utc,
    v_is_off_hours,
    v_now_utc,
    v_now_utc
  )
  returning * into v_record;

  -- Increment session record count if attached to an active session
  if p_session_id is not null then
    update public.monitoring_sessions
    set records_submitted = records_submitted + 1
    where id = p_session_id and user_id = v_profile.id;
  end if;

  -- Immutable Activity Log entry
  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'occupancy_submitted',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    v_area.id,
    v_area.name,
    'occupancy_record',
    v_record.id::text,
    format('%s recorded %s students in %s (%s • %s)', v_profile.full_name, p_occupancy_count, v_area.name, to_char(v_record_date, 'Mon DD, YYYY'), v_time_slot),
    jsonb_build_object(
      'record_id', v_record.id,
      'record_date', v_record_date,
      'time_slot', v_time_slot,
      'occupancy_count', p_occupancy_count,
      'is_off_hours_entry', v_is_off_hours,
      'session_id', p_session_id,
      'notes', coalesce(trim(p_notes), '')
    )
  );

  return v_record;
end;
$$;

-- 4G. Authorized Staff Record Edit / Correction (Audit Trail Logged)
create or replace function public.correct_occupancy_record(
  p_record_id bigint,
  p_new_count integer,
  p_reason text default 'Updated occupancy count',
  p_notes text default null
)
returns public.occupancy_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_old public.occupancy_records;
  v_updated public.occupancy_records;
  v_area public.library_areas;
  v_clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Updated occupancy count');
  v_now timestamptz := now();
begin
  if not private.is_active_staff() then
    raise exception 'UNAUTHORIZED: Only active authenticated staff may edit occupancy records.';
  end if;

  if p_new_count is null or p_new_count < 0 then
    raise exception 'INVALID_COUNT: Corrected occupancy count must be 0 or greater.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;
  select * into v_old from public.occupancy_records where id = p_record_id;
  if not found then
    raise exception 'Occupancy record #% was not found.', p_record_id;
  end if;

  select * into v_area from public.library_areas where id = v_old.area_id;

  update public.occupancy_records
  set
    occupancy_count = p_new_count,
    notes = coalesce(trim(p_notes), v_old.notes),
    is_corrected = true,
    correction_count = v_old.correction_count + 1,
    last_corrected_by = v_profile.id,
    last_corrected_by_name = v_profile.full_name,
    last_corrected_at = v_now,
    correction_reason = v_clean_reason,
    updated_at = v_now
  where id = p_record_id
  returning * into v_updated;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'record_corrected',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    v_old.area_id,
    coalesce(v_area.name, 'Library Area'),
    'occupancy_record',
    v_updated.id::text,
    format('%s edited %s (%s • %s) from %s to %s students — Reason: %s',
      v_profile.full_name,
      coalesce(v_area.name, 'Area'),
      to_char(v_old.record_date, 'Mon DD, YYYY'),
      v_old.time_slot,
      v_old.occupancy_count,
      p_new_count,
      v_clean_reason
    ),
    jsonb_build_object(
      'record_id', v_updated.id,
      'record_date', v_old.record_date,
      'time_slot', v_old.time_slot,
      'previous_count', v_old.occupancy_count,
      'new_count', p_new_count,
      'reason', v_clean_reason,
      'original_recorder', v_old.recorded_by_name
    )
  );

  return v_updated;
end;
$$;

-- 4H. Authorized Staff Backfill for Missing Occupancy Intervals (Audit Logged)
create or replace function public.admin_backfill_missing_record(
  p_record_date date,
  p_time_slot text,
  p_area_id bigint,
  p_occupancy_count integer,
  p_reason text default 'Recorded missed interval',
  p_notes text default ''
)
returns public.occupancy_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_area public.library_areas;
  v_record public.occupancy_records;
  v_clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Recorded missed interval');
  v_now timestamptz := now();
begin
  if not private.is_active_staff() then
    raise exception 'UNAUTHORIZED: Only active authenticated staff can record missing occupancy intervals.';
  end if;

  if p_occupancy_count is null or p_occupancy_count < 0 or p_occupancy_count > 2000 then
    raise exception 'INVALID_COUNT: Student count must be between 0 and 2000.';
  end if;

  if exists (
    select 1 from public.occupancy_records
    where record_date = p_record_date and time_slot = p_time_slot and area_id = p_area_id
  ) then
    raise exception 'DUPLICATE_RECORD: A record already exists for this date, time slot, and area. Use the Edit action instead.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;
  select * into v_area from public.library_areas where id = p_area_id;
  if not found then
    raise exception 'Library area not found.';
  end if;

  insert into public.occupancy_records (
    record_date,
    time_slot,
    area_id,
    occupancy_count,
    recorded_by,
    recorded_by_name,
    notes,
    recorded_at,
    is_corrected,
    correction_count,
    last_corrected_by,
    last_corrected_by_name,
    last_corrected_at,
    correction_reason,
    created_at,
    updated_at
  ) values (
    p_record_date,
    p_time_slot,
    p_area_id,
    p_occupancy_count,
    v_profile.id,
    v_profile.full_name,
    coalesce(trim(p_notes), ''),
    v_now,
    true,
    1,
    v_profile.id,
    v_profile.full_name,
    v_now,
    v_clean_reason,
    v_now,
    v_now
  )
  returning * into v_record;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'record_backfilled',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    v_area.id,
    v_area.name,
    'occupancy_record',
    v_record.id::text,
    format('%s recorded missing interval for %s (%s • %s): %s students — Reason: %s',
      v_profile.full_name, v_area.name, to_char(p_record_date, 'Mon DD, YYYY'), p_time_slot, p_occupancy_count, v_clean_reason
    ),
    jsonb_build_object(
      'record_id', v_record.id,
      'record_date', p_record_date,
      'time_slot', p_time_slot,
      'occupancy_count', p_occupancy_count,
      'reason', v_clean_reason
    )
  );

  return v_record;
end;
$$;

-- 4I. Retrieve Occupancy Records for Any Date / Month / Range (Bypasses 1000-row PostgREST default cap cleanly)
create or replace function public.get_occupancy_records_range(
  p_start_date date,
  p_end_date date,
  p_area_id bigint default null
)
returns setof public.occupancy_records
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_staff() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select r.*
  from public.occupancy_records r
  where r.record_date >= p_start_date
    and r.record_date <= p_end_date
    and (p_area_id is null or r.area_id = p_area_id)
  order by r.record_date asc, r.time_slot asc, r.area_id asc;
end;
$$;

-- 4J. Log Audited Client Events (Login, Logout, Report Generated/Exported, Backup, Area Config)
create or replace function public.log_client_activity(
  p_action_type text,
  p_description text,
  p_area_id bigint default null,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_area_name text := null;
  v_log_id bigint;
  v_allowed text[] := array[
    'user_login', 'user_logout', 'report_generated', 'report_exported', 'backup_exported', 'area_updated'
  ];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not (p_action_type = any(v_allowed)) then
    raise exception 'Unsupported client activity type: %', p_action_type;
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;
  if not found then
    raise exception 'User profile not found.';
  end if;

  if p_area_id is not null then
    select name into v_area_name from public.library_areas where id = p_area_id;
  end if;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    p_action_type,
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    p_area_id,
    v_area_name,
    p_target_type,
    p_target_id,
    p_description,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_log_id;

  return v_log_id;
end;
$$;

-- 4K. Admin: Create Staff Account (Librarian Only)
create or replace function public.admin_create_staff_account(
  p_email text,
  p_username text,
  p_password text,
  p_full_name text,
  p_staff_code text,
  p_role text,
  p_assigned_area_id bigint default null,
  p_shift_schedule text default '8:00 AM - 6:00 PM'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_new_id uuid := extensions.gen_random_uuid();
  v_clean_email text := lower(trim(p_email));
  v_clean_username text := lower(trim(p_username));
  v_now timestamptz := now();
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can create user accounts.';
  end if;

  if p_role not in ('librarian', 'student_assistant') then
    raise exception 'Invalid role specified.';
  end if;

  if length(trim(p_password)) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;

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
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now,
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', trim(p_full_name), 'username', v_clean_username),
    v_now,
    v_now,
    '', '', '', '', '', '', '', '',
    false
  );

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

  insert into public.user_profiles (
    id, email, username, full_name, staff_code, role, assigned_area_id, shift_schedule, is_active
  ) values (
    v_new_id,
    v_clean_email,
    v_clean_username,
    trim(p_full_name),
    trim(p_staff_code),
    p_role,
    case when p_role = 'librarian' then null else p_assigned_area_id end,
    coalesce(nullif(trim(p_shift_schedule), ''), '8:00 AM - 6:00 PM'),
    true
  );

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
  ) values (
    'staff_created',
    v_actor.id,
    v_actor.full_name,
    v_actor.role,
    'user_profile',
    v_new_id::text,
    format('%s created %s account for %s (@%s)', v_actor.full_name, p_role, trim(p_full_name), v_clean_username),
    jsonb_build_object('username', v_clean_username, 'role', p_role, 'staff_code', trim(p_staff_code))
  );

  return v_new_id;
end;
$$;

-- 4L. Admin: Update Staff Account (Librarian Only)
create or replace function public.admin_update_staff_account(
  p_user_id uuid,
  p_full_name text,
  p_username text,
  p_staff_code text,
  p_role text,
  p_assigned_area_id bigint default null,
  p_shift_schedule text default '8:00 AM - 6:00 PM',
  p_is_active boolean default true,
  p_new_password text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_now timestamptz := now();
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can update user accounts.';
  end if;

  if p_role not in ('librarian', 'student_assistant') then
    raise exception 'Invalid role specified.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;

  update public.user_profiles
  set
    full_name = trim(p_full_name),
    username = lower(trim(p_username)),
    staff_code = trim(p_staff_code),
    role = p_role,
    assigned_area_id = case when p_role = 'librarian' then null else p_assigned_area_id end,
    shift_schedule = coalesce(nullif(trim(p_shift_schedule), ''), '8:00 AM - 6:00 PM'),
    is_active = p_is_active,
    updated_at = v_now
  where id = p_user_id;

  if p_new_password is not null and length(trim(p_new_password)) >= 6 then
    update auth.users
    set encrypted_password = extensions.crypt(trim(p_new_password), extensions.gen_salt('bf')),
        updated_at = v_now
    where id = p_user_id;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role),
      updated_at = v_now
  where id = p_user_id;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
  ) values (
    'staff_updated',
    v_actor.id,
    v_actor.full_name,
    v_actor.role,
    'user_profile',
    p_user_id::text,
    format('%s updated account settings for %s (@%s)', v_actor.full_name, trim(p_full_name), lower(trim(p_username))),
    jsonb_build_object('role', p_role, 'is_active', p_is_active, 'password_reset', (p_new_password is not null and length(trim(p_new_password)) >= 6))
  );

  return true;
end;
$$;

-- 4L2. Admin: Remove Staff Account (Librarian Only)
create or replace function public.admin_delete_staff_account(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_target public.user_profiles;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can remove user accounts.';
  end if;

  if p_user_id = v_uid then
    raise exception 'You cannot remove your own currently active Librarian account.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;
  select * into v_target from public.user_profiles where id = p_user_id;
  if not found then
    raise exception 'User account not found.';
  end if;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
  ) values (
    'staff_updated',
    v_actor.id,
    v_actor.full_name,
    v_actor.role,
    'user_profile',
    p_user_id::text,
    format('%s removed %s account for %s (@%s)', v_actor.full_name, replace(v_target.role, '_', ' '), v_target.full_name, v_target.username),
    jsonb_build_object('removed_username', v_target.username, 'removed_role', v_target.role, 'removed_staff_code', v_target.staff_code, 'action', 'account_removed')
  );

  delete from auth.users where id = p_user_id;
  delete from public.user_profiles where id = p_user_id;

  return true;
end;
$$;

-- 4M. Librarian Database Backup Snapshot Export (JSON)
create or replace function public.export_system_backup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_payload jsonb;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can export system backups.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;

  select jsonb_build_object(
    'system', 'LIRC STAT – Learning Information and Resource Center Statistical Tracking and Analysis Tool',
    'exported_at', now(),
    'exported_by', v_actor.full_name,
    'library_areas', coalesce((select jsonb_agg(row_to_json(a) order by a.display_order) from public.library_areas a), '[]'::jsonb),
    'user_profiles', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email, 'full_name', u.full_name, 'staff_code', u.staff_code, 'role', u.role, 'shift_schedule', u.shift_schedule, 'is_active', u.is_active)) from public.user_profiles u), '[]'::jsonb),
    'occupancy_records', coalesce((select jsonb_agg(row_to_json(r) order by r.record_date, r.time_slot, r.area_id) from public.occupancy_records r), '[]'::jsonb),
    'saved_reports', coalesce((select jsonb_agg(row_to_json(sr) order by sr.created_at desc) from public.saved_reports sr), '[]'::jsonb),
    'activity_logs', coalesce((select jsonb_agg(row_to_json(al) order by al.created_at desc) from (select * from public.activity_logs order by created_at desc limit 500) al), '[]'::jsonb)
  ) into v_payload;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, description, metadata
  ) values (
    'backup_exported',
    v_actor.id,
    v_actor.full_name,
    v_actor.role,
    'system_backup',
    format('%s exported a full LIRC STAT JSON database backup snapshot', v_actor.full_name),
    jsonb_build_object('record_count', jsonb_array_length(v_payload->'occupancy_records'))
  );

  return v_payload;
end;
$$;

-- Explicit RPC Execute Grants
revoke all on function public.get_login_directory() from public;
revoke all on function public.resolve_login_email(text) from public;
revoke all on function public.register_staff_account(text, text, text, text, text, text) from public;
revoke all on function public.get_server_clock() from public;
revoke all on function public.start_monitoring_session(bigint) from public;
revoke all on function public.exit_monitoring_session(bigint) from public;
revoke all on function public.submit_occupancy_record(bigint, integer, text, bigint, text) from public;
revoke all on function public.correct_occupancy_record(bigint, integer, text, text) from public;
revoke all on function public.admin_backfill_missing_record(date, text, bigint, integer, text, text) from public;
revoke all on function public.get_occupancy_records_range(date, date, bigint) from public;
revoke all on function public.log_client_activity(text, text, bigint, text, text, jsonb) from public;
revoke all on function public.admin_create_staff_account(text, text, text, text, text, text, bigint, text) from public;
revoke all on function public.admin_update_staff_account(uuid, text, text, text, text, bigint, text, boolean, text) from public;
revoke all on function public.admin_delete_staff_account(uuid) from public;
revoke all on function public.export_system_backup() from public;

grant execute on function public.get_login_directory() to anon, authenticated;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
grant execute on function public.register_staff_account(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_server_clock() to anon, authenticated;

grant execute on function public.start_monitoring_session(bigint) to authenticated;
grant execute on function public.exit_monitoring_session(bigint) to authenticated;
grant execute on function public.submit_occupancy_record(bigint, integer, text, bigint, text) to authenticated;
grant execute on function public.correct_occupancy_record(bigint, integer, text, text) to authenticated;
grant execute on function public.admin_backfill_missing_record(date, text, bigint, integer, text, text) to authenticated;
grant execute on function public.get_occupancy_records_range(date, date, bigint) to authenticated;
grant execute on function public.log_client_activity(text, text, bigint, text, text, jsonb) to authenticated;
grant execute on function public.admin_create_staff_account(text, text, text, text, text, text, bigint, text) to authenticated;
grant execute on function public.admin_update_staff_account(uuid, text, text, text, text, bigint, text, boolean, text) to authenticated;
grant execute on function public.admin_delete_staff_account(uuid) to authenticated;
grant execute on function public.export_system_backup() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. SEED THE SIX MONITORED LIBRARY AREAS
-- -----------------------------------------------------------------------------

insert into public.library_areas (code, slug, name, description, floor_location, capacity, color_hex, icon_name, display_order)
values
  ('FIL',  'filipiniana', 'Filipiniana', 'Philippine history, culture, theses, and local publications reading hall.', '2nd Floor, East Wing', 70, '#7C2D36', 'BookOpen', 1),
  ('READ', 'reading-area', 'Reading Area', 'Main reading hall, general study tables, and student study areas.', '1st Floor, Main Hall', 80, '#2E5A44', 'BookOpen', 2),
  ('PER',  'periodicals', 'Periodicals', 'Academic journals, magazines, newspapers, and serials study lounge.', '2nd Floor, North Wing', 55, '#B8860B', 'Newspaper', 3),
  ('LC',   'learning-commons', 'Learning Commons', 'Collaborative digital workspace, research workstations, and study pods.', '1st Floor, West Wing', 120, '#4A3525', 'Laptop', 4),
  ('DR',   'discussion-rooms', 'Discussion Rooms', 'Reservable glass-walled group study and project collaboration suites.', '3rd Floor, Study Suites', 60, '#8C4A27', 'Users', 5),
  ('REF',  'reference', 'Reference', 'Encyclopedias, dictionaries, indexes, and guided research consultation zone.', '2nd Floor, Central Hall', 65, '#2B4C65', 'Compass', 6)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  floor_location = excluded.floor_location,
  capacity = excluded.capacity,
  color_hex = excluded.color_hex,
  display_order = excluded.display_order;

-- -----------------------------------------------------------------------------
-- 6. SEED PRE-CONFIGURED LIBRARIAN & ROVING STUDENT ASSISTANT ACCOUNTS
-- Default demo password for all pre-seeded accounts: Password123!
-- -----------------------------------------------------------------------------

do $$
declare
  v_now timestamptz := now();
  v_accounts jsonb := '[
    {"id":"11111111-1111-4111-8111-111111111101","email":"librarian@lirc.edu.ph","username":"librarian","full_name":"Dr. Elena M. Santos","staff_code":"LIB-2026-001","role":"librarian","shift":"8:00 AM - 6:00 PM"},
    {"id":"11111111-1111-4111-8111-111111111102","email":"sa.maria@lirc.edu.ph","username":"sa_maria","full_name":"Maria Clara Reyes","staff_code":"SA-2026-101","role":"student_assistant","shift":"8:00 AM - 1:00 PM (Morning Duty)"},
    {"id":"11111111-1111-4111-8111-111111111103","email":"sa.juanito@lirc.edu.ph","username":"sa_juanito","full_name":"Juanito Pelaez","staff_code":"SA-2026-102","role":"student_assistant","shift":"1:00 PM - 6:00 PM (Afternoon Duty)"},
    {"id":"11111111-1111-4111-8111-111111111104","email":"sa.isagani@lirc.edu.ph","username":"sa_isagani","full_name":"Isagani Sandoval","staff_code":"SA-2026-103","role":"student_assistant","shift":"8:00 AM - 6:00 PM (Roving Duty)"},
    {"id":"11111111-1111-4111-8111-111111111105","email":"sa.paulita@lirc.edu.ph","username":"sa_paulita","full_name":"Paulita Gomez","staff_code":"SA-2026-104","role":"student_assistant","shift":"8:00 AM - 1:00 PM (Morning Duty)"},
    {"id":"11111111-1111-4111-8111-111111111106","email":"sa.basilio@lirc.edu.ph","username":"sa_basilio","full_name":"Basilio Santiago","staff_code":"SA-2026-105","role":"student_assistant","shift":"1:00 PM - 6:00 PM (Afternoon Duty)"},
    {"id":"11111111-1111-4111-8111-111111111107","email":"sa.juliana@lirc.edu.ph","username":"sa_juliana","full_name":"Juliana De Dios","staff_code":"SA-2026-106","role":"student_assistant","shift":"8:00 AM - 6:00 PM (Roving Duty)"}
  ]'::jsonb;
  v_item jsonb;
  v_uid uuid;
begin
  for v_item in select * from jsonb_array_elements(v_accounts)
  loop
    v_uid := (v_item->>'id')::uuid;

    if not exists (select 1 from auth.users where id = v_uid) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        phone_change, phone_change_token, email_change_token_current, reauthentication_token,
        is_sso_user
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_uid,
        'authenticated',
        'authenticated',
        v_item->>'email',
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        v_now,
        jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', v_item->>'role'),
        jsonb_build_object('full_name', v_item->>'full_name', 'username', v_item->>'username'),
        v_now,
        v_now,
        '', '', '', '', '', '', '', '',
        false
      );

      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        extensions.gen_random_uuid(),
        v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', v_item->>'email', 'email_verified', true, 'phone_verified', false),
        'email',
        v_uid::text,
        v_now,
        v_now,
        v_now
      );
    end if;

    insert into public.user_profiles (
      id, email, username, full_name, staff_code, role, assigned_area_id, shift_schedule, is_active
    ) values (
      v_uid,
      v_item->>'email',
      v_item->>'username',
      v_item->>'full_name',
      v_item->>'staff_code',
      v_item->>'role',
      null,
      v_item->>'shift',
      true
    )
    on conflict (id) do nothing;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. SEED REALISTIC HISTORICAL OCCUPANCY DATA (LAST 45 OPERATING DAYS)
-- Includes a few intentional missing slots on recent days so Missing Interval
-- detection & Librarian backfill/correction tools are immediately demonstrable.
-- -----------------------------------------------------------------------------

do $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_start date := (now() at time zone 'Asia/Manila')::date - 44;
  v_d date;
  v_area record;
  v_slot text;
  v_slot_idx int;
  v_slots text[] := array[
    '08:00','08:30','09:00','09:30','10:00','10:30',
    '11:00','11:30','12:00','12:30','13:00','13:30',
    '14:00','14:30','15:00','15:30','16:00','16:30',
    '17:00','17:30','18:00'
  ];
  v_sa_ids uuid[] := array[
    '11111111-1111-4111-8111-111111111102'::uuid,
    '11111111-1111-4111-8111-111111111103'::uuid,
    '11111111-1111-4111-8111-111111111104'::uuid,
    '11111111-1111-4111-8111-111111111105'::uuid,
    '11111111-1111-4111-8111-111111111106'::uuid,
    '11111111-1111-4111-8111-111111111107'::uuid
  ];
  v_sa_names text[] := array[
    'Maria Clara Reyes',
    'Juanito Pelaez',
    'Isagani Sandoval',
    'Paulita Gomez',
    'Basilio Santiago',
    'Juliana De Dios'
  ];
  v_sa_pick int;
  v_hour_curve numeric;
  v_base numeric;
  v_count int;
  v_dow int;
  v_hash int;
begin
  -- Only seed if occupancy_records is currently empty
  if exists (select 1 from public.occupancy_records limit 1) then
    return;
  end if;

  v_d := v_start;
  while v_d <= v_today loop
    v_dow := extract(isodow from v_d)::int; -- 1=Mon .. 7=Sun
    -- Library operates Mon-Sat (skip Sundays)
    if v_dow <= 6 then
      for v_area in select * from public.library_areas order by display_order loop
        for v_slot_idx in 1..array_length(v_slots, 1) loop
          v_slot := v_slots[v_slot_idx];

          -- Leave several intentional unrecorded slots on today and yesterday
          -- so Student Assistants can test submitting & Librarians see Missing Intervals
          if v_d = v_today and v_slot_idx >= 16 then
            continue;
          end if;
          if v_d = v_today and v_area.code in ('PER', 'REF') and v_slot in ('10:30', '14:00') then
            continue;
          end if;
          if v_d = (v_today - 1) and v_area.code = 'DR' and v_slot = '15:30' then
            continue;
          end if;

          -- Realistic diurnal occupancy curve peaking mid-morning (10-11:30) and afternoon (13:30-16:00)
          v_hour_curve := case
            when v_slot_idx <= 2 then 0.28
            when v_slot_idx <= 4 then 0.52
            when v_slot_idx <= 8 then 0.78
            when v_slot_idx <= 10 then 0.58
            when v_slot_idx <= 16 then 0.84
            when v_slot_idx <= 19 then 0.62
            else 0.34
          end;

          -- Saturday lighter traffic
          if v_dow = 6 then
            v_hour_curve := v_hour_curve * 0.65;
          end if;

          -- Deterministic pseudo-random variance
          v_hash := (abs(hashtext(v_d::text || '-' || v_area.code || '-' || v_slot)::bigint) % 25)::int;
          v_base := v_area.capacity * v_hour_curve * (0.78 + (v_hash::numeric / 100.0));
          v_count := greatest(2, least(v_area.capacity, round(v_base)::int));

          -- Rotate Student Assistants dynamically across areas (non-permanent assignment!)
          v_sa_pick := ((extract(day from v_d)::int + v_area.display_order + (case when v_slot_idx > 10 then 1 else 0 end)) % 6) + 1;

          insert into public.occupancy_records (
            record_date,
            time_slot,
            area_id,
            occupancy_count,
            recorded_by,
            recorded_by_name,
            notes,
            recorded_at,
            created_at,
            updated_at
          ) values (
            v_d,
            v_slot,
            v_area.id,
            v_count,
            v_sa_ids[v_sa_pick],
            v_sa_names[v_sa_pick],
            case
              when v_count >= round(v_area.capacity * 0.88) then 'Near full capacity — peak study period'
              when v_slot = '08:00' then 'Opening headcount'
              when v_slot = '18:00' then 'Closing headcount'
              else ''
            end,
            ((v_d::text || ' ' || v_slot || ':00')::timestamp at time zone 'Asia/Manila'),
            ((v_d::text || ' ' || v_slot || ':00')::timestamp at time zone 'Asia/Manila'),
            ((v_d::text || ' ' || v_slot || ':00')::timestamp at time zone 'Asia/Manila')
          )
          on conflict (record_date, time_slot, area_id) do nothing;
        end loop;
      end loop;
    end if;
    v_d := v_d + 1;
  end loop;

  -- Seed initial audit log summary entries
  insert into public.activity_logs (action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata, created_at)
  select
    'occupancy_submitted',
    r.recorded_by,
    r.recorded_by_name,
    'student_assistant',
    r.area_id,
    a.name,
    'occupancy_record',
    r.id::text,
    format('%s recorded %s students in %s (%s • %s)', r.recorded_by_name, r.occupancy_count, a.name, to_char(r.record_date, 'Mon DD, YYYY'), r.time_slot),
    jsonb_build_object('record_id', r.id, 'record_date', r.record_date, 'time_slot', r.time_slot, 'occupancy_count', r.occupancy_count),
    r.recorded_at
  from public.occupancy_records r
  join public.library_areas a on a.id = r.area_id
  where r.record_date >= v_today - 2
  order by r.record_date desc, r.time_slot desc
  limit 18;
end $$;
