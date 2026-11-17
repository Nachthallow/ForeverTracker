-- Swaps a character's whole quest log in one transaction, so a failed sync
-- never leaves the roster showing an empty log. Only the sync function
-- (service role) may call it.

create function public.replace_character_quests(p_character_id bigint, p_quests jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.character_quests where character_id = p_character_id;

  insert into public.character_quests (character_id, quest_id, name, state)
  select p_character_id, (q ->> 'quest_id')::int, q ->> 'name', q ->> 'state'
  from jsonb_array_elements(p_quests) as q
  on conflict do nothing;
end;
$$;

revoke execute on function public.replace_character_quests(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.replace_character_quests(bigint, jsonb) to service_role;
