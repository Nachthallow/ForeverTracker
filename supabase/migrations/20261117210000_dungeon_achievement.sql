-- Which Spelunker achievement each dungeon counts for (Blizzard achievements
-- 62031 Novice, 62032 Experienced, 62033 Master; see criteria_id). The Stockade
-- is in none of them.
alter table public.dungeons add column achievement text;

update public.dungeons set achievement = case
  when criteria_id in (230766, 230760, 230763, 230762, 231426, 230761) then 'Novice Spelunker'
  when criteria_id in (230769, 230771, 230772, 230770, 230774, 230775, 230776, 230777, 230773, 230778) then 'Experienced Spelunker'
  when criteria_id between 230780 and 230796 then 'Master Spelunker'
end;
