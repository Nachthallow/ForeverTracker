-- What comes after each dungeon quest, following the chain forward. Once a
-- later quest is done or in the log, an earlier one that is not done can no
-- longer be picked up (a breadcrumb, or a step the game let the player skip).
-- Filled by scripts/import-quests.mjs from nextQuestId plus
-- scripts/quest-breadcrumbs.json.
create table public.quest_next (
  quest_id      int primary key,
  next_quest_id int not null
);

alter table public.quest_next enable row level security;
create policy "anyone can read" on public.quest_next for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.quest_next from anon, authenticated;

-- The front page also needs the state of those later quests.
create or replace view public.character_dungeon_quests with (security_invoker = true) as
select cq.character_id, cq.quest_id, cq.state
from public.character_quests cq
where cq.quest_id in (select quest_id from public.dungeon_quests)
   or cq.quest_id in (select requires_quest_id from public.quest_prereqs)
   or cq.quest_id in (select next_quest_id from public.quest_next);
