-- =============================================================================
-- Migration: Violators Logbook & 1-Hour Violation Timer Tracking
-- Description: Allows Student Assistants to record library violations and monitor
-- a 1-hour countdown timer for each violation record (with play, pause, completed,
-- and remove capabilities). Librarians have centralized oversight and multi-format
-- export capabilities (Excel, PDF, Word).
-- =============================================================================

create table if not exists public.library_violations (
  id uuid primary key default extensions.gen_random_uuid(),
  violator_name text not null,
  student_id text not null,
  course text not null,
  violation text not null,
  recorded_by_id uuid references public.user_profiles(id) on delete set null,
  recorded_by_name text not null default '',
  recorded_by_staff_code text default '',
  timer_duration_seconds integer not null default 3600,
  remaining_seconds integer not null default 3600,
  timer_status text not null default 'stopped', -- 'stopped' | 'running' | 'paused' | 'completed'
  timer_started_at timestamptz,
  completed_at timestamptz,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup indexes
create index if not exists library_violations_created_at_idx on public.library_violations (created_at desc);
create index if not exists library_violations_student_id_idx on public.library_violations (student_id);
create index if not exists library_violations_timer_status_idx on public.library_violations (timer_status);

-- Enable Row Level Security (RLS)
alter table public.library_violations enable row level security;

-- Policies:
-- 1. All authenticated staff (Librarians & Student Assistants) can read all violation records
drop policy if exists "library_violations_select_staff" on public.library_violations;
create policy "library_violations_select_staff"
  on public.library_violations
  for select
  to authenticated
  using (true);

-- 2. Authenticated staff can record violations
drop policy if exists "library_violations_insert_staff" on public.library_violations;
create policy "library_violations_insert_staff"
  on public.library_violations
  for insert
  to authenticated
  with check (true);

-- 3. Authenticated staff can update violation timers and notes
drop policy if exists "library_violations_update_staff" on public.library_violations;
create policy "library_violations_update_staff"
  on public.library_violations
  for update
  to authenticated
  using (true)
  with check (true);

-- 4. Authenticated staff can remove violation records
drop policy if exists "library_violations_delete_staff" on public.library_violations;
create policy "library_violations_delete_staff"
  on public.library_violations
  for delete
  to authenticated
  using (true);

-- Grant table privileges
grant select, insert, update, delete on table public.library_violations to authenticated;

-- Add to Realtime publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'library_violations') then
      if not exists (
        select 1 from pg_publication_tables 
        where pubname = 'supabase_realtime' 
          and schemaname = 'public' 
          and tablename = 'library_violations'
      ) then
        alter publication supabase_realtime add table public.library_violations;
      end if;
    end if;
  end if;
end $$;
