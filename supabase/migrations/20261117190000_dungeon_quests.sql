-- Phase C: dungeon quests and their pre-quest chains.
-- Filled by scripts/import-quests.mjs from Efficient Games data (CC BY 4.0),
-- re-runnable for each new build. A quest belongs to the area Blizzard files
-- it under; a dungeon's wings share one area.

alter table public.dungeons add column area_id int;

update public.dungeons d set area_id = m.area_id
from (values
  ('Ragefire Chasm', 2437), ('Hall of Thanes', 16919), ('Ruins of Lordaeron', 16611),
  ('The Deadmines', 1581), ('Wailing Caverns', 718), ('Shadowfang Keep', 209),
  ('Excavation Site: Wetlands', 16732), ('Blackfathom Deeps', 719), ('The Stockade', 717),
  ('City of Dalaran', 16544), ('Razorfen Kraul', 1717), ('Scarlet Monastery: Graveyard', 796),
  ('Gnomeregan', 133), ('Scarlet Monastery: Library', 796), ('The Drowned City', 16550),
  ('Scarlet Monastery: Armory', 796), ('Razorfen Downs', 722), ('Scarlet Monastery: Cathedral', 796),
  ('Krol''dok Stronghold', 16842), ('Uldaman', 1517), ('Zul''Farrak', 1176),
  ('Alcaz Prison', 16620), ('Maraudon', 2100), ('The Temple of Atal''Hakkar', 1417),
  ('Blackrock Depths', 1584), ('Dire Maul: East', 2557), ('Blackmaw Hold', 16554),
  ('Upper Blackrock Spire', 1583), ('Lower Blackrock Spire', 1583), ('Dire Maul: West', 2557),
  ('Scholomance', 2057), ('The Shaper''s Terrace', 16985), ('Stratholme: Dead', 2017),
  ('Stratholme: Live', 2017), ('Dire Maul: North', 2557)
) as m(name, area_id)
where d.name = m.name;

create table public.dungeon_quests (
  quest_id     int primary key,
  area_id      int not null,
  title        text not null,
  level        int,
  min_level    int,
  faction      text check (faction in ('ALLIANCE', 'HORDE')),  -- null: both
  shareable    boolean,                                         -- null: unknown
  giver        text,
  source_build text not null
);

create index dungeon_quests_area_idx on public.dungeon_quests (area_id);

-- requires_quest_id must be done before quest_id (the server's nextQuestId
-- links). Pre-quests can themselves have pre-quests; the chain is stored
-- link by link.
create table public.quest_prereqs (
  quest_id          int not null,
  requires_quest_id int not null,
  requires_title    text,
  primary key (quest_id, requires_quest_id)
);

alter table public.dungeon_quests enable row level security;
alter table public.quest_prereqs enable row level security;
create policy "anyone can read" on public.dungeon_quests for select to anon, authenticated using (true);
create policy "anyone can read" on public.quest_prereqs for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.dungeon_quests, public.quest_prereqs from anon, authenticated;

-- Each character's quest log, cut down to dungeon quests and their pre-quests,
-- so the front page does not download every completed quest.
create view public.character_dungeon_quests with (security_invoker = true) as
select cq.character_id, cq.quest_id, cq.state
from public.character_quests cq
where cq.quest_id in (select quest_id from public.dungeon_quests)
   or cq.quest_id in (select requires_quest_id from public.quest_prereqs);

grant select on public.character_dungeon_quests to anon, authenticated;
