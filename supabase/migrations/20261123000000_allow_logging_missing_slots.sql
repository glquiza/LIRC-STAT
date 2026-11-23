-- -----------------------------------------------------------------------------
-- LIRC STAT: ENABLE RECORDING MISSING & COMPLETED PAST SLOTS
-- Allows Student Assistants and Librarians to record missing/past 30-minute intervals
-- -----------------------------------------------------------------------------

-- 1. Update public.submit_occupancy_record to honor p_fallback_slot for any completed interval
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
  -- Operating hours: 08:00 to 18:00 (exact 6:00 PM closing)
  v_is_operating boolean := (v_total_minutes >= 480 and v_total_minutes < 1080);
  v_time_slot text;
  v_is_off_hours boolean := false;
  v_existing_id bigint;
  v_record public.occupancy_records;
  v_target_hour int;
  v_target_min int;
  v_target_slot_end_mins int;
  v_target_slot_start_mins int;
  -- Exactly 20 slots: 08:00 through 17:30 (closing at exact 6:00 PM)
  v_valid_slots text[] := array[
    '08:00','08:30','09:00','09:30','10:00','10:30',
    '11:00','11:30','12:00','12:30','13:00','13:30',
    '14:00','14:30','15:00','15:30','16:00','16:30',
    '17:00','17:30'
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
  if v_is_operating then
    if p_fallback_slot is not null and p_fallback_slot = any(v_valid_slots) then
      v_time_slot := p_fallback_slot;
      v_target_hour := split_part(v_time_slot, ':', 1)::int;
      v_target_min := split_part(v_time_slot, ':', 2)::int;
      v_target_slot_end_mins := (v_target_hour * 60 + v_target_min) + 30;

      -- Slot cannot be recorded before its 30-minute period has concluded
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

      v_target_slot_start_mins := least(1050, ((v_total_minutes / 30) - 1) * 30);
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
    p_area_id,
    p_occupancy_count,
    v_uid,
    coalesce(v_profile.full_name, 'Staff'),
    p_session_id,
    trim(p_notes),
    v_now_utc,
    v_is_off_hours,
    v_now_utc,
    v_now_utc
  )
  returning * into v_record;

  -- Audit Log
  insert into public.activity_logs (
    action_type,
    actor_id,
    actor_name,
    actor_role,
    area_id,
    area_name,
    target_type,
    target_id,
    description,
    metadata
  ) values (
    'record_created',
    v_uid,
    coalesce(v_profile.full_name, 'Staff'),
    coalesce(v_profile.role, 'student_assistant'),
    p_area_id,
    v_area.name,
    'occupancy_record',
    v_record.id::text,
    format('%s recorded %s students in %s for interval %s',
      coalesce(v_profile.full_name, 'Staff'),
      p_occupancy_count,
      v_area.name,
      v_time_slot
    ),
    jsonb_build_object(
      'occupancy_count', p_occupancy_count,
      'time_slot', v_time_slot,
      'record_date', v_record_date,
      'is_off_hours', v_is_off_hours,
      'session_id', p_session_id
    )
  );

  return v_record;
end;
$$;

revoke all on function public.submit_occupancy_record(bigint, integer, text, bigint, text) from public;
grant execute on function public.submit_occupancy_record(bigint, integer, text, bigint, text) to authenticated;
