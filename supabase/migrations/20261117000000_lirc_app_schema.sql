-- LIRC APP – Library Attendance and Area Occupancy Monitoring System
-- Supabase PostgreSQL Schema & Row-Level Security Policies

create schema if not exists private;
grant usage on schema private to authenticated;

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
  id uuid default extensions.gen_random_uuid() primary key references auth.users(id) on delete cascade,
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

create index if not exists user_profiles_assigned_area_id_idx on public.user_profiles (assigned_area_id);
create index if not exists user_profiles_role_idx on public.user_profiles (role);

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
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint occupancy_records_date_slot_area_unique unique (record_date, time_slot, area_id)
);

create index if not exists occupancy_records_area_id_idx on public.occupancy_records (area_id);
create index if not exists occupancy_records_recorded_by_idx on public.occupancy_records (recorded_by);
create index if not exists occupancy_records_date_area_idx on public.occupancy_records (record_date, area_id);

create table if not exists public.saved_reports (
  id bigint generated always as identity primary key,
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  report_title text not null,
  total_monthly_occupancy bigint not null default 0,
  total_days_recorded integer not null default 0,
  top_area_name text not null default '',
  generated_by uuid references public.user_profiles(id) on delete set null,
  generated_by_name text not null default '',
  remarks text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists saved_reports_generated_by_idx on public.saved_reports (generated_by);
create index if not exists saved_reports_year_month_idx on public.saved_reports (report_year, report_month);
