-- Players: one person can have several characters. Tagging is by hand,
-- behind the group passphrase, through the sync function.

create table public.players (
  id          bigint generated always as identity primary key,
  name        text not null check (length(btrim(name)) between 1 and 32),
  created_at  timestamptz not null default now()
);

-- "scott" and "Scott" are the same player.
create unique index players_name_key on public.players (lower(name));

alter table public.characters
  add column player_id bigint references public.players (id) on delete set null;

create index characters_player_id_idx on public.characters (player_id);

alter table public.players enable row level security;
create policy "anyone can read" on public.players for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.players from anon, authenticated;

-- Tags a character with a player by name, creating the player if needed.
-- An empty name removes the tag. Returns the player id, or null.
create function public.set_character_player(p_character_id bigint, p_player text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_name   text := nullif(btrim(p_player), '');
  v_player bigint;
begin
  if v_name is not null then
    insert into public.players (name) values (v_name)
    on conflict (lower(name)) do nothing;
    select id into v_player from public.players where lower(name) = lower(v_name);
  end if;

  update public.characters set player_id = v_player where id = p_character_id;
  if not found then
    raise exception 'no such character';
  end if;
  return v_player;
end;
$$;

revoke execute on function public.set_character_player(bigint, text) from public, anon, authenticated;
grant execute on function public.set_character_player(bigint, text) to service_role;

-- A player with no characters left is deleted, so typos clean themselves up.
create function public.delete_orphan_player()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.player_id is not null then
    delete from public.players p
    where p.id = old.player_id
      and not exists (select 1 from public.characters c where c.player_id = p.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.delete_orphan_player() from public, anon, authenticated;

create trigger characters_delete_orphan_player
after update of player_id or delete on public.characters
for each row execute function public.delete_orphan_player();
