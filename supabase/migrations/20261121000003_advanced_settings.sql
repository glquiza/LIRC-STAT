-- =============================================================================
-- Migration: Advanced Settings - Time Interval & Library Area Management
-- Centralizes:
-- 1. Weekly Day Closures (already in calendar_closed_weekdays)
-- 2. Time Interval Management (customizable start/end times, dynamic intervals)
-- 3. Library Area Management (add, edit name/capacity, remove/deactivate areas)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Library Time Slots Table
-- -----------------------------------------------------------------------------
create table if not exists public.library_time_slots (
  id bigint generated always as identity primary key,
  slot_key text not null unique,        -- e.g. '08:00', '18:00'
  label text not null,                  -- e.g. '8:00 AM', '6:00 PM'
  range_label text not null,            -- e.g. '8:00 AM – 8:30 AM', '6:00 PM – 6:30 PM'
  start_time text not null,             -- e.g. '08:00', '18:00'
  end_time text not null,               -- e.g. '08:30', '18:30'
  hour_key text not null,               -- e.g. '08', '18'
  hour_label text not null,             -- e.g. '8:00 AM – 9:00 AM', '6:00 PM – 7:00 PM'
  period text not null default 'Morning', -- 'Morning', 'Midday', 'Afternoon', 'Late Afternoon', 'Evening'
  display_order integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists library_time_slots_order_idx
  on public.library_time_slots (display_order, start_time);

create index if not exists library_time_slots_active_idx
  on public.library_time_slots (is_active);

-- Enable RLS
alter table public.library_time_slots enable row level security;

-- Policies for library_time_slots
drop policy if exists "library_time_slots_select_staff" on public.library_time_slots;
create policy "library_time_slots_select_staff"
  on public.library_time_slots
  for select
  to authenticated
  using (true);

drop policy if exists "library_time_slots_insert_librarian" on public.library_time_slots;
create policy "library_time_slots_insert_librarian"
  on public.library_time_slots
  for insert
  to authenticated
  with check ((select private.is_librarian()));

drop policy if exists "library_time_slots_update_librarian" on public.library_time_slots;
create policy "library_time_slots_update_librarian"
  on public.library_time_slots
  for update
  to authenticated
  using ((select private.is_librarian()))
  with check ((select private.is_librarian()));

drop policy if exists "library_time_slots_delete_librarian" on public.library_time_slots;
create policy "library_time_slots_delete_librarian"
  on public.library_time_slots
  for delete
  to authenticated
  using ((select private.is_librarian()));

grant select on public.library_time_slots to authenticated, anon;
grant insert, update, delete on public.library_time_slots to authenticated;

-- Seed default 20 intervals if table is empty
insert into public.library_time_slots (slot_key, label, range_label, start_time, end_time, hour_key, hour_label, period, display_order, is_active)
select * from (values
  ('08:00', '8:00 AM', '8:00 AM – 8:30 AM', '08:00', '08:30', '08', '8:00 AM – 9:00 AM', 'Morning', 1, true),
  ('08:30', '8:30 AM', '8:30 AM – 9:00 AM', '08:30', '09:00', '08', '8:00 AM – 9:00 AM', 'Morning', 2, true),
  ('09:00', '9:00 AM', '9:00 AM – 9:30 AM', '09:00', '09:30', '09', '9:00 AM – 10:00 AM', 'Morning', 3, true),
  ('09:30', '9:30 AM', '9:30 AM – 10:00 AM', '09:30', '10:00', '09', '9:00 AM – 10:00 AM', 'Morning', 4, true),
  ('10:00', '10:00 AM', '10:00 AM – 10:30 AM', '10:00', '10:30', '10', '10:00 AM – 11:00 AM', 'Morning', 5, true),
  ('10:30', '10:30 AM', '10:30 AM – 11:00 AM', '10:30', '11:00', '10', '10:00 AM – 11:00 AM', 'Morning', 6, true),
  ('11:00', '11:00 AM', '11:00 AM – 11:30 AM', '11:00', '11:30', '11', '11:00 AM – 12:00 PM', 'Morning', 7, true),
  ('11:30', '11:30 AM', '11:30 AM – 12:00 PM', '11:30', '12:00', '11', '11:00 AM – 12:00 PM', 'Morning', 8, true),
  ('12:00', '12:00 PM', '12:00 PM – 12:30 PM', '12:00', '12:30', '12', '12:00 PM – 1:00 PM', 'Midday', 9, true),
  ('12:30', '12:30 PM', '12:30 PM – 1:00 PM', '12:30', '13:00', '12', '12:00 PM – 1:00 PM', 'Midday', 10, true),
  ('13:00', '1:00 PM', '1:00 PM – 1:30 PM', '13:00', '13:30', '13', '1:00 PM – 2:00 PM', 'Afternoon', 11, true),
  ('13:30', '1:30 PM', '1:30 PM – 2:00 PM', '13:30', '14:00', '13', '1:00 PM – 2:00 PM', 'Afternoon', 12, true),
  ('14:00', '2:00 PM', '2:00 PM – 2:30 PM', '14:00', '14:30', '14', '2:00 PM – 3:00 PM', 'Afternoon', 13, true),
  ('14:30', '2:30 PM', '2:30 PM – 3:00 PM', '14:30', '15:00', '14', '2:00 PM – 3:00 PM', 'Afternoon', 14, true),
  ('15:00', '3:00 PM', '3:00 PM – 3:30 PM', '15:00', '15:30', '15', '3:00 PM – 4:00 PM', 'Afternoon', 15, true),
  ('15:30', '3:30 PM', '3:30 PM – 4:00 PM', '15:30', '16:00', '15', '3:00 PM – 4:00 PM', 'Afternoon', 16, true),
  ('16:00', '4:00 PM', '4:00 PM – 4:30 PM', '16:00', '16:30', '16', '4:00 PM – 5:00 PM', 'Afternoon', 17, true),
  ('16:30', '4:30 PM', '4:30 PM – 5:00 PM', '16:30', '17:00', '16', '4:00 PM – 5:00 PM', 'Late Afternoon', 18, true),
  ('17:00', '5:00 PM', '5:00 PM – 5:30 PM', '17:00', '17:30', '17', '5:00 PM – 6:00 PM', 'Late Afternoon', 19, true),
  ('17:30', '5:30 PM', '5:30 PM – 6:00 PM', '17:30', '18:00', '17', '5:00 PM – 6:00 PM', 'Late Afternoon', 20, true)
) as v(slot_key, label, range_label, start_time, end_time, hour_key, hour_label, period, display_order, is_active)
where not exists (select 1 from public.library_time_slots limit 1)
on conflict (slot_key) do nothing;

-- Add to Realtime publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_time_slots'
    ) then
      alter publication supabase_realtime add table public.library_time_slots;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Relax Occupancy Records Constraint for Dynamic Intervals
