# Forever Roster: handoff for Claude Code

Written 2026-11-17 from a planning chat. Phase 0 is done. Start at Phase 1.
Read this whole file before doing anything, then tell Scott what you found
in the folder and wait for his go-ahead.

## What this is

"Forever Roster" is a small website that tracks Scott's and his friends'
World of Warcraft: Forever characters: level, class, gear, what each
character still wants (quests, gear, recipes, resources), which dungeons fit
their level, and which dungeon quests they have, have done, or still need.

## How we work

- Work in phases. Stop after each phase, show Scott what exists, and wait.
- At any real choice point, stop and ask instead of picking.
- Commit before every set of edits so anything can be rolled back.
- Never put secrets in the repo. The Blizzard client secret and the Supabase
  service key live only in Supabase Edge Function secrets. Never ask Scott to
  paste them into chat.
- Scott prefers prose over bullets in replies, direct answers, and honest
  tradeoffs over reassurance.
- Verify game facts against a source. Do not write level ranges, quest lists
  or other game data from memory.

## Current state

- Local folder: `C:\Users\Strife\Projects\WoWForever`. It holds `.gitignore`,
  this file, and `supabase/functions/probe/index.ts`. Check whether `git init`
  has been run and whether anything is committed; that was left to Scott.
- Remote: GitHub, `https://github.com/Nachthallow/ForeverTracker.git`. Scott
  has used GitLab before and is using GitHub here to learn it, so explain
  GitHub-specific steps (Pages, Actions) briefly when they come up.
- Supabase: a project exists on the Free plan. `BLIZZARD_CLIENT_ID` and
  `BLIZZARD_CLIENT_SECRET` are set as Edge Function secrets, and the `probe`
  function is deployed and working. The Supabase CLI may not be installed or
  linked yet; the probe was deployed through the dashboard.
  - Project ref: `mwvppjxhtylnrfjdcrmt`
  - Project URL: `https://mwvppjxhtylnrfjdcrmt.supabase.co`
    (REST at `/rest/v1/`, functions at `/functions/v1/`)
  - Publishable key (public, safe in the repo and the browser):
    `sb_publishable_W_rg3VS8kNXaInCD8Hp8UQ_LbEZaUzX`
  - This project uses the newer key format. Use the publishable key wherever
    older guides say "anon key". Never ask for or store the secret key
    (`sb_secret_...`) or the legacy `service_role` key.
- Blizzard: a developer client exists at develop.battle.net.
- The `probe` function is throwaway. Keep it until `sync` works, then delete
  it from the repo and from Supabase.

## Decisions made

- Frontend: static site, plain HTML/CSS/JS with Vite, hosted on GitHub Pages.
- Backend: Supabase (Postgres, Row Level Security, Edge Functions, pg_cron).
- Refresh: every character re-synced every 6 hours, plus a manual "Refresh"
  per character with a 10-minute cooldown.
- Region: stored per character, default `us`. Scott and all his friends are
  on NA. (The original prompt said Scott was on EU; that was wrong.) The UI
  still gets a region selector on "Add character" and as a roster filter.
- Claims: honor system with a PIN. No Battle.net login.
- Quest log: store and show each character's in-progress quests from the API,
  read-only, alongside the manual needs board.
- Avatars: use Blizzard's character-media avatar on the cards.
- Ruleset: store it and show it as a text badge.
- Dungeon quests: built from the Efficient Games open data (see below), not
  typed in by hand and not copied from any addon.

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

Open problems, to solve in the dungeon quest phase and show Scott:

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
Dungeon Journal showed these quest counts, and ours should match once we know
what the two numbers mean (ask Scott; probably done or in log, out of total):
Blackfathom Deeps 0/6, Excavation Site: Wetlands 8/9, Gnomeregan 1/11, City
of Dalaran 3/4, The Stockade shown as complete.

## Phase 1: schema, sync, read-only roster

Tables:

- `characters`: id, region, blizzard_id, first_name, surname, slug (unique
  per region), level, experience, class, race, faction, guild, ruleset,
  item_level, avatar_url, equipment jsonb, professions jsonb, zone (optional,
  self-reported), last_login_at, last_synced_at, claimed_by (display name),
  pin_hash, claimed_at
- `character_quests`: character_id, quest_id, name, state (in_progress |
  completed). Replaced on each sync.
- `dungeons`: id, name, zone, min_level, max_level, faction_note, is_new
- `needs`: id, character_id, type (quest | gear | recipe | hunting), name,
  quality, source, note, done, created_at

RLS: anonymous users can read everything except `pin_hash`. No direct writes
from the browser; every write goes through an Edge Function or a
security-definer RPC.

Edge Function `sync`: fetches one character or all, upserts, respects the
cooldown. Schedule it with pg_cron. Reuse the token and fetch code from
`probe`.

Page: roster grid of character cards, sortable by level, filter by faction
and region, "Add character" by name, surname and region (calls sync; rejects
names Blizzard does not know).

## Phase 2: claim and needs

- Claim: pick a display name and a PIN. Store only a bcrypt hash (pgcrypto).
  Editing a character's needs requires its PIN; keep it in sessionStorage,
  wrapped in try/catch. Rate-limit wrong PINs (5 tries, then 15 minutes).
- Say plainly in the UI copy that this is an honor system, not security.
- Needs board per character: add, tick done, remove. Four types, always in
  this order: QUEST, GEAR, RECIPE, HUNTING.
- "Can help" button for other people: records a display name against a need.
- Show the character's live quest log read-only next to the board.

## Phase 3: dungeon suggestions

Seed the `dungeons` table with the classic 1-60 dungeons and Forever's nine
new ones, with level ranges. Take the data from a source you can cite and
show Scott the table to verify before seeding. On each character, show
dungeons whose range includes its level, grouped as "For your level" and
"Coming up", with new-in-Forever dungeons marked, and a "who else fits" list
that respects faction and ruleset.

## Phase 4: dungeon quests

- Import the Efficient Games data with a script that can be re-run when they
  publish a new build. Tables: `dungeon_quests` (quest_id, dungeon_id, title,
  level, min_level, faction, giver, giver_zone) and `quest_prereqs`
  (quest_id, requires_quest_id).
- Per character and dungeon, show each quest as done, in the log, available,
  or blocked by a pre-quest, and a count on the dungeon card.
- "Get ready" view per dungeon: what to pick up and which pre-quests to do
  first, in chain order.
- Across friends: who still needs quests from the same dungeon.
- Show Scott the filtered quest list per dungeon and compare the counts with
  his in-game journal before calling it done.

## Phase 5: polish

Mobile layout, empty states, "updated 2h ago" stamps, a README explaining
setup, how a friend adds a character, and the data credits.

## Theme: "Forever Roster"

Unofficial fan theme. No Blizzard logos, crests, icons or fonts; everything
is drawn in CSS. The one exception Scott approved is the character avatar
from the API. Faction and ruleset are text badges.

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

## Questions to ask Scott before Phase 1 code

1. Has the local folder been committed and pushed to GitHub yet?
2. Is the Supabase CLI installed and linked to the project?
3. What do the two numbers in the Naowh journal's quest counts mean?
4. Races and classes: Forever has new races (the test character is one).
   Should class colours fall back to plain text for any class not in the
   theme list?
