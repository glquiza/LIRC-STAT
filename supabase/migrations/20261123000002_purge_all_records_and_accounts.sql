-- =============================================================================
-- LIRC STAT: PURGE ALL RECORDS, LOGS, AND NON-LIBRARIAN ACCOUNTS
--
-- This script completely resets the database to a fresh state:
-- 1. Clears all occupancy count records & historical statistics
-- 2. Clears all activity/audit logs
-- 3. Clears all monitoring sessions & duty tracking
-- 4. Clears all saved report snapshots
-- 5. Clears all calendar activities (if table exists)
-- 6. Removes all student assistants, test accounts, and invitation codes
--    from public.user_profiles, auth.identities, and auth.users
-- 7. Preserves ONLY the primary Librarian administrator account:
--    DR. MARIA LORENA ABANGAN (@librarian / librarian@lirc.edu.ph)
-- =============================================================================

-- Step 1: Wipe all historical data and audit ledgers
truncate table public.occupancy_records restart identity cascade;
truncate table public.activity_logs restart identity cascade;
truncate table public.monitoring_sessions restart identity cascade;
truncate table public.saved_reports restart identity cascade;

-- Clear calendar activities table if it exists
do $$
begin
  if exists (
    select 1 from information_schema.tables 
    where table_schema = 'public' and table_name = 'calendar_activities'
  ) then
    execute 'truncate table public.calendar_activities cascade;';
  end if;
end;
$$;

-- Step 2: Delete all user profiles EXCEPT librarians
delete from public.user_profiles
where role != 'librarian';

-- Step 3: Delete all authentication users & identities EXCEPT the librarian
delete from auth.identities
where user_id in (
  select id from auth.users
  where id not in (
    select id from public.user_profiles where role = 'librarian'
  )
);

delete from auth.users
where id not in (
  select id from public.user_profiles where role = 'librarian'
);

-- Step 4: Ensure the Librarian account is active and clean
update public.user_profiles
set 
  shift_schedule = '8:00 AM - 6:00 PM',
  is_active = true,
  assigned_area_id = null
where role = 'librarian';

-- Step 5: Insert a fresh initial activity log
insert into public.activity_logs (
  action_type,
  actor_id,
  actor_name,
  actor_role,
  target_type,
  target_id,
  description,
  metadata
)
select 
  'system_purged',
  up.id,
  up.full_name,
  up.role,
  'database',
  'system',
  'All historical records, occupancy counts, audit logs, and non-librarian accounts were purged. System reset to fresh state.',
  jsonb_build_object('purged_at', now(), 'preserved_account', up.email)
from public.user_profiles up
where up.role = 'librarian'
limit 1;

-- Step 6: Reload the PostgREST API schema cache
notify pgrst, 'reload schema';
