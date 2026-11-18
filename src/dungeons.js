// Dungeons and their quests, shared by the front page and the character page:
// which dungeons a character can do, which quests they still need, and what
// to call it.
import { db, el, characterUrl, fullName } from "./lib.js";

// A player this many levels below a dungeon is "close".
const CLOSE_LEVELS = 3;
// A quest turns grey this many levels below the character (Efficient Games
// game_rules.trivialRange gives 5 at every level players have read it).
const GREY_LEVELS = 5;

export let dungeons = [];
export let feeders = []; // dungeons that feed quests or keys into others
let questsByArea = new Map(); // area_id -> dungeon quests
let prereqsOf = new Map(); // quest_id -> quests that come before it
let nextOf = new Map(); // quest_id -> the quest that comes after it
let questLogs = new Map(); // character_id -> Map(quest_id -> state)

// Pages through a query past the API's 1000-row limit.
async function fetchPages(query) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) {
      console.error(error);
      return rows;
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Reads a whole table past the API's 1000-row page limit.
async function fetchAll(table, columns) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) {
      console.error(table, error);
      return rows;
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Loads dungeons, their quests and chains, and the quest logs of the given
// characters (all characters when none are given).
export async function loadDungeonData(characterIds = null) {
  const logQuery = (from, to) => {
    let q = db.from("character_dungeon_quests").select("character_id, quest_id, state");
    if (characterIds) q = q.in("character_id", characterIds);
    return q.range(from, to);
  };
  const [dungeonRows, questRows, prereqRows, nextRows, logRows, feederRows] = await Promise.all([
    db.from("dungeons")
      .select("id, name, zone, trip_area, min_level, max_level, faction_note, is_new, criteria_id, area_id, achievement")
      .order("min_level")
      .order("max_level"),
    fetchAll("dungeon_quests", "quest_id, area_id, title, level, min_level, faction, shareable, giver"),
    fetchAll("quest_prereqs", "quest_id, requires_quest_id, requires_title"),
    fetchAll("quest_next", "quest_id, next_quest_id"),
    fetchPages(logQuery),
    fetchAll("dungeon_feeders", "from_dungeon, to_dungeon, quest, leads_to, faction, how"),
  ]);
  dungeons = dungeonRows.data ?? [];
  feeders = feederRows;

  questsByArea = new Map();
  for (const q of questRows) {
    if (!questsByArea.has(q.area_id)) questsByArea.set(q.area_id, []);
    questsByArea.get(q.area_id).push(q);
  }
  prereqsOf = new Map();
  for (const p of prereqRows) {
    if (!prereqsOf.has(p.quest_id)) prereqsOf.set(p.quest_id, []);
    prereqsOf.get(p.quest_id).push(p);
  }
  nextOf = new Map(nextRows.map((n) => [n.quest_id, n.next_quest_id]));
  questLogs = new Map();
  for (const row of logRows) {
    if (!questLogs.has(row.character_id)) questLogs.set(row.character_id, new Map());
    const log = questLogs.get(row.character_id);
    // Completed wins if a repeatable quest shows up as both.
    if (log.get(row.quest_id) !== "completed") log.set(row.quest_id, row.state);
  }

}

// What we can run -------------------------------------------------------------------

// How one player stands with one dungeon, using whichever of their characters
// suits it best: one in range that has not done it, else one in range, else
// the closest one below it.
export function dungeonDone(c, d) {
  if (d.criteria_id != null) return Boolean(c.dungeons_done?.includes(d.criteria_id));
  // Blizzard does not report this dungeon (The Stockade): all its quests done counts instead.
  const sum = questSummary(questsFor(c, d));
  return sum.total > 0 && sum.done === sum.total;
}

export function standing(unit, d) {
  // Any character at or above the minimum level can go. Being over-levelled
  // does not matter: an undone dungeon still counts for the achievement.
  const able = unit.characters
    .filter((c) => (c.level ?? 0) >= d.min_level)
    .sort((a, b) => Number((a.level ?? 0) > d.max_level) - Number((b.level ?? 0) > d.max_level));
  const notDone = able.filter((c) => !dungeonDone(c, d));
  if (notDone.length) return { kind: "go", character: notDone[0] };
  // Done the dungeon, but with quests there that are not grey yet.
  const worth = able.filter((c) => worthwhileQuests(c, d) > 0);
  if (worth.length) return { kind: "worth", character: worth[0] };
  if (able.length) return { kind: "done", character: able[0] };
  const below = unit.characters
    .filter((c) => (c.level ?? 0) < d.min_level)
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  if (below && d.min_level - (below.level ?? 0) <= CLOSE_LEVELS) {
    return { kind: "close", character: below, gap: d.min_level - (below.level ?? 0) };
  }
  return { kind: "far", character: unit.characters[0] };
}

export const GOING = new Set(["go", "worth"]);

// Open quests in this dungeon that are not grey for the character yet.
export function worthwhileQuests(c, d) {
  return questsFor(c, d).filter((x) => x.kind !== "done" && !isGrey(c, x.q)).length;
}

export function isGrey(c, q) {
  return q.level != null && (c.level ?? 0) - q.level >= GREY_LEVELS;
}

// Quests ---------------------------------------------------------------------------

function questState(c, questId) {
  return questLogs.get(c.id)?.get(questId) ?? null;
}

// The earliest pre-quest this character still has to do before questId, or
// null when nothing blocks it. Several quests leading to one are alternatives
// (often one per faction), so one done is enough.
function firstMissingStep(c, questId, depth = 0) {
  const before = prereqsOf.get(questId);
  if (!before?.length || depth > 10) return null;
  if (before.some((p) => questState(c, p.requires_quest_id) === "completed")) return null;
  const step = before[0];
  return firstMissingStep(c, step.requires_quest_id, depth + 1) ??
    { id: step.requires_quest_id, title: step.requires_title, inLog: questState(c, step.requires_quest_id) === "in_progress" };
}

// True when a quest that comes after this one is done or in the log: then
// this one can no longer be picked up (a breadcrumb, or a skipped step).
function laterStepTaken(c, questId) {
  let at = nextOf.get(questId);
  for (let depth = 0; at && depth < 10; depth++) {
    if (questState(c, at)) return true;
    at = nextOf.get(at);
  }
  return false;
}

// The dungeon's quests for this character's faction. Quests that share a
// title (one per item reward, one per faction) count as one. Quests the
// character can no longer pick up are left out.
export function questsFor(c, d) {
  const groups = new Map();
  for (const q of questsByArea.get(d.area_id) ?? []) {
    if (q.faction && q.faction !== c.faction) continue;
    if (!groups.has(q.title)) groups.set(q.title, []);
    groups.get(q.title).push(q);
  }
  const RANK = { done: 0, log: 1, pickup: 2, blocked: 3 };
  const list = [];
  for (const variants of groups.values()) {
    const options = [];
    for (const q of variants) {
      const state = questState(c, q.quest_id);
      if (state === "completed") options.push({ q, kind: "done" });
      else if (state === "in_progress") options.push({ q, kind: "log" });
      else if (laterStepTaken(c, q.quest_id)) continue;
      else {
        const missing = firstMissingStep(c, q.quest_id);
        options.push(missing ? { q, kind: "blocked", missing } : { q, kind: "pickup" });
      }
    }
    if (options.length) list.push(options.sort((a, b) => RANK[a.kind] - RANK[b.kind])[0]);
  }
  return list;
}

export function questSummary(list) {
  const done = list.filter((x) => x.kind === "done").length;
  const log = list.filter((x) => x.kind === "log").length;
  return { done, log, total: list.length, open: list.length - done - log };
}

const QUEST_TEXT = { done: "Done", log: "In log", pickup: "Pick up", blocked: "Pre-quest" };
const QUEST_ORDER = { pickup: 0, blocked: 1, log: 2, done: 3 };

export function questList(list, c) {
  if (list.length === 0) return el("p", { class: "quest-empty" }, "No dungeon quests known for this one.");
  // What to act on first; quests that cannot be shared before shareable ones.
  const sorted = [...list].sort((a, b) =>
    QUEST_ORDER[a.kind] - QUEST_ORDER[b.kind] || Number(a.q.shareable !== false) - Number(b.q.shareable !== false) ||
    a.q.title.localeCompare(b.q.title)
  );
  return el(
    "ul",
    { class: "quest-rows" },
    sorted.map((x) =>
      el(
        "li",
        { class: `quest-row q-${x.kind}` },
        el("span", { class: "q-state" }, QUEST_TEXT[x.kind]),
        el(
          "span",
          { class: "q-title" },
          x.q.title,
          x.kind !== "done" && x.q.shareable === false && el("span", { class: "q-flag" }, "Not shareable"),
          x.kind !== "done" && isGrey(c, x.q) && el("span", { class: "q-flag q-flag-grey" }, "Grey"),
          x.kind === "blocked" &&
            el("span", { class: "q-step" }, `${x.missing.inLog ? "Finish" : "First"}: ${x.missing.title ?? `quest ${x.missing.id}`}`),
          x.q.giver && x.kind === "pickup" && el("span", { class: "q-step" }, `From ${x.q.giver}`),
        ),
      )
    ),
  );
}

// Dungeons are grouped by the Spelunker achievement they count for, low to
// high; The Stockade is in none of them and comes last.
export const ACHIEVEMENT_ORDER = ["Novice Spelunker", "Experienced Spelunker", "Master Spelunker"];

export function sectionOf(d) {
  const i = ACHIEVEMENT_ORDER.indexOf(d.achievement);
  return i === -1 ? { key: 99, label: "Not in an achievement", achievement: null } : { key: i, label: d.achievement, achievement: d.achievement };
}

// What the cell says, as a prep checklist:
//   not cleared: "Pick up 3" (quests to grab), "Pre-quest first", or "Ready"
//   cleared:     "1 quest left", "Complete" (every quest done), or "Cleared"
//   too low:     "Lvl 30 needed (1 level to go)"
export function cellStatus(s, c, d, list, sum) {
  if (s.kind === "go") {
    const pickup = list.filter((x) => x.kind === "pickup").length;
    if (pickup) return { text: `Pick up ${pickup}`, tone: "todo" };
    if (list.some((x) => x.kind === "blocked")) return { text: "Pre-quest first", tone: "blocked" };
    return { text: "Ready", tone: "ready" };
  }
  if (s.kind === "worth") {
    const left = worthwhileQuests(c, d);
    return { text: `${left} ${left === 1 ? "quest" : "quests"} left`, tone: "todo" };
  }
  if (s.kind === "done") {
    return sum.total > 0 && sum.done === sum.total ? { text: "Complete", tone: "quiet" } : { text: "Cleared", tone: "quiet" };
  }
  // Below the minimum level: say which level, and how far off it is.
  const gap = d.min_level - (c.level ?? 0);
  return { text: `Lvl ${d.min_level} needed (${gap} ${gap === 1 ? "level" : "levels"} to go)`, tone: "quiet" };
}

