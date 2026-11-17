-- Phase A, part 1 of 2: additions only, safe to apply while the old site is live.

-- Level history ---------------------------------------------------------------

create table public.level_snapshots (
  character_id    bigint not null references public.characters (id) on delete cascade,
  level           int not null,
  experience      bigint,
  taken_at        timestamptz not null default now(),
  primary key (character_id, taken_at)
);

alter table public.level_snapshots enable row level security;
create policy "anyone can read" on public.level_snapshots for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.level_snapshots from anon, authenticated;

-- Start the history with where everyone is today.
insert into public.level_snapshots (character_id, level, experience)
select id, level, experience from public.characters where level is not null;

-- Levels gained in the last 7 days, or since history began if that is more
-- recent. history_since tells the page which of the two it is showing.
create view public.level_gains with (security_invoker = true) as
select
  c.id as character_id,
  c.level - coalesce(
    (select s.level from public.level_snapshots s
      where s.character_id = c.id and s.taken_at <= now() - interval '7 days'
      order by s.taken_at desc limit 1),
    (select s.level from public.level_snapshots s
      where s.character_id = c.id
      order by s.taken_at asc limit 1)
  ) as gained,
  (select min(s.taken_at) from public.level_snapshots s where s.character_id = c.id) as history_since
from public.characters c;

grant select on public.level_gains to anon, authenticated;

-- Wrong passphrase attempts, per IP. No policies: invisible to the browser.

create table public.passphrase_attempts (
  ip              text primary key,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  last_failed_at  timestamptz
);

alter table public.passphrase_attempts enable row level security;
revoke all on public.passphrase_attempts from anon, authenticated;

-- One sync, one transaction ---------------------------------------------------
-- Saves the character, swaps its quest log, and records a level snapshot when
-- level or experience changed. Replaces replace_character_quests.

create function public.save_character_sync(p_character jsonb, p_quests jsonb)
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
    avatar_url, equipment, professions, last_login_at, last_synced_at, sync_error
  )
  select
    r.region, r.blizzard_id, r.first_name, r.surname, r.slug, r.level, r.experience,
    r.class, r.class_id, r.race, r.race_id, r.faction, r.guild, r.ruleset, r.item_level,
    r.avatar_url, r.equipment, r.professions, r.last_login_at, now(), null
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

revoke execute on function public.save_character_sync(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_character_sync(jsonb, jsonb) to service_role;
