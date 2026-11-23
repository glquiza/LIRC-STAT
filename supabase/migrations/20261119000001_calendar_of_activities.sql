-- =============================================================================
-- Migration: Calendar of Activities & Class Suspension Management
-- Description: Allows Librarians to declare class suspensions and special events
-- (whole day or specific time periods). Automatically excludes those periods from
-- library statistical calculations without deleting historical records.
-- =============================================================================

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

-- Indexes for lightning-fast statistical lookups
create index if not exists calendar_activities_date_idx on public.calendar_activities (activity_date);
create index if not exists calendar_activities_created_at_idx on public.calendar_activities (created_at desc);

-- Enable RLS
alter table public.calendar_activities enable row level security;

-- Policies:
-- 1. All active authenticated staff (Librarians and Student Assistants) can view the calendar of activities
drop policy if exists "calendar_activities_select_staff" on public.calendar_activities;
create policy "calendar_activities_select_staff"
  on public.calendar_activities
  for select
  to authenticated
  using (true);

-- 2. Only Librarians can insert, update, and delete calendar activities
drop policy if exists "calendar_activities_insert_librarian" on public.calendar_activities;
create policy "calendar_activities_insert_librarian"
  on public.calendar_activities
  for insert
  to authenticated
  with check ((select private.is_librarian()));

drop policy if exists "calendar_activities_update_librarian" on public.calendar_activities;
create policy "calendar_activities_update_librarian"
  on public.calendar_activities
  for update
  to authenticated
  using ((select private.is_librarian()))
  with check ((select private.is_librarian()));

drop policy if exists "calendar_activities_delete_librarian" on public.calendar_activities;
create policy "calendar_activities_delete_librarian"
  on public.calendar_activities
  for delete
  to authenticated
  using ((select private.is_librarian()));

-- Grant table privileges to authenticated users
grant select on table public.calendar_activities to authenticated;
grant insert, update, delete on table public.calendar_activities to authenticated;

-- Seed initial sample activities
insert into public.calendar_activities (title, description, activity_date, is_whole_day, start_time, end_time, created_by_name)
values
  ('University Convocation & Academic Assembly', 'Morning university-wide academic assembly. Classes suspended from 10:00 AM to 12:00 PM.', '2026-11-20', false, '10:00', '12:00', 'Dr. Elena M. Santos (Chief Librarian)'),
  ('National Bonifacio Day (Official Holiday)', 'Regular national holiday — no classes and administrative offices closed.', '2026-11-30', true, '08:00', '18:00', 'Dr. Elena M. Santos (Chief Librarian)')
on conflict do nothing;
