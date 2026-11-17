-- Phase B: the dungeon table, and which dungeons each character has completed.
--
-- Level ranges, approved by Scott on 2026-11-17:
--   new dungeons: Blizzard, "Explore the New Dungeons of World of Warcraft: Forever"
--     https://news.blizzard.com/en-us/article/24301455
--   classic dungeons: wowforeverbuilds.com/dungeons ("official WoW Forever dungeon
--     chart", client build 1.60.1.70707)
-- Names and criteria_id come from Blizzard's Spelunker achievements (62031 Novice,
-- 62032 Experienced, 62033 Master). The Stockade is in none of them, so its
-- criteria_id is null and its completion cannot be known.

alter table public.dungeons
  add column criteria_id int,
  add column range_source text not null default 'wowforeverbuilds';

insert into public.dungeons (name, zone, min_level, max_level, faction_note, is_new, criteria_id, range_source) values
  ('Ragefire Chasm',                 null,                 13, 19, null, false, 230766, 'wowforeverbuilds'),
  ('Hall of Thanes',                 'Dun Morogh',         13, 18, 'Entrance inside Ironforge: easy for Alliance, a trip for Horde.', true, 230766, 'blizzard'),
  ('Ruins of Lordaeron',             'Tirisfal Glades',    15, 20, 'Entrance by the Undercity: easy for Horde, a trip for Alliance.', true, 230760, 'blizzard'),
  ('The Deadmines',                  null,                 18, 24, null, false, 230762, 'wowforeverbuilds'),
  ('Wailing Caverns',                null,                 19, 25, null, false, 230763, 'wowforeverbuilds'),
  ('Shadowfang Keep',                null,                 23, 29, null, false, 231426, 'wowforeverbuilds'),
  ('Excavation Site: Wetlands',      'Wetlands',           24, 29, null, true,  230761, 'blizzard'),
  ('Blackfathom Deeps',              null,                 25, 31, null, false, 230771, 'wowforeverbuilds'),
  ('The Stockade',                   null,                 26, 32, null, false, null,   'wowforeverbuilds'),
  ('City of Dalaran',                'Alterac Mountains',  28, 33, 'Separate quest starts for Alliance and Horde.', true, 230769, 'blizzard'),
  ('Razorfen Kraul',                 null,                 30, 36, null, false, 230773, 'wowforeverbuilds'),
  ('Scarlet Monastery: Graveyard',   null,                 31, 37, null, false, 230774, 'wowforeverbuilds'),
  ('Gnomeregan',                     null,                 31, 37, null, false, 230772, 'wowforeverbuilds'),
  ('Scarlet Monastery: Library',     null,                 34, 40, null, false, 230775, 'wowforeverbuilds'),
  ('The Drowned City',               'Stranglethorn Vale', 35, 40, null, true,  230770, 'blizzard'),
  ('Scarlet Monastery: Armory',      null,                 37, 43, null, false, 230776, 'wowforeverbuilds'),
  ('Razorfen Downs',                 null,                 38, 44, null, false, 230780, 'wowforeverbuilds'),
  ('Scarlet Monastery: Cathedral',   null,                 39, 45, null, false, 230777, 'wowforeverbuilds'),
  ('Krol''dok Stronghold',           'Riverglades',        40, 45, null, true,  230778, 'blizzard'),
  ('Uldaman',                        null,                 44, 50, null, false, 230781, 'wowforeverbuilds'),
  ('Zul''Farrak',                    null,                 45, 51, null, false, 230782, 'wowforeverbuilds'),
  ('Alcaz Prison',                   'Dustwallow Marsh',   48, 53, null, true,  230784, 'blizzard'),
  ('Maraudon',                       null,                 48, 54, null, false, 230783, 'wowforeverbuilds'),
  ('The Temple of Atal''Hakkar',     null,                 52, 58, null, false, 230785, 'wowforeverbuilds'),
  ('Blackrock Depths',               null,                 52, 60, null, false, 230786, 'wowforeverbuilds'),
  ('Dire Maul: East',                null,                 55, 60, null, false, 230792, 'wowforeverbuilds'),
  ('Blackmaw Hold',                  'Azshara',            55, 60, null, true,  230796, 'blizzard'),
  ('Upper Blackrock Spire',          null,                 56, 60, null, false, 230788, 'wowforeverbuilds'),
  ('Lower Blackrock Spire',          null,                 57, 60, null, false, 230787, 'wowforeverbuilds'),
  ('Dire Maul: West',                null,                 58, 60, null, false, 230794, 'wowforeverbuilds'),
  ('Scholomance',                    null,                 58, 60, null, false, 230789, 'wowforeverbuilds'),
  ('The Shaper''s Terrace',          'Un''Goro Crater',    58, 60, null, true,  230795, 'blizzard'),
  ('Stratholme: Dead',               null,                 59, 60, null, false, 230791, 'wowforeverbuilds'),
  ('Stratholme: Live',               null,                 59, 60, null, false, 230790, 'wowforeverbuilds'),
  ('Dire Maul: North',               null,                 59, 60, null, false, 230793, 'wowforeverbuilds');

