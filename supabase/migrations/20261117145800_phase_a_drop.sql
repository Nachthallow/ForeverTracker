-- Phase A, part 2 of 2: remove what the changed decisions dropped.
-- Apply only after the new site (which no longer reads claimed_by) is live.
-- All of these were empty when this was written.

drop table public.needs;
drop table public.character_pins;

alter table public.characters
  drop column claimed_by,
  drop column claimed_at,
  drop column zone;

drop function public.replace_character_quests(bigint, jsonb);
