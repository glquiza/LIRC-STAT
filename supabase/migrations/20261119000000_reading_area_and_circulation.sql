-- -----------------------------------------------------------------------------
-- LIRC STAT: ADD READING AREA (STATS REQUIRED) & CIRCULATION (NO STATS REQUIRED)
-- -----------------------------------------------------------------------------

-- 1. Rename existing Circulation row to Reading Area if present
update public.library_areas
set
  code = 'READ',
  slug = 'reading-area',
  name = 'Reading Area',
  description = 'Main reading hall, general study tables, and student study areas.',
  capacity = 80,
  color_hex = '#2E5A44',
  icon_name = 'BookOpen'
where code = 'CIR' or slug = 'circulation' or name = 'Circulation';

-- 2. Insert Reading Area if it does not yet exist
insert into public.library_areas (code, slug, name, description, floor_location, capacity, color_hex, icon_name, display_order, is_active)
select 'READ', 'reading-area', 'Reading Area', 'Main reading hall, general study tables, and student study areas.', '1st Floor, Main Hall', 80, '#2E5A44', 'BookOpen', 2, true
where not exists (
  select 1 from public.library_areas where code = 'READ' or name = 'Reading Area'
);
