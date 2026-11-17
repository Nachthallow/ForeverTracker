# Forever Roster: plan and handoff for Claude Code

Revised 2026-11-17 (second version). The goals changed after the first
roster went live. This file replaces the earlier phase plan: where the code
or database still follows the old plan, this file wins. Read it all, compare
it with what is in the repo and the database, tell Scott what has to change,
and wait for his go-ahead.

## What this is

"Forever Roster" is a group planner for Scott and his friends in World of
Warcraft: Forever. It is not a character tracker with extras. Characters are
the input; the point is to help the group play together. It has four goals:

1. See which dungeons the group can run together.
2. Get everyone's dungeon quests ready before a run, above all the quests
   that cannot be shared and must be picked up by each person beforehand.
3. See whether items are useful to each other: who can craft what for whom,
   and which dungeon drops beat what a friend is wearing.
4. Keep track of each other's levels so nobody out-levels the group.

Nothing is updated by hand. Everything shown comes from Blizzard's API or
from the open game data described below. The only things a person ever types
are a character's name to add it, and the group passphrase.

## How we work

- Work in phases. Stop after each phase, show Scott what exists, and wait.
- At any real choice point, stop and ask instead of picking.
- Commit before every set of edits so anything can be rolled back.
- Never put secrets in the repo. The Blizzard client secret, the Supabase
  secret key and the group passphrase live only in Supabase Edge Function
  secrets. Never ask Scott to paste them into chat.
- Scott prefers prose over bullets in replies, direct answers, and honest
  tradeoffs over reassurance.
- Verify game facts against a source. Do not write level ranges, quest lists
  or other game data from memory.
- Scott knows GitLab and is learning GitHub on this project. Explain
  GitHub-specific steps briefly when they come up.

## Current state

- Local folder: `C:\Users\Strife\Projects\WoWForever`, a git repo.
- Remote: `https://github.com/Nachthallow/ForeverTracker.git`, now public.
- Live site: `https://nachthallow.github.io/ForeverTracker/`, deployed by a
  GitHub Actions workflow on every push to `main`.
- Built so far (the old Phase 1): Vite site, `sync` Edge Function, roster
  grid with one card per character, "Add character" form, faction, region
  and sort filters, Refresh per card. Nachtwald Ravensong is on it.
- Gap Scott hit: the site stores gear, professions and quests but shows none
  of them. Confirm what is really stored before building on it.
- Supabase: Free plan. `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` are
  set as Edge Function secrets.
  - Project ref: `mwvppjxhtylnrfjdcrmt`
  - Project URL: `https://mwvppjxhtylnrfjdcrmt.supabase.co`
    (REST at `/rest/v1/`, functions at `/functions/v1/`)
  - Publishable key (public, safe in the repo and the browser):
    `sb_publishable_W_rg3VS8kNXaInCD8Hp8UQ_LbEZaUzX`
  - This project uses the newer key format. Use the publishable key wherever
    older guides say "anon key". Never ask for or store the secret key
    (`sb_secret_...`) or the legacy `service_role` key.
- The `probe` function was throwaway. If `sync` works, delete `probe` from
  the repo and from Supabase.

## Decisions

Still standing:

- Static site, plain HTML/CSS/JS with Vite, on GitHub Pages. Supabase for
  Postgres, RLS, Edge Functions and pg_cron.
- Every character re-synced every 6 hours, plus a manual Refresh with a
  10-minute cooldown.
- Region stored per character, default `us`. Everyone is on NA today. Keep
  the region selector.
- Store and show the live quest log, the Blizzard avatar, and the ruleset.
- Dungeon quest data comes from Efficient Games, never from an addon.

Changed on 2026-11-17:

- No ownership. No claims, no per-character PINs, no display names. Remove
  `claimed_by`, `pin_hash`, `claimed_at` and anything built for them.
- No manual needs board. Drop the `needs` table and the QUEST / GEAR /
  RECIPE / HUNTING types. Wants are derived from data, not typed in.
- No self-reported fields. Drop `zone`. No role field (tank, healer,
  damage) for now; Scott chose to keep everything automatic.
- Access: anyone with the link can view everything. Adding or removing a
  character needs one group passphrase that Scott shares with his friends.
- Level history is recorded from now on.
- The front page is the group view, not the roster grid.

