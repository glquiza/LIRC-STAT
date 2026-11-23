-- Enable Realtime publication for calendar_activities and user_profiles
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'calendar_activities') then
      if not exists (
        select 1 from pg_publication_tables 
        where pubname = 'supabase_realtime' 
          and schemaname = 'public' 
          and tablename = 'calendar_activities'
      ) then
        alter publication supabase_realtime add table public.calendar_activities;
      end if;
    end if;

    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'user_profiles') then
      if not exists (
        select 1 from pg_publication_tables 
        where pubname = 'supabase_realtime' 
          and schemaname = 'public' 
          and tablename = 'user_profiles'
      ) then
        alter publication supabase_realtime add table public.user_profiles;
      end if;
    end if;
  end if;
end $$;
