-- -----------------------------------------------------------------------------
-- LIRC STAT: STRICT 30-MINUTE COMPLETED INTERVAL ENFORCEMENT
-- Student Assistants can only enter headcount once the 30-minute interval has completed.
-- E.g., 8:00 AM – 8:30 AM interval unlocks at 8:30 AM.
-- -----------------------------------------------------------------------------

-- 1. Update public.get_server_clock() to expose completed_slot and interval status
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
  v_underway_slot text := null;
  v_underway_slot_minutes int;
  v_completed_slot text := null;
  v_completed_slot_minutes int;
  v_is_interval_completed boolean := false;
  v_next_boundary_mins int;
  v_seconds_into_min int := extract(second from v_local)::int;
  v_seconds_until_next int := 0;
begin
  if v_is_operating then
    -- Interval currently in progress (e.g. 08:00 from 8:00 to 8:29; 08:30 from 8:30 to 8:59)
    v_underway_slot_minutes := least(1080, (v_total_minutes / 30) * 30);
    v_underway_slot := lpad((v_underway_slot_minutes / 60)::text, 2, '0') || ':' || lpad((v_underway_slot_minutes % 60)::text, 2, '0');

    -- Interval that has finished and is eligible for headcount submission
    -- 08:00 interval finishes at 8:30 AM (510 minutes). Before 8:30 AM, no interval has completed.
    if v_total_minutes >= 510 then
      v_is_interval_completed := true;
      v_completed_slot_minutes := least(1080, ((v_total_minutes / 30) - 1) * 30);
      v_completed_slot := lpad((v_completed_slot_minutes / 60)::text, 2, '0') || ':' || lpad((v_completed_slot_minutes % 60)::text, 2, '0');
    else
      v_is_interval_completed := false;
      v_completed_slot := null;
    end if;

    -- Seconds remaining until the current underway interval completes
    v_next_boundary_mins := ((v_total_minutes / 30) + 1) * 30;
    v_seconds_until_next := greatest(0, (v_next_boundary_mins - v_total_minutes) * 60 - v_seconds_into_min);
  elsif v_total_minutes >= 1110 then
    -- After 6:30 PM (all 21 operating intervals completed for the day)
    v_completed_slot := '18:00';
    v_is_interval_completed := true;
    v_underway_slot := null;
    v_seconds_until_next := 0;
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
    'seconds_until_next_slot', v_seconds_until_next,
    'timezone', 'Asia/Manila (UTC+8)'
  );
end;
$$;

revoke all on function public.get_server_clock() from public;
grant execute on function public.get_server_clock() to anon, authenticated;

-- 2. Update public.submit_occupancy_record to strictly enforce completed intervals
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
  v_time_slot text;
  v_is_off_hours boolean := false;
  v_existing_id bigint;
  v_record public.occupancy_records;
  v_target_hour int;
  v_target_min int;
  v_target_slot_end_mins int;
  v_target_slot_start_mins int;
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

  -- 30-Minute Schedule Interval Enforcement:
  -- Counts can ONLY be entered once the 30-minute interval has completed (e.g. 8:00 AM - 8:30 AM unlocks at 8:30 AM).
  if v_is_operating then
    if p_fallback_slot is not null and p_fallback_slot = any(v_valid_slots) then
      v_time_slot := p_fallback_slot;
      v_target_hour := split_part(v_time_slot, ':', 1)::int;
      v_target_min := split_part(v_time_slot, ':', 2)::int;
      v_target_slot_end_mins := (v_target_hour * 60 + v_target_min) + 30;

      -- Slot cannot be recorded before it has completed
      if v_total_minutes < v_target_slot_end_mins then
        raise exception 'INTERVAL_NOT_COMPLETED: Interval % has not completed yet. Headcounts can only be submitted once the 30-minute interval concludes at %:% PHT.',
          v_time_slot,
          lpad((v_target_slot_end_mins / 60)::text, 2, '0'),
          lpad((v_target_slot_end_mins % 60)::text, 2, '0');
      end if;
    else
      -- Default to the latest completed interval
      if v_total_minutes < 510 then
        raise exception 'INTERVAL_IN_PROGRESS: The 8:00 AM – 8:30 AM interval is currently underway. Headcount entry automatically unlocks at 8:30 AM once the interval has completed.';
      end if;

      v_target_slot_start_mins := least(1080, ((v_total_minutes / 30) - 1) * 30);
      v_time_slot := lpad((v_target_slot_start_mins / 60)::text, 2, '0') || ':' || lpad((v_target_slot_start_mins % 60)::text, 2, '0');
    end if;
    v_is_off_hours := false;
  else
    -- Outside operating hours (Testing / Off-Hours Mode)
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
    trim(coalesce(p_notes, '')),
    v_now_utc,
    v_is_off_hours,
    v_now_utc,
    v_now_utc
  )
  returning * into v_record;

  if p_session_id is not null then
    update public.monitoring_sessions
    set records_submitted = records_submitted + 1
    where id = p_session_id;
  end if;

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
    format('%s recorded %s students in %s for completed interval %s', v_profile.full_name, p_occupancy_count, v_area.name, v_time_slot),
    jsonb_build_object(
      'time_slot', v_time_slot,
      'occupancy_count', p_occupancy_count,
      'is_off_hours', v_is_off_hours,
      'session_id', p_session_id
    )
  );

  return v_record;
end;
$$;

revoke all on function public.submit_occupancy_record(bigint, integer, text, bigint, text) from public;
grant execute on function public.submit_occupancy_record(bigint, integer, text, bigint, text) to authenticated;