-- -----------------------------------------------------------------------------
do $$
declare
  v_con text;
begin
  for v_con in (
    select c.conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.conrelid = 'public.occupancy_records'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%time_slot%'
  ) loop
    execute 'alter table public.occupancy_records drop constraint if exists ' || quote_ident(v_con);
  end loop;
end;
$$;

alter table public.occupancy_records
  add constraint occupancy_records_time_slot_check check (
    time_slot ~ '^([0-1][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- -----------------------------------------------------------------------------
-- 3. Dynamic get_server_clock() based on active intervals in library_time_slots
-- -----------------------------------------------------------------------------
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
  
  v_min_start_mins int := 480;  -- Default 08:00
  v_max_end_mins int := 1080;   -- Default 18:00
  v_is_operating boolean := false;
  v_underway_slot text := null;
  v_completed_slot text := null;
  v_is_interval_completed boolean := false;
  v_seconds_into_min int := extract(second from v_local)::int;
  v_seconds_until_next int := 0;
  
  v_slot record;
begin
  -- Query active time slot boundaries
  select
    coalesce(min((substring(start_time, 1, 2)::int * 60 + substring(start_time, 4, 2)::int)), 480),
    coalesce(max((substring(end_time, 1, 2)::int * 60 + substring(end_time, 4, 2)::int)), 1080)
  into v_min_start_mins, v_max_end_mins
  from public.library_time_slots
  where is_active = true;

  v_is_operating := (v_total_minutes >= v_min_start_mins and v_total_minutes < v_max_end_mins);

  if v_is_operating then
    -- Find slot currently underway (where start_time <= current_time < end_time)
    select slot_key into v_underway_slot
    from public.library_time_slots
    where is_active = true
      and (substring(start_time, 1, 2)::int * 60 + substring(start_time, 4, 2)::int) <= v_total_minutes
      and (substring(end_time, 1, 2)::int * 60 + substring(end_time, 4, 2)::int) > v_total_minutes
    order by display_order asc
    limit 1;

    -- If underway slot found, calculate seconds until its end_time
    if v_underway_slot is not null then
      select ((substring(end_time, 1, 2)::int * 60 + substring(end_time, 4, 2)::int) - v_total_minutes) * 60 - v_seconds_into_min
      into v_seconds_until_next
      from public.library_time_slots
      where slot_key = v_underway_slot;
      v_seconds_until_next := greatest(0, v_seconds_until_next);
    end if;

    -- Find latest completed slot (where end_time <= current_time)
    select slot_key into v_completed_slot
    from public.library_time_slots
    where is_active = true
      and (substring(end_time, 1, 2)::int * 60 + substring(end_time, 4, 2)::int) <= v_total_minutes
    order by display_order desc
    limit 1;

    v_is_interval_completed := (v_completed_slot is not null);
  elsif v_total_minutes >= v_max_end_mins then
    -- After closing: latest completed slot is the final active slot of the day
    select slot_key into v_completed_slot
    from public.library_time_slots
    where is_active = true
    order by display_order desc
    limit 1;

    v_is_interval_completed := (v_completed_slot is not null);
    v_underway_slot := null;
    v_seconds_until_next := 0;
  else
    -- Before opening
    v_completed_slot := null;
    v_is_interval_completed := false;
    v_underway_slot := null;
    v_seconds_until_next := greatest(0, (v_min_start_mins - v_total_minutes) * 60 - v_seconds_into_min);
  end if;

  return jsonb_build_object(
    'server_utc', v_now_utc,
    'manila_timestamp', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS+08:00'),
    'record_date', to_char(v_local::date, 'YYYY-MM-DD'),
    'display_date', to_char(v_local, 'FMMonth DD, YYYY'),
    'display_time', to_char(v_local, 'FMHH12:MI:SS AM'),
    'detected_slot', v_underway_slot,
    'underway_slot', v_underway_slot,
    'completed_slot', v_completed_slot,
    'is_interval_completed', v_is_interval_completed,
    'is_operating_hours', v_is_operating,
    'seconds_until_next_slot', coalesce(v_seconds_until_next, 0),
    'timezone', 'Asia/Manila'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. RPCs for Time Slot Management
-- -----------------------------------------------------------------------------
create or replace function public.manage_library_time_slot(
  p_slot_key text,
  p_label text,
  p_range_label text,
  p_start_time text,
  p_end_time text,
  p_hour_key text,
  p_hour_label text,
  p_period text default 'Morning',
  p_display_order integer default 1,
  p_is_active boolean default true
)
returns public.library_time_slots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_row public.library_time_slots;
  v_is_new boolean := false;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can configure library operating intervals.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;

  if not exists (select 1 from public.library_time_slots where slot_key = p_slot_key) then
    v_is_new := true;
  end if;

  insert into public.library_time_slots (
    slot_key, label, range_label, start_time, end_time, hour_key, hour_label,
    period, display_order, is_active, updated_at
  ) values (
    trim(p_slot_key), trim(p_label), trim(p_range_label), trim(p_start_time), trim(p_end_time),
    trim(p_hour_key), trim(p_hour_label), trim(p_period), p_display_order, p_is_active, now()
  )
  on conflict (slot_key) do update set
    label = excluded.label,
    range_label = excluded.range_label,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    hour_key = excluded.hour_key,
    hour_label = excluded.hour_label,
    period = excluded.period,
    display_order = excluded.display_order,
    is_active = excluded.is_active,
    updated_at = now()
  returning * into v_row;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
  ) values (
    'staff_updated',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    'time_slot',
    v_row.slot_key,
    format('%s %s time interval: %s (%s)',
      coalesce(v_profile.full_name, 'Librarian'),
      case when v_is_new then 'added' else 'updated' end,
      v_row.range_label,
      v_row.slot_key
    ),
    jsonb_build_object(
      'slot_key', v_row.slot_key,
      'range_label', v_row.range_label,
      'is_active', v_row.is_active,
      'is_new', v_is_new
    )
  );

  return v_row;
end;
$$;

create or replace function public.delete_library_time_slot(
  p_slot_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_rec_count int := 0;
  v_range_label text;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can remove time intervals.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;
  select range_label into v_range_label from public.library_time_slots where slot_key = p_slot_key;

  -- Check if occupancy records exist for this interval
  select count(*) into v_rec_count from public.occupancy_records where time_slot = p_slot_key;

  if v_rec_count > 0 then
    -- Soft-deactivate to preserve historical attendance data integrity
    update public.library_time_slots
    set is_active = false, updated_at = now()
    where slot_key = p_slot_key;

    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
    ) values (
      'staff_updated',
      v_profile.id,
      v_profile.full_name,
      v_profile.role,
      'time_slot',
      p_slot_key,
      format('%s deactivated time interval %s (%s records preserved)', coalesce(v_profile.full_name, 'Librarian'), coalesce(v_range_label, p_slot_key), v_rec_count),
      jsonb_build_object('slot_key', p_slot_key, 'records_count', v_rec_count, 'action', 'deactivated')
    );
  else
    delete from public.library_time_slots where slot_key = p_slot_key;

    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
    ) values (
      'staff_updated',
      v_profile.id,
      v_profile.full_name,
      v_profile.role,
      'time_slot',
      p_slot_key,
      format('%s removed unused time interval %s', coalesce(v_profile.full_name, 'Librarian'), coalesce(v_range_label, p_slot_key)),
      jsonb_build_object('slot_key', p_slot_key, 'action', 'deleted')
    );
  end if;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPCs & Permissions for Library Area Management
