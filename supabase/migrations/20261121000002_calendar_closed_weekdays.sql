-- =============================================================================
-- Migration: Calendar of Activities - Recurring Weekday Temporary Closures
-- Allows Librarians to temporarily close specific days of the week (e.g. every Monday,
-- Tuesday, Wednesday, Thursday, Friday, or Saturday).
-- Automatically excludes all attendance data on closed weekdays from statistical
-- calculations, and allows reopening anytime.
-- =============================================================================

create table if not exists public.calendar_closed_weekdays (
  day_of_week int primary key check (day_of_week between 0 and 6),
  day_name text not null,
  is_closed boolean not null default true,
  reason text default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_name text not null default ''
);

create index if not exists calendar_closed_weekdays_closed_idx 
  on public.calendar_closed_weekdays (is_closed);

-- Enable RLS
alter table public.calendar_closed_weekdays enable row level security;

-- Policies:
-- 1. All authenticated staff can select closed weekdays
drop policy if exists "calendar_closed_weekdays_select_staff" on public.calendar_closed_weekdays;
create policy "calendar_closed_weekdays_select_staff"
  on public.calendar_closed_weekdays
  for select
  to authenticated
  using (true);

-- 2. Only Librarians can modify closed weekdays
drop policy if exists "calendar_closed_weekdays_insert_librarian" on public.calendar_closed_weekdays;
create policy "calendar_closed_weekdays_insert_librarian"
  on public.calendar_closed_weekdays
  for insert
  to authenticated
  with check ((select private.is_librarian()));

drop policy if exists "calendar_closed_weekdays_update_librarian" on public.calendar_closed_weekdays;
create policy "calendar_closed_weekdays_update_librarian"
  on public.calendar_closed_weekdays
  for update
  to authenticated
  using ((select private.is_librarian()))
  with check ((select private.is_librarian()));

drop policy if exists "calendar_closed_weekdays_delete_librarian" on public.calendar_closed_weekdays;
create policy "calendar_closed_weekdays_delete_librarian"
  on public.calendar_closed_weekdays
  for delete
  to authenticated
  using ((select private.is_librarian()));

grant select on table public.calendar_closed_weekdays to authenticated, anon;
grant insert, update, delete on table public.calendar_closed_weekdays to authenticated;

-- Add to Realtime publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_closed_weekdays'
    ) then
      alter publication supabase_realtime add table public.calendar_closed_weekdays;
    end if;
  end if;
end;
$$;

-- RPC for safely toggling weekday closure with activity audit logging
create or replace function public.toggle_calendar_closed_weekday(
  p_day_of_week int,
  p_is_closed boolean,
  p_reason text default ''
)
returns public.calendar_closed_weekdays
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_day_name text;
  v_row public.calendar_closed_weekdays;
  v_now timestamptz := now();
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can modify recurring library schedule closures.';
  end if;

  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'INVALID_DAY: Day of week must be between 0 (Sunday) and 6 (Saturday).';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;

  v_day_name := case p_day_of_week
    when 0 then 'Sunday'
    when 1 then 'Monday'
    when 2 then 'Tuesday'
    when 3 then 'Wednesday'
    when 4 then 'Thursday'
    when 5 then 'Friday'
    when 6 then 'Saturday'
  end;

  insert into public.calendar_closed_weekdays (
    day_of_week, day_name, is_closed, reason, updated_at, updated_by, updated_by_name
  ) values (
    p_day_of_week, v_day_name, p_is_closed, coalesce(trim(p_reason), ''), v_now, v_uid, coalesce(v_profile.full_name, 'Librarian')
  )
  on conflict (day_of_week) do update set
    is_closed = excluded.is_closed,
    reason = excluded.reason,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name
  returning * into v_row;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
  ) values (
    'staff_updated',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    'schedule_setting',
    p_day_of_week::text,
    format('%s %s recurring operations on %s', coalesce(v_profile.full_name, 'Librarian'), case when p_is_closed then 'temporarily closed' else 'reopened' end, v_day_name),
    jsonb_build_object(
      'day_of_week', p_day_of_week,
      'day_name', v_day_name,
      'is_closed', p_is_closed,
      'reason', p_reason
    )
  );

  return v_row;
end;
$$;

revoke all on function public.toggle_calendar_closed_weekday(int, boolean, text) from public;
grant execute on function public.toggle_calendar_closed_weekday(int, boolean, text) to authenticated;
