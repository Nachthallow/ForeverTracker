-- Where each dungeon is, which dungeons make one trip, and which dungeons
-- feed quests or keys into others. Approved by Scott on 2026-11-18.
--
-- Classic zones: each dungeon's Warcraft Tavern Forever guide (zone_source).
-- New dungeons: Blizzard's "Explore the New Dungeons of World of Warcraft:
-- Forever" (already in zone). trip_area groups neighbouring zones; it is a
-- judgment, shown to Scott before seeding.

alter table public.dungeons
  add column trip_area text,
  add column zone_source text;

update public.dungeons d set zone = m.zone, zone_source = m.src
from (values
  ('Ragefire Chasm',               'Orgrimmar',           'https://www.warcrafttavern.com/forever/guides/ragefire-chasm/'),
  ('The Deadmines',                'Westfall',            'https://www.warcrafttavern.com/forever/guides/the-deadmines/'),
  ('Wailing Caverns',              'The Barrens',         'https://www.warcrafttavern.com/forever/guides/wailing-caverns/'),
  ('Shadowfang Keep',              'Silverpine Forest',   'https://www.warcrafttavern.com/forever/guides/shadowfang-keep/'),
  ('Blackfathom Deeps',            'Ashenvale',           'https://www.warcrafttavern.com/forever/guides/blackfathom-deeps/'),
  ('The Stockade',                 'Stormwind City',      'https://www.warcrafttavern.com/forever/guides/the-stockade-dungeon-map-location-bosses/'),
  ('Razorfen Kraul',               'The Barrens',         'https://www.warcrafttavern.com/forever/guides/razorfen-kraul/'),
  ('Gnomeregan',                   'Dun Morogh',          'https://www.warcrafttavern.com/forever/guides/gnomeregan/'),
  ('Scarlet Monastery: Graveyard', 'Tirisfal Glades',     'https://www.warcrafttavern.com/forever/guides/scarlet-monastery-graveyard/'),
  ('Scarlet Monastery: Library',   'Tirisfal Glades',     'https://www.warcrafttavern.com/forever/guides/scarlet-monastery-library/'),
  ('Scarlet Monastery: Armory',    'Tirisfal Glades',     'https://www.warcrafttavern.com/forever/guides/scarlet-monastery-armory/'),
  ('Scarlet Monastery: Cathedral', 'Tirisfal Glades',     'https://www.warcrafttavern.com/forever/guides/scarlet-monastery-cathedral/'),
  ('Razorfen Downs',               'The Barrens',         'https://www.warcrafttavern.com/forever/guides/razorfen-downs/'),
  ('Uldaman',                      'Badlands',            'https://www.warcrafttavern.com/forever/guides/uldaman/'),
  ('Zul''Farrak',                  'Tanaris',             'https://www.warcrafttavern.com/forever/guides/zulfarrak/'),
  ('Maraudon',                     'Desolace',            'https://www.warcrafttavern.com/forever/guides/maraudon/'),
  ('The Temple of Atal''Hakkar',   'Swamp of Sorrows',    'https://www.warcrafttavern.com/forever/guides/sunken-temple/'),
  ('Blackrock Depths',             'Blackrock Mountain',  'https://www.warcrafttavern.com/forever/guides/blackrock-depths/'),
  ('Lower Blackrock Spire',        'Blackrock Mountain',  'https://www.warcrafttavern.com/forever/guides/lower-blackrock-spire/'),
  ('Upper Blackrock Spire',        'Blackrock Mountain',  'https://www.warcrafttavern.com/forever/guides/upper-blackrock-spire/'),
  ('Dire Maul: East',              'Feralas',             'https://www.warcrafttavern.com/forever/guides/dire-maul-east/'),
  ('Dire Maul: West',              'Feralas',             'https://www.warcrafttavern.com/forever/guides/dire-maul-west/'),
  ('Dire Maul: North',             'Feralas',             'https://www.warcrafttavern.com/forever/guides/dire-maul-north/'),
  ('Scholomance',                  'Western Plaguelands', 'https://www.warcrafttavern.com/forever/guides/scholomance/'),
  ('Stratholme: Dead',             'Eastern Plaguelands', 'https://www.warcrafttavern.com/forever/guides/stratholme-living/'),
  ('Stratholme: Live',             'Eastern Plaguelands', 'https://www.warcrafttavern.com/forever/guides/stratholme-living/')
) as m(name, zone, src)
where d.name = m.name;

update public.dungeons d set zone_source = 'https://news.blizzard.com/en-us/article/24301455'
where d.is_new;