-- -----------------------------------------------------------------------------
-- Enable Delete on library_areas for Librarians
grant delete on public.library_areas to authenticated;

drop policy if exists "library_areas_delete_librarian" on public.library_areas;
create policy "library_areas_delete_librarian"
  on public.library_areas
  for delete
  to authenticated
  using ((select private.is_librarian()));

create or replace function public.manage_library_area(
  p_id bigint default null,
  p_code text default '',
  p_name text default '',
  p_description text default '',
  p_floor_location text default 'Main Library',
  p_capacity integer default 60,
  p_color_hex text default '#2E5A44',
  p_icon_name text default 'BookOpen',
  p_display_order integer default null,
  p_is_active boolean default true
)
returns public.library_areas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_row public.library_areas;
  v_clean_code text := upper(trim(coalesce(nullif(p_code, ''), 'AREA')));
  v_clean_name text := trim(coalesce(nullif(p_name, ''), 'New Area'));
  v_slug text := lower(regexp_replace(regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'));
  v_order int := p_display_order;
  v_is_new boolean := false;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can add or edit library areas.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;

  if p_id is null then
    v_is_new := true;
    if v_order is null then
      select coalesce(max(display_order), 0) + 1 into v_order from public.library_areas;
    end if;

    -- Ensure unique slug and code
    if exists (select 1 from public.library_areas where code = v_clean_code) then
      v_clean_code := v_clean_code || '_' || substring(md5(random()::text), 1, 3);
    end if;
    if exists (select 1 from public.library_areas where slug = v_slug) then
      v_slug := v_slug || '-' || substring(md5(random()::text), 1, 3);
    end if;

    insert into public.library_areas (
      code, slug, name, description, floor_location, capacity, color_hex, icon_name, display_order, is_active
    ) values (
      v_clean_code, v_slug, v_clean_name, coalesce(trim(p_description), ''),
      coalesce(trim(p_floor_location), 'Main Library'), greatest(1, least(2000, p_capacity)),
      coalesce(nullif(trim(p_color_hex), ''), '#2E5A44'), coalesce(nullif(trim(p_icon_name), ''), 'BookOpen'),
      v_order, p_is_active
    )
    returning * into v_row;
  else
    update public.library_areas
    set
      code = coalesce(nullif(v_clean_code, ''), code),
      name = coalesce(nullif(v_clean_name, ''), name),
      description = coalesce(trim(p_description), description),
      floor_location = coalesce(trim(p_floor_location), floor_location),
      capacity = greatest(1, least(2000, p_capacity)),
      color_hex = coalesce(nullif(trim(p_color_hex), ''), color_hex),
      icon_name = coalesce(nullif(trim(p_icon_name), ''), icon_name),
      display_order = coalesce(v_order, display_order),
      is_active = p_is_active
    where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'AREA_NOT_FOUND: Library area with ID % does not exist.', p_id;
    end if;
  end if;

  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'area_updated',
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    v_row.id,
    v_row.name,
    'library_area',
    v_row.id::text,
    format('%s %s library area: %s (%s, capacity: %s)',
      coalesce(v_profile.full_name, 'Librarian'),
      case when v_is_new then 'added' else 'updated' end,
      v_row.name,
      v_row.code,
      v_row.capacity
    ),
    jsonb_build_object(
      'area_id', v_row.id,
      'code', v_row.code,
      'name', v_row.name,
      'capacity', v_row.capacity,
      'is_new', v_is_new
    )
  );

  return v_row;
end;
$$;

create or replace function public.delete_or_deactivate_library_area(
  p_id bigint,
  p_hard_delete boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.user_profiles;
  v_area public.library_areas;
  v_records_count int := 0;
  v_sessions_count int := 0;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can remove library areas.';
  end if;

  select * into v_profile from public.user_profiles where id = v_uid;
  select * into v_area from public.library_areas where id = p_id;

  if not found then
    raise exception 'AREA_NOT_FOUND: Library area with ID % does not exist.', p_id;
  end if;

  select count(*) into v_records_count from public.occupancy_records where area_id = p_id;
  select count(*) into v_sessions_count from public.monitoring_sessions where area_id = p_id;

  -- If any historical data exists, always soft-deactivate to prevent cascading corruption of records
  if v_records_count > 0 or v_sessions_count > 0 or not p_hard_delete then
    update public.library_areas set is_active = false where id = p_id;

    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
    ) values (
      'area_updated',
      v_profile.id,
      v_profile.full_name,
      v_profile.role,
      v_area.id,
      v_area.name,
      'library_area',
      v_area.id::text,
      format('%s deactivated library area: %s (%s historical records preserved)', coalesce(v_profile.full_name, 'Librarian'), v_area.name, v_records_count),
      jsonb_build_object('area_id', p_id, 'action', 'deactivated', 'records_count', v_records_count)
    );
  else
    delete from public.library_areas where id = p_id;

    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
    ) values (
      'area_updated',
      v_profile.id,
      v_profile.full_name,
      v_profile.role,
      'library_area',
      p_id::text,
      format('%s removed unused library area: %s', coalesce(v_profile.full_name, 'Librarian'), v_area.name),
      jsonb_build_object('area_id', p_id, 'action', 'deleted')
    );
  end if;

  return true;
end;
$$;

grant execute on function public.manage_library_time_slot to authenticated;
grant execute on function public.delete_library_time_slot to authenticated;
grant execute on function public.manage_library_area to authenticated;
grant execute on function public.delete_or_deactivate_library_area to authenticated;
