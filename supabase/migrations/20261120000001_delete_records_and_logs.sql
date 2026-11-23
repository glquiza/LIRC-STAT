  -- -----------------------------------------------------------------------------
-- LIRC STAT: ENABLE LIBRARIAN DELETION FOR OCCUPANCY RECORDS AND ACTIVITY LOGS
-- -----------------------------------------------------------------------------

-- 1. Grant delete on occupancy_records to authenticated
grant delete on public.occupancy_records to authenticated;

-- 2. RLS policy for deleting occupancy records (Librarians only)
drop policy if exists "occupancy_records_delete_librarian" on public.occupancy_records;
create policy "occupancy_records_delete_librarian"
  on public.occupancy_records
  for delete
  to authenticated
  using ((select private.is_librarian()));

-- 3. Grant delete on activity_logs to authenticated
grant delete on public.activity_logs to authenticated;

-- 4. RLS policy for deleting activity logs (Librarians only)
drop policy if exists "activity_logs_delete_librarian" on public.activity_logs;
create policy "activity_logs_delete_librarian"
  on public.activity_logs
  for delete
  to authenticated
  using ((select private.is_librarian()));

-- 5. RPC function: Admin Delete Occupancy Record (with audit logging)
create or replace function public.admin_delete_occupancy_record(
  p_record_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_record public.occupancy_records;
  v_area public.library_areas;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can delete occupancy records.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;
  select * into v_record from public.occupancy_records where id = p_record_id;
  if not found then
    return false;
  end if;

  select * into v_area from public.library_areas where id = v_record.area_id;

  delete from public.occupancy_records where id = p_record_id;

  -- Log deletion in activity_logs
  insert into public.activity_logs (
    action_type, actor_id, actor_name, actor_role, area_id, area_name, target_type, target_id, description, metadata
  ) values (
    'record_corrected',
    v_actor.id,
    v_actor.full_name,
    v_actor.role,
    v_record.area_id,
    coalesce(v_area.name, 'Library Area'),
    'occupancy_record',
    p_record_id::text,
    format('%s permanently deleted occupancy record for %s on %s at %s (Count was: %s)',
      v_actor.full_name, coalesce(v_area.name, 'Area'), v_record.record_date, v_record.time_slot, v_record.occupancy_count),
    jsonb_build_object(
      'action', 'record_deleted',
      'deleted_record_id', p_record_id,
      'record_date', v_record.record_date,
      'time_slot', v_record.time_slot,
      'occupancy_count', v_record.occupancy_count
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_delete_occupancy_record(bigint) from public;
grant execute on function public.admin_delete_occupancy_record(bigint) to authenticated;

-- 6. RPC function: Admin Delete Activity Log
create or replace function public.admin_delete_activity_log(
  p_log_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can delete activity logs.';
  end if;

  delete from public.activity_logs where id = p_log_id;
  return true;
end;
$$;

revoke all on function public.admin_delete_activity_log(bigint) from public;
grant execute on function public.admin_delete_activity_log(bigint) to authenticated;

-- 7. RPC function: Admin Batch Delete Occupancy Records
create or replace function public.admin_batch_delete_occupancy_records(
  p_record_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor public.user_profiles;
  v_count integer := 0;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can delete occupancy records.';
  end if;

  select * into v_actor from public.user_profiles where id = v_uid;

  delete from public.occupancy_records where id = any(p_record_ids);
  get diagnostics v_count = row_count;

  -- Log batch deletion in activity_logs
  if v_count > 0 then
    insert into public.activity_logs (
      action_type, actor_id, actor_name, actor_role, target_type, target_id, description, metadata
    ) values (
      'record_corrected',
      v_actor.id,
      v_actor.full_name,
      v_actor.role,
      'occupancy_records_batch',
      format('%s records', v_count),
      format('%s permanently deleted %s occupancy records in batch', v_actor.full_name, v_count),
      jsonb_build_object(
        'action', 'records_batch_deleted',
        'count', v_count,
        'deleted_record_ids', p_record_ids
      )
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.admin_batch_delete_occupancy_records(bigint[]) from public;
grant execute on function public.admin_batch_delete_occupancy_records(bigint[]) to authenticated;

-- 8. RPC function: Admin Batch Delete Activity Logs
create or replace function public.admin_batch_delete_activity_logs(
  p_log_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not private.is_librarian() then
    raise exception 'UNAUTHORIZED: Only Librarians can delete activity logs.';
  end if;

  delete from public.activity_logs where id = any(p_log_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_batch_delete_activity_logs(bigint[]) from public;
grant execute on function public.admin_batch_delete_activity_logs(bigint[]) to authenticated;