update public.dungeons d set trip_area = case
  when zone in ('Tirisfal Glades', 'Silverpine Forest') then 'Northern Lordaeron'
  when zone in ('Westfall', 'Stormwind City') then 'Stormwind and Westfall'
  when zone = 'Dun Morogh' then 'Dun Morogh'
  when zone = 'Wetlands' then 'Wetlands'
  when zone = 'Alterac Mountains' then 'Alterac Mountains'
  when zone in ('The Barrens', 'Orgrimmar') then 'Barrens and Orgrimmar'
  when zone = 'Ashenvale' then 'Ashenvale'
  when zone = 'Stranglethorn Vale' then 'Stranglethorn'
  when zone = 'Badlands' then 'Badlands'
  when zone in ('Tanaris', 'Un''Goro Crater') then 'Tanaris and Un''Goro'
  when zone = 'Swamp of Sorrows' then 'Swamp of Sorrows'
  when zone = 'Riverglades' then 'Riverglades'
  when zone = 'Dustwallow Marsh' then 'Dustwallow Marsh'
  when zone = 'Desolace' then 'Desolace'
  when zone = 'Feralas' then 'Feralas'
  when zone = 'Azshara' then 'Azshara'
  when zone = 'Blackrock Mountain' then 'Blackrock Mountain'
  when zone in ('Western Plaguelands', 'Eastern Plaguelands') then 'Plaguelands'
end;

-- A dungeon whose quests or drops unlock something in another: run it first.
create table public.dungeon_feeders (
  id           bigint generated always as identity primary key,
  from_dungeon text not null,
  to_dungeon   text not null,
  quest        text not null,
  leads_to     text,
  faction      text check (faction in ('ALLIANCE', 'HORDE')),  -- null: both
  how          text,
  source       text not null
);

alter table public.dungeon_feeders enable row level security;
create policy "anyone can read" on public.dungeon_feeders for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.dungeon_feeders from anon, authenticated;

insert into public.dungeon_feeders (from_dungeon, to_dungeon, quest, leads_to, faction, how, source) values
  ('The Deadmines', 'The Stockade', 'The Unsent Letter', 'The Stockade Riots', 'ALLIANCE',
   'An Unsent Letter drops from Edwin VanCleef; it leads through Bazil Thredd to The Stockade Riots.',
   'https://www.warcrafttavern.com/forever/guides/the-deadmines/ ; https://www.wowhead.com/classic/quest=373/the-unsent-letter'),
  ('Razorfen Kraul', 'Razorfen Downs', 'An Unholy Alliance', 'An Unholy Alliance', 'HORDE',
   'A Small Scroll drops in Razorfen Kraul; Varimathras in Undercity then gives the Razorfen Downs quest.',
   'https://www.warcrafttavern.com/forever/guides/razorfen-downs/ ; https://www.wowhead.com/classic/quest=6522/an-unholy-alliance'),
  ('Razorfen Kraul', 'Scarlet Monastery: Graveyard', 'Going, Going, Guano!', 'Hearts of Zeal', 'HORDE',
   'Going, Going, Guano! must be done before Hearts of Zeal.',
   'Efficient Games quest chain (nextQuestId), build 1.60.1.70938'),
  ('Zul''Farrak', 'The Temple of Atal''Hakkar', 'The Prophecy of Mosh''aru', 'The God Hakkar', null,
   'Tablets from Theka the Martyr and Hydromancer Velratha start a chain that ends at the Avatar of Hakkar.',
   'https://www.wowhead.com/classic/quest=3528/the-god-hakkar'),
  ('Lower Blackrock Spire', 'Upper Blackrock Spire', 'Seal of Ascension', 'The key to Upper Blackrock Spire', null,
   'One of you needs the Seal of Ascension, made from gems of three Lower Blackrock Spire generals, to open the door.',
   'https://www.warcrafttavern.com/forever/guides/upper-blackrock-spire/ ; https://www.wowhead.com/classic/quest=4742/seal-of-ascension'),
  ('Lower Blackrock Spire', 'Upper Blackrock Spire', 'General Drakkisath''s Command', 'General Drakkisath''s Demise', 'ALLIANCE',
   'Drops from Overlord Wyrmthalak; after Marshal Maxwell, the follow-up is General Drakkisath.',
   'https://www.warcrafttavern.com/forever/guides/lower-blackrock-spire/ ; https://www.wowhead.com/classic/quest=5102/general-drakkisaths-demise'),
  ('Lower Blackrock Spire', 'Upper Blackrock Spire', 'Warlord''s Command', 'For The Horde!', 'HORDE',
   'Kill Omokk, Voone and Wyrmthalak for the documents; the chain ends at Rend Blackhand.',
   'https://www.wowhead.com/classic/quest=4974/for-the-horde'),
  ('Blackrock Depths', 'Upper Blackrock Spire', 'Jail Break!', 'Drakefire Amulet', 'ALLIANCE',
   'Jail Break! starts the chain that ends with General Drakkisath''s blood for the Drakefire Amulet.',
   'https://warcraft.wiki.gg/wiki/Stormwind_Rendezvous ; https://www.wowhead.com/classic/quest=6502/drakefire-amulet'),
  ('Scarlet Monastery: Library', 'Stratholme: Live', 'The Scarlet Key', 'Entry to the Scarlet Bastion', null,
   'The Scarlet Key from Doan''s Strongbox opens the Scarlet Bastion, about half of Stratholme''s bosses.',
   'https://www.warcrafttavern.com/forever/guides/stratholme-living/');