-- Completed Spelunker criteria per character, from the achievements endpoint.
alter table public.characters add column dungeons_done int[] not null default '{}';

-- The encounters/dungeons endpoint answers with nothing for Forever.
alter table public.characters drop column encounters;

create or replace function public.save_character_sync(p_character jsonb, p_quests jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id    bigint;
  v_level int := (p_character ->> 'level')::int;
  v_xp    bigint := (p_character ->> 'experience')::bigint;
begin
  insert into public.characters (
    region, blizzard_id, first_name, surname, slug, level, experience,
    class, class_id, race, race_id, faction, guild, ruleset, item_level,
    avatar_url, equipment, professions, dungeons_done, last_login_at, last_synced_at, sync_error
  )
  select
    r.region, r.blizzard_id, r.first_name, r.surname, r.slug, r.level, r.experience,
    r.class, r.class_id, r.race, r.race_id, r.faction, r.guild, r.ruleset, r.item_level,
    r.avatar_url, r.equipment, r.professions, coalesce(r.dungeons_done, '{}'), r.last_login_at, now(), null
  from jsonb_populate_record(null::public.characters, p_character) as r
  on conflict (region, blizzard_id) do update set
    first_name     = excluded.first_name,
    surname        = excluded.surname,
    slug           = excluded.slug,
    level          = excluded.level,
    experience     = excluded.experience,
    class          = excluded.class,
    class_id       = excluded.class_id,
    race           = excluded.race,
    race_id        = excluded.race_id,
    faction        = excluded.faction,
    guild          = excluded.guild,
    ruleset        = excluded.ruleset,
    item_level     = excluded.item_level,
    avatar_url     = excluded.avatar_url,
    equipment      = excluded.equipment,
    professions    = excluded.professions,
    -- null in the payload means achievements did not load: keep what we had.
    dungeons_done  = case when p_character -> 'dungeons_done' is null or jsonb_typeof(p_character -> 'dungeons_done') = 'null'
                          then public.characters.dungeons_done else excluded.dungeons_done end,
    last_login_at  = excluded.last_login_at,
    last_synced_at = excluded.last_synced_at,
    sync_error     = null
  returning id into v_id;

  delete from public.character_quests where character_id = v_id;
  insert into public.character_quests (character_id, quest_id, name, state)
  select v_id, (q ->> 'quest_id')::int, q ->> 'name', q ->> 'state'
  from jsonb_array_elements(p_quests) as q
  on conflict do nothing;

  if v_level is not null and not exists (
    select 1 from (
      select s.level, s.experience from public.level_snapshots s
      where s.character_id = v_id
      order by s.taken_at desc limit 1
    ) as last
    where last.level = v_level and last.experience is not distinct from v_xp
  ) then
    insert into public.level_snapshots (character_id, level, experience) values (v_id, v_level, v_xp);
  end if;

  return v_id;
end;
$$;
