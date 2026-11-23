-- =============================================================================
-- LIRC STAT: PURGE ALL RECORDS, LOGS, AND NON-LIBRARIAN ACCOUNTS
--
-- This script completely and safely resets the database:
-- 1. Ensures core tables exist (occupancy_records, monitoring_sessions, etc.)
-- 2. Wipes all occupancy records & historical count statistics
-- 3. Wipes all activity/audit logs
-- 4. Wipes all monitoring sessions & duty tracking
-- 5. Wipes all saved report snapshots & calendar activities
-- 6. Preserves & restores the Librarian account:
--    DR. MARIA LORENA ABANGAN (@librarian / librarian@lirc.edu.ph)
-- 7. Deletes all student assistants, test accounts, and calendar dummy accounts
--    from public.user_profiles, auth.identities, and auth.users
-- =============================================================================

-- Step 1: Ensure core tables exist so TRUNCATE never fails and app works smoothly
create table if not exists public.library_areas (
  id bigint generated always as identity primary key,
  code text not null unique,
  slug text not null unique,
  name text not null unique,
  description text not null default '',
  floor_location text not null default 'Main Library',
  capacity integer not null default 60 check (capacity > 0),
  color_hex text not null default '#2563eb',
  icon_name text not null default 'BookOpen',
  display_order integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

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
  pending_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.occupancy_records (
  id bigint generated always as identity primary key,
  record_date date not null,
  time_slot text not null,
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

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  action_type text not null,
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

create table if not exists public.saved_reports (
  id bigint generated always as identity primary key,
  report_type text not null default 'monthly',
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

create table if not exists public.calendar_activities (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  description text default '',
  activity_date date not null,
  is_whole_day boolean not null default true,
  start_time text default '08:00',
  end_time text default '18:00',
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Step 2: Grant standard access permissions
grant select, insert, update, delete on public.occupancy_records to authenticated;
grant select, insert, update, delete on public.monitoring_sessions to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select, insert, update, delete on public.saved_reports to authenticated;
grant select, insert, update, delete on public.calendar_activities to authenticated;

-- Step 3: Safely wipe all historical records, sessions, logs, and calendar items
do $$
begin
  if to_regclass('public.occupancy_records') is not null then
    execute 'truncate table public.occupancy_records restart identity cascade;';
  end if;

  if to_regclass('public.monitoring_sessions') is not null then
    execute 'truncate table public.monitoring_sessions restart identity cascade;';
  end if;

  if to_regclass('public.activity_logs') is not null then
    execute 'truncate table public.activity_logs restart identity cascade;';
  end if;

  if to_regclass('public.saved_reports') is not null then
    execute 'truncate table public.saved_reports restart identity cascade;';
  end if;

  if to_regclass('public.calendar_activities') is not null then
    execute 'truncate table public.calendar_activities cascade;';
  end if;
end;
$$;

-- Step 4: Protect and restore the primary Librarian account
update public.user_profiles
set 
  role = 'librarian',
  shift_schedule = '8:00 AM - 6:00 PM',
  is_active = true,
  assigned_area_id = null
where lower(email) = 'librarian@lirc.edu.ph'
   or lower(username) = 'librarian'
   or id = '11111111-1111-4111-8111-111111111101';

update auth.users
set raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'::jsonb), '{role}', '"librarian"')
where lower(email) = 'librarian@lirc.edu.ph'
   or id = '11111111-1111-4111-8111-111111111101';

-- Step 5: Remove all non-librarian profiles, identities, and users
delete from public.user_profiles
where lower(email) != 'librarian@lirc.edu.ph'
  and lower(username) != 'librarian'
  and id != '11111111-1111-4111-8111-111111111101';

delete from auth.identities
where user_id in (
  select id from auth.users
  where lower(email) != 'librarian@lirc.edu.ph'
    and id != '11111111-1111-4111-8111-111111111101'
);

delete from auth.users
where lower(email) != 'librarian@lirc.edu.ph'
  and id != '11111111-1111-4111-8111-111111111101';

-- Step 6: Reload the PostgREST API schema cache
notify pgrst, 'reload schema';
