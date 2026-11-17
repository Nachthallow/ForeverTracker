-- Raw Blizzard encounters/dungeons response, to learn whether Forever reports
-- dungeon completions. Null when the endpoint does not answer.
alter table public.characters add column encounters jsonb;

-- save_character_sync writes it like the other raw blobs.
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
    avatar_url, equipment, professions, encounters, last_login_at, last_synced_at, sync_error
  )
  select
    r.region, r.blizzard_id, r.first_name, r.surname, r.slug, r.level, r.experience,
    r.class, r.class_id, r.race, r.race_id, r.faction, r.guild, r.ruleset, r.item_level,
    r.avatar_url, r.equipment, r.professions, r.encounters, r.last_login_at, now(), null
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
    encounters     = excluded.encounters,
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