Changed again on 2026-11-17, after friends joined:

- Characters can be tagged to a player (a display name), because one person
  with several characters should not count as several people. Anyone with
  the group passphrase can set or change the tag. This is the one typed
  field besides the character name and the passphrase.
- No hand-picked main. A player is placed by their highest-level character;
  the rest are shown as that player's other characters.
- Group views count players, not characters. A player is flagged as too far
  only if none of their characters is within 5 levels of the group. Untagged
  characters count as their own player.

## Group passphrase

- One passphrase for the whole group. Scott sets it as an Edge Function
  secret (suggest the name `GROUP_PASSPHRASE`) himself, in the dashboard.
- Add and remove go through an Edge Function that checks the passphrase
  server-side with a constant-time compare. The browser never decides.
- Rate-limit wrong attempts (5 tries, then 15 minutes, per IP).
- The site asks for it once, then remembers it in that browser
  (localStorage, wrapped in try/catch) with a "forget" link.
- Say plainly in the UI copy that this keeps strangers out and is not real
  security. Reads stay open through RLS; there are still no direct writes
  from the browser.
- Removing a character deletes its synced data and history. Ask to confirm.

## Phase 0 result: the Blizzard API works

Tested 2026-11-17 with "Nachtwald Ravensong", region `us`. A client
credentials token is enough; no user login is needed.

- Token: `POST https://oauth.battle.net/token`, basic auth with the client ID
  and secret, body `grant_type=client_credentials`.
- Profile: `GET https://{region}.api.blizzard.com/profile/wow/character/{slug}?namespace=profile-forever-{region}&locale=en_US`
- Slug: lowercase `name-surname`, URL-encoded. Characters are realmless.
- All of these returned 200 on the same path: base profile, `status`,
  `equipment`, `professions`, `quests`, `quests/completed`, `character-media`,
  `specializations`, `statistics`, `achievements`, `reputations`, `appearance`.

Fields that came back:

| Need | Endpoint | Field |
|---|---|---|
| Blizzard character id | base | `id` |
| First name, surname | base | `name`, `surname` |
| Level, XP | base | `level`, `experience` |
| Class | base | `character_class.name`, `.id` |
| Race | base | `race.name`, `.id` |
| Faction | base | `faction.type` (`ALLIANCE` / `HORDE`) |
| Guild | base | `guild.name` (may be absent) |
| Item level | base | `average_item_level`, `equipped_item_level` |
| Ruleset | base | `ruleset.name`, `.id` |
| Last login | base | `last_login_timestamp` |
| Gear | `equipment` | `equipped_items[]`: `name`, `slot.type`, `quality.type`, `item.id`, `stats[]` |
| Professions | `professions` | `primaries[]`, `secondaries[]`: `profession.name`, `tiers[].skill_points`, `.max_skill_points` |
| Known recipes | `professions` | `tiers[].known_recipes[]`: `id`, `name` |
| Quests in progress | `quests` | `in_progress[]`: `id`, `name` |
| Quests completed | `quests/completed` | `quests[]`: `id`, `name` |
| Avatar | `character-media` | `assets[]` where `key` is `avatar` |
| Zone | none | not exposed; keep it optional and self-reported |

Sample values for the test character, useful for checking the sync: id
26102352, level 32, Druid, race "High Order Skyborne" (id 95), Alliance,
guild "Random Jerk", 16 equipped items, Leatherworking 144/225, 36 quests in
progress, 342 completed.

Things to know:

- Response sizes: `quests/completed` about 50 KB, `equipment` about 31 KB,
  `professions` about 12 KB. A full sync is about six calls per character.
- A wrong region returns 404 on every endpoint. The first probe run used `eu`
  for an NA character and got exactly that. Make the "Add character" error
  say "not found in this region" and suggest trying the other one.
- Reported by others, not verified by us: a character appears in the API only
  from level 10 and only after logging out, and data updates on logout.
- EU is unverified. Around 6 to 8 November several people reported 404 for
  every EU Forever character endpoint. We have no EU character to test with.
  Ship EU in the selector but treat failures there as possibly Blizzard's.
- The API is undocumented and may change. Keep all Blizzard URL building and
  field mapping in one module, and store the raw equipment and professions
  JSON so a mapping change does not need a re-fetch.
- Links inside responses point at a versioned static namespace, for example
  `static-1.60.1_70399-forever-us`.

## Dungeon quest data: Efficient Games

Source: `https://github.com/JIVESCORP/eg-link-output-wowf`, updated daily.
License CC BY 4.0. Required credit, to go in the README and the site footer:

> Data from [Efficient Games](https://efficient.games), licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed: reduced
> to dungeon quests and their prerequisites.

Layout: `data/wowf/<clientBuild>/`. The build checked was `1.60.1.70938`.
`DATASETS.md` in that repo documents every field; read it before writing the
importer.

- `quests.enUS.json`: `quests[questId]` with `title`, `level`, `minLevel`,
  `questInfoId`, `zoneAreaId`, `raceMask`, `rewards`. 5,377 quests.
  `questInfoId` 81 means Dungeon; 458 quests have it.
- `quest_prerequisites.json`: `quests[questId].before` is a list of quest IDs
  that come first. Built from what players' addons observed.
- `npcs.json`: quest givers, with `offers[questId]` and `takes[questId]` and
  positions. This is the "where do I pick it up" data.
- `quest_scan.json`: which quests the server actually describes.

Quest IDs are Blizzard's, the same IDs the profile API returns. Spot check:
from the test character's log, 92457 "Starving Arcane" and 1050 "Mythology of
the Titans" are both typed 81.

Open problems, to solve in Phase C and show Scott:

1. The 458 includes junk such as test quests (quest 1 is one). Filter to
   quests that are obtainable, probably those some NPC or object offers.
2. How a quest maps to its dungeon is unconfirmed. `zoneAreaId` is the likely
   key. Many dungeon quests are picked up outside the dungeon.
3. Prerequisite chains may be incomplete for rarely done quests.
4. Faction and class limits must be respected (`raceMask`), or counts will be
   wrong per character.

Do not copy data from the Naowh Forever addon. Its own content is all rights
reserved; only its bundled libraries are MIT. It is the addon Scott uses in
game, so use it as the check: for Nachtwald at level 32 on 2026-11-17 its
Dungeon Journal showed these quest counts (completed out of total), and ours
should match:
Blackfathom Deeps 0/6, Excavation Site: Wetlands 8/9, Gnomeregan 1/11, City
of Dalaran 3/4, The Stockade shown as complete.

## The plan

Each phase ends with something a friend can use. Stop after each one.

### Phase A: character sheets and the level line

- Confirm equipment, professions and quests are stored for every character.
  Fix the sync if not.
- Clean up for the changed decisions: drop the claim columns, the `needs`
  table and `zone` if they exist. Show Scott the migration first.
- Add `level_snapshots` (character_id, level, experience, taken_at). Write a
  row at each sync when level or experience changed.
- Character page with its own link: header as on the card; gear by slot with
  the item name in its quality colour plus the quality word; professions
  with skill and max and a collapsible recipe list; the in-progress quest
  log; a count of completed quests.
- Level line on the front page: every character in level order on one row,
  the gap between highest and lowest, last login, and, once there is
  history, levels gained in the last 7 days. Flag anyone far enough ahead or
  behind that shared content stops overlapping; propose the threshold to
  Scott, do not invent it.
- Add and remove behind the group passphrase.

### Phase B: dungeons the group can run

- Seed `dungeons` (name, zone, min_level, max_level, faction_note, is_new)
  with the classic 1-60 dungeons and Forever's nine new ones. Take level
  ranges from a source you can cite and show Scott the table before seeding.
- Front page section "What we can run": each dungeon with who fits now, who
  is close (say how close), and who is past it. Group by "For the group
  now" and "Coming up". Mark new-in-Forever dungeons.
- Respect region, faction and ruleset: characters that cannot group
  together are not counted together.
- Core value, in Scott's words: list dungeons in range, how many quests each
  person has ready for them, and whether they have already done the dungeon
  for the achievement. This is what the Naowh addon is used for.
- "Done the dungeon": the `achievements` response for Nachtwald (30 entries)
  holds exploration, profession and class achievements plus "Novice
  Spelunker" and "Experienced Spelunker", but no per-dungeon entries, even
  though Naowh shows The Stockade complete. The base profile also links an
  `encounters` endpoint (in retail, `encounters/dungeons` gives completions
  per dungeon). Probe both before designing this.

### Phase C: dungeon quest prep

- Import the Efficient Games data with a script that can be re-run for a new
  build. Tables: `dungeon_quests` (quest_id, dungeon_id, title, level,
  min_level, faction, shareable, giver, giver_zone) and `quest_prereqs`
  (quest_id, requires_quest_id).
- Find the sharing flag. Naowh's credits say the Efficient Games data
  supplies it for dungeon quests; locate the field in `DATASETS.md` (likely
  in the quest `flags`) and confirm with a few known quests.
- Per dungeon, per character: each quest as done, in the log, available to
  pick up, or blocked by a pre-quest. A count on each dungeon.
- "Get ready" view for a dungeon and a chosen set of characters: for each
  person, what to pick up and which pre-quests to do first, in chain order,
  with unshareable quests listed first and shareable ones marked "one of you
  can share this".
- A small "group readiness" section on the front page (Scott asked for it):
  per dungeon that fits the group, how many players have their quests ready,
  counting each player once.
- Check the filtered list against Scott's in-game journal before calling it
  done (numbers in the data section below).

### Phase D: crafting for each other

- From known recipes: for any character, "who in the group can make this"
  and "what can I make that someone could wear or use".
- Needs recipe-to-item data. Check what the Blizzard game-data API
  (`/data/wow/recipe/{id}`) and the Efficient Games `trainers` data give
  before designing. Show Scott what is possible first.

### Phase E: loot planning

- For a dungeon, which drops are better than what each character has
  equipped in that slot.
- Check the Efficient Games `loot` and `encounters` datasets first; they are
  untested here. "Better" needs a rule Scott agrees to (item level and
  usable armour type is the simple version). Propose it, do not assume it.
- Optional extra, last: a search box, "I got this item, who can use it",
  showing who can equip it and what they wear in that slot now. Blizzard
  does not expose bags or bank, so this can never be automatic.

### Phase F: polish

Mobile layout, empty states, "updated 2h ago" stamps, and a README covering
setup, how a friend adds a character, the passphrase, and the data credits.

## Answered questions

1. Naowh journal counts are completed quests out of the total for that
   dungeon. A quest only in the log does not count as done.
2. Classes not in the theme list show in plain text.
3. Level line: flag anyone more than 5 levels from the group. Once Phase B
   has dungeon ranges, "too far" may move to "no dungeon fits both".
4. Removing a character is final, after a confirmation.
5. Character pages use `character.html?c=<region>/<slug>`. The roster cards
   stay on the front page below the level line.

## Theme: "Forever Roster"

Unofficial fan theme. No Blizzard logos, crests, icons or fonts; everything
is drawn in CSS. The one exception Scott approved is the character avatar
from the API. Faction, ruleset and region are text badges.

- Ground: page #170e09, panels #2f231e, hover #3d2e26. No pure black or grey.
- Leather (character cards only): gradient #6b4a33 to #8a6548, 2px #c9b58f
  frame, inset top highlight, all text with a 0 1px 2px #000 shadow.
- Text: body #ebdec2, muted #b8a98a (never on leather), white on leather.
- Gold: character names #ffd100, headings #daa520, anything clickable #f8b700.
- Faction: Alliance #5b8fe6, Horde #ef5b50. Done/success #7ac96a.
- Item quality: poor #9d9d9d, common #ffffff, uncommon #1eff00,
  rare #4a9eff, epic #b85cff, legendary #ff8000.
- Class: warrior #c69b6d, paladin #f48cba, hunter #aad372, rogue #fff468,
  priest #f5f5f5, shaman #4a9eff, mage #3fc7eb, warlock #9c9df5, druid #ff7c0a.
  Always show the class word too; colour is never the only signal.
- Type: headings and character names in Marcellus (Google Fonts), body in
  Open Sans. Names 22px, headings 28px, body 14/22, tags 11px bold uppercase.
- Shape: radius 2px (chips, buttons) and 4px (cards). Spacing 4/8/12/16/24/32.
- Buttons: outlined gold by default, one solid gold per view, white 2px
  focus ring.
- Voice: short and plain, like a note on a guild board. No emoji.
