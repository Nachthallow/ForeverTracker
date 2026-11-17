// Front page: the group view. The run grid of dungeons first, then the level
// line, then the characters grouped by player and region, then the add form.
import {
  db,
  el,
  classSpan,
  timeAgo,
  titleCase,
  fullName,
  characterUrl,
  callSync,
  passphrase,
  characterCard,
  altCard,
  loadPlayers,
  fillPlayerList,
  SUMMARY_COLUMNS,
} from "./lib.js";

// Scott's rule: flag a player when none of their characters is within this
// many levels of the middle of the group.
const LEVEL_GAP_FLAG = 5;
const REGION_ORDER = ["us", "eu", "kr", "tw"];
// A player this many levels below a dungeon is "close".
const CLOSE_LEVELS = 3;
// A quest turns grey this many levels below the character (Efficient Games
// game_rules.trivialRange gives 5 at every level players have read it).
const GREY_LEVELS = 5;

const els = {
  board: document.getElementById("board"),
  boardSummary: document.getElementById("board-summary"),
  levelLine: document.getElementById("level-line"),
  roster: document.getElementById("roster"),
  rosterMessage: document.getElementById("roster-message"),
  addForm: document.getElementById("add-form"),
  addMessage: document.getElementById("add-message"),
  passField: document.getElementById("pass-field"),
  passRemembered: document.getElementById("pass-remembered"),
  forget: document.getElementById("forget-pass"),
  playerList: document.getElementById("player-list"),
  faction: document.getElementById("filter-faction"),
  region: document.getElementById("filter-region"),
  sort: document.getElementById("sort"),
};

let characters = [];
let gains = new Map();
let dungeons = [];
let questsByArea = new Map(); // area_id -> dungeon quests
let prereqsOf = new Map(); // quest_id -> quests that come before it
let nextOf = new Map(); // quest_id -> the quest that comes after it
let questLogs = new Map(); // character_id -> Map(quest_id -> state)

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

const byLevelDesc = (a, b) => (b.level ?? 0) - (a.level ?? 0) || fullName(a).localeCompare(fullName(b));

// Untagged characters count as their own player.
function playerKey(c) {
  return c.player_id != null ? `p${c.player_id}` : `c${c.id}`;
}

// Groups characters into units of one player each. Each unit's characters
// are sorted high to low, so characters[0] is the main.
function unitsOf(list) {
  const units = new Map();
  for (const c of list) {
    const key = playerKey(c);
    if (!units.has(key)) units.set(key, { key, player: c.player_name ?? null, characters: [] });
    units.get(key).characters.push(c);
  }
  for (const unit of units.values()) unit.characters.sort(byLevelDesc);
  return [...units.values()];
}

function top(unit) {
  return unit.characters[0].level ?? 0;
}

function unitName(unit) {
  return unit.player ?? fullName(unit.characters[0]);
}

// Level line ----------------------------------------------------------------------

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function gainText(c) {
  const g = gains.get(c.id);
  if (!g || g.gained == null || !g.history_since) return null;
  const since = new Date(g.history_since);
  const weekOld = Date.now() - since.getTime() >= 7 * 24 * 3600 * 1000;
  const label = weekOld
    ? "in 7 days"
    : `since ${since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return `${g.gained >= 0 ? "+" : ""}${g.gained} ${label}`;
}

// Characters in different regions, factions or rulesets cannot group, so
// each combination gets its own line.
function linesOf(list) {
  const lines = new Map();
  for (const c of list) {
    const key = `${c.region}|${c.faction ?? "?"}|${c.ruleset ?? "?"}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(c);
  }
  return [...lines.entries()]
    .sort(([a], [b]) => REGION_ORDER.indexOf(a.split("|")[0]) - REGION_ORDER.indexOf(b.split("|")[0]) || a.localeCompare(b))
    .map(([, members]) => unitsOf(members).sort((a, b) => top(a) - top(b) || unitName(a).localeCompare(unitName(b))));
}

function unitFlag(unit, middle, unitCount) {
  if (unitCount < 2) return null;
  // The character closest to the middle decides; an alt near the group keeps the player in.
  const closest = unit.characters.reduce((best, c) =>
    Math.abs((c.level ?? 0) - middle) < Math.abs((best.level ?? 0) - middle) ? c : best
  );
  const offset = (closest.level ?? 0) - middle;
  if (Math.abs(offset) < LEVEL_GAP_FLAG) return null;
  return el("span", { class: "badge badge-flag" }, `${Math.round(Math.abs(offset))} ${offset > 0 ? "ahead" : "behind"}`);
}

function levelChip(unit, middle, unitCount) {
  const [main, ...alts] = unit.characters;
  const flag = unitFlag(unit, middle, unitCount);
  const gain = gainText(main);
  return el(
    "li",
    { class: flag ? "level-chip flagged" : "level-chip" },
    el("span", { class: "chip-level" }, main.level ?? "?"),
    unit.player && el("span", { class: "chip-player" }, unit.player),
    el("a", { class: "chip-name", href: characterUrl(main) }, fullName(main)),
    classSpan(main.class),
    el("span", { class: "chip-meta" }, `Last on ${timeAgo(main.last_login_at)}`),
    gain && el("span", { class: "chip-meta" }, gain),
    alts.length > 0 &&
      el(
        "ul",
        { class: "chip-alts" },
        alts.map((c) => el("li", {}, `${c.level ?? "?"} `, el("a", { href: characterUrl(c) }, c.first_name), " ", classSpan(c.class))),
      ),
    flag,
  );
}

function renderLevelLine() {
  if (characters.length === 0) {
    els.levelLine.replaceChildren(el("p", { class: "muted" }, "Add characters to see the level line."));
    return;
  }
  const lines = linesOf(characters);
  const blocks = lines.map((units) => {
    const levels = units.map(top);
    const low = levels[0];
    const high = levels[levels.length - 1];
    const middle = median(levels);
    const first = units[0].characters[0];
    const players = `${units.length} ${units.length === 1 ? "player" : "players"}`;
    const summary = units.length === 1
      ? "Only one player here so far."
      : low === high
      ? `${players}, all at level ${low}.`
      : `${players}, levels ${low} to ${high}, a gap of ${high - low}.`;
    return el(
      "div",
      { class: "level-group" },
      lines.length > 1 &&
        el("h3", { class: "group-title" }, `${first.region.toUpperCase()}, ${titleCase(first.faction)}, ${first.ruleset ?? "unknown ruleset"}`),
      el("p", { class: "level-summary" }, summary),
      el("ol", { class: "level-line" }, units.map((u) => levelChip(u, middle, units.length))),
    );
  });
  els.levelLine.replaceChildren(
    ...blocks,
    el(
      "p",
      { class: "muted small" },
      `Each player is placed by their highest character. Flagged: no character within ${LEVEL_GAP_FLAG} levels of the middle of the group.`,
    ),
  );
}

// What we can run -------------------------------------------------------------------

// How one player stands with one dungeon, using whichever of their characters
// suits it best: one in range that has not done it, else one in range, else
// the closest one below it.
function dungeonDone(c, d) {
  if (d.criteria_id != null) return Boolean(c.dungeons_done?.includes(d.criteria_id));
  // Blizzard does not report this dungeon (The Stockade): all its quests done counts instead.
  const sum = questSummary(questsFor(c, d));
  return sum.total > 0 && sum.done === sum.total;
}

function standing(unit, d) {
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

const GOING = new Set(["go", "worth"]);

// Open quests in this dungeon that are not grey for the character yet.
function worthwhileQuests(c, d) {
  return questsFor(c, d).filter((x) => x.kind !== "done" && !isGrey(c, x.q)).length;
}

function isGrey(c, q) {
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
function questsFor(c, d) {
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

function questSummary(list) {
  const done = list.filter((x) => x.kind === "done").length;
  const log = list.filter((x) => x.kind === "log").length;
  return { done, log, total: list.length, open: list.length - done - log };
}

const QUEST_TEXT = { done: "Done", log: "In log", pickup: "Pick up", blocked: "Pre-quest" };
const QUEST_ORDER = { pickup: 0, blocked: 1, log: 2, done: 3 };

function questList(list, c) {
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

// The run grid: one table per group, a row per dungeon, a column per player.


function lineTitle(units) {
  const first = units[0].characters[0];
  return `${first.region.toUpperCase()}, ${titleCase(first.faction)}, ${first.ruleset ?? "unknown ruleset"}`;
}

// Dungeons are grouped by the Spelunker achievement they count for, low to
// high; The Stockade is in none of them and comes last.
const ACHIEVEMENT_ORDER = ["Novice Spelunker", "Experienced Spelunker", "Master Spelunker"];

function sectionOf(d) {
  const i = ACHIEVEMENT_ORDER.indexOf(d.achievement);
  return i === -1 ? { key: 99, label: "Not in an achievement", achievement: null } : { key: i, label: d.achievement, achievement: d.achievement };
}

// A player's progress on one achievement: the most entries any of their
// characters in this group has completed.
function achievementCell(unit, achievement) {
  if (!achievement) return el("span", {});
  const criteria = new Set(dungeons.filter((d) => d.achievement === achievement).map((d) => d.criteria_id));
  const counts = unit.characters.map((c) => (c.dungeons_done ?? []).filter((id) => criteria.has(id)).length);
  const done = Math.max(0, ...counts);
  const complete = done === criteria.size;
  return el(
    "div",
    { class: complete ? "rg-ach rg-ach-complete" : "rg-ach" },
    el("span", { class: "rg-ach-count" }, complete ? "Complete" : `${done}/${criteria.size} dungeons`),
    el("span", { class: "rg-bar", "aria-hidden": "true" }, el("span", { class: "rg-bar-done", style: `width: ${Math.round((done / criteria.size) * 100)}%` })),
  );
}

function avatarSquare(c) {
  const initial = el("span", { class: "rg-avatar rg-avatar-letter", "aria-hidden": "true" }, c.first_name.charAt(0));
  if (!c.avatar_url) return initial;
  const img = el("img", { class: "rg-avatar", src: c.avatar_url, alt: "", loading: "lazy", width: 32, height: 32 });
  img.addEventListener("error", () => img.replaceWith(initial));
  return img;
}

function playerHead(unit) {
  const main = unit.characters[0];
  return el(
    "div",
    { class: "rg-player" },
    avatarSquare(main),
    el(
      "div",
      { class: "rg-player-text" },
      el("a", { class: "rg-player-name", href: characterUrl(main) }, unit.player ?? fullName(main)),
      el(
        "span",
        { class: "rg-player-meta" },
        `${main.level ?? "?"} `,
        classSpan(main.class),
        unit.characters.length > 1 && ` · +${unit.characters.length - 1}`,
      ),
    ),
  );
}

// One player's cell in a dungeon row: status, quests done/total and a bar.
// What the cell says, as a prep checklist:
//   not cleared: "Pick up 3" (quests to grab), "Pre-quest first", or "Ready"
//   cleared:     "1 quest left", "Complete" (every quest done), or "Cleared"
//   too low:     "2 to go" or "Too low"
function cellStatus(s, c, d, list, sum) {
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
  if (s.kind === "close") return { text: `${s.gap} to go`, tone: "quiet" };
  return { text: "Too low", tone: "quiet" };
}

function playerCell(unit, s, d) {
  const c = s.character;
  const list = questsFor(c, d);
  const sum = questSummary(list);
  const status = cellStatus(s, c, d, list, sum);
  const pct = (n) => (sum.total ? `${Math.round((n / sum.total) * 100)}%` : "0%");
  const isAlt = c !== unit.characters[0];
  return el(
    "div",
    { class: `rg-cell rg-${s.kind} tone-${status.tone}` },
    el(
      "div",
      { class: "rg-cell-top" },
      el("span", { class: "rg-status" }, status.text),
      el(
        "span",
        { class: "rg-count", title: "Quests done out of all quests for this dungeon" },
        sum.total ? `${sum.done}/${sum.total} done` : "No quests",
        sum.log > 0 && el("span", { class: "rg-log" }, ` · ${sum.log} in log`),
      ),
    ),
    el(
      "div",
      { class: "rg-bar", "aria-hidden": "true" },
      el("span", { class: "rg-bar-done", style: `width: ${pct(sum.done)}` }),
      el("span", { class: "rg-bar-log", style: `width: ${pct(sum.log)}` }),
    ),
    isAlt && el("span", { class: "rg-as" }, `as ${c.first_name}, ${c.level ?? "?"}`),
  );
}

// The opened row: each player's quests for this dungeon, side by side.
function rowDrawer(d, rows) {
  return el(
    "div",
    { class: "rg-drawer" },
    el(
      "div",
      { class: "rg-drawer-note" },
      "Pick up what is not shareable yourself. A shareable quest only needs one of you.",
      d.faction_note && el("span", { class: "rg-drawer-extra" }, d.faction_note),
      d.criteria_id == null &&
        el("span", { class: "rg-drawer-extra" }, "Blizzard does not report this dungeon, so all its quests done counts as done."),
    ),
    rows.map(({ s }) =>
      el(
        "div",
        { class: "rg-drawer-col" },
        questList(questsFor(s.character, d), s.character),
        el("a", { class: "pr-link", href: characterUrl(s.character) }, `Open ${fullName(s.character)}`),
      )
    ),
  );
}

function dungeonRow(d, rows) {
  return el(
    "details",
    { class: "rg-row" },
    el(
      "summary",
      { class: "rg-line" },
      el(
        "span",
        { class: "rg-dungeon" },
        el("span", { class: "rg-chevron", "aria-hidden": "true" }),
        el("span", { class: "rg-dungeon-name" }, d.name),
        d.is_new && el("span", { class: "tag-new" }, "New"),
      ),
      el("span", { class: "rg-range" }, `${d.min_level}–${d.max_level}`),
      rows.map(({ unit, s }) => playerCell(unit, s, d)),
    ),
    rowDrawer(d, rows),
  );
}

function runGrid(units, cards) {
  // Player columns run low to high, the order linesOf gives, like the level line.
  const bands = new Map();
  for (const card of cards) {
    const band = sectionOf(card.d);
    if (!bands.has(band.key)) bands.set(band.key, { ...band, cards: [] });
    bands.get(band.key).cards.push(card);
  }
  return el(
    "div",
    { class: "rg-scroll" },
    el(
      "div",
      { class: "rg-table", style: `--rg-players: ${units.length}` },
      el(
        "div",
        { class: "rg-head" },
        el("span", { class: "rg-label" }, "Dungeon"),
        el("span", { class: "rg-label" }, "Levels"),
        units.map(playerHead),
      ),
      [...bands.values()]
        .sort((a, b) => a.key - b.key)
        .map((band) => [
          el(
            "div",
            { class: "rg-band" },
            el("span", { class: "rg-band-label" }, band.label),
            units.map((unit) => achievementCell(unit, band.achievement)),
          ),
          band.cards
            .sort((a, b) => a.d.min_level - b.d.min_level || a.d.max_level - b.d.max_level || a.d.name.localeCompare(b.d.name))
            .map(({ d, rows }) => dungeonRow(d, rows)),
        ]),
    ),
  );
}

function renderBoard() {
  const allLines = linesOf(characters);
  const lines = allLines.filter((units) => units.length > 1);
  const alone = allLines.filter((units) => units.length === 1).map((units) => units[0]);

  if (lines.length === 0) {
    els.boardSummary.textContent = "";
    els.board.replaceChildren(
      el("p", { class: "muted" }, "Dungeons show up here once two or more players share a region, faction and ruleset."),
    );
    return;
  }

  let total = 0;
  const blocks = lines.map((units) => {
    const cards = [];
    for (const d of dungeons) {
      const rows = units.map((unit) => ({ unit, s: standing(unit, d) }));
      const inRange = rows.filter((r) => GOING.has(r.s.kind) || r.s.kind === "done").length;
      const canGo = rows.filter((r) => GOING.has(r.s.kind)).length;
      // Worth showing: at least two players are in range, and someone still needs it.
      if (inRange >= 2 && canGo >= 1) cards.push({ d, rows, canGo });
    }
    total += cards.length;

    let body;
    if (cards.length) {
      body = runGrid(units, cards);
    } else {
      const mid = median(units.map(top).sort((a, b) => a - b));
      const next = dungeons.find((d) => d.min_level > mid);
      body = el(
        "p",
        { class: "muted" },
        "Nothing fits two or more of you right now that someone still needs.",
        next ? ` Next up: ${next.name} from level ${next.min_level}.` : "",
      );
    }
    return el("div", { class: "board-line" }, el("h3", { class: "group-title" }, lineTitle(units)), body);
  });

  els.boardSummary.textContent = total === 1
    ? "1 dungeon fits the group and still has someone who needs it. Click a row for everyone's quests."
    : `${total} dungeons fit the group and still have someone who needs them. Click a row for everyone's quests.`;
  const loners = alone.map((u) => `${unitName(u)} (${lineTitle([u])})`);
  els.board.replaceChildren(
    ...blocks,
    loners.length > 0 &&
      el("p", { class: "muted small" }, `Not shown, with nobody to group with yet: ${loners.join("; ")}.`),
  );
}

// Characters, by player and region ---------------------------------------------------

function filtered() {
  const faction = els.faction.value;
  const region = els.region.value;
  return characters.filter((c) => (!faction || c.faction === faction) && (!region || c.region === region));
}

// One column per player per region: the main as a full card, the rest condensed.
function renderRoster() {
  const list = filtered();
  const units = unitsOf(list);
  const sortValue = els.sort.value;
  units.sort((a, b) => {
    if (sortValue === "name") return unitName(a).localeCompare(unitName(b));
    const diff = top(a) - top(b);
    return (sortValue === "level-asc" ? diff : -diff) || unitName(a).localeCompare(unitName(b));
  });

  const columns = [];
  for (const unit of units) {
    const regions = [...new Set(unit.characters.map((c) => c.region))].sort(
      (a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b),
    );
    for (const region of regions) {
      const [main, ...alts] = unit.characters.filter((c) => c.region === region);
      columns.push(
        el(
          "section",
          { class: "player-column" },
          el(
            "h3",
            { class: "player-name" },
            unit.player ?? "Not tagged",
            regions.length > 1 && el("span", { class: "badge region-badge" }, region.toUpperCase()),
          ),
          characterCard(main, { link: true, onUpdate: () => load() }),
          alts.length > 0 && el("div", { class: "alts" }, alts.map(altCard)),
        ),
      );
    }
  }
  els.roster.replaceChildren(...columns);

  if (characters.length === 0) {
    els.rosterMessage.textContent = "Nobody on the roster yet. Add the first character below.";
  } else if (list.length === 0) {
    els.rosterMessage.textContent = "No characters match these filters.";
  } else {
    els.rosterMessage.textContent = "";
  }
}

async function load() {
  if (characters.length === 0) els.rosterMessage.textContent = "Loading the roster...";
  const [chars, gainRows, players, dungeonRows, questRows, prereqRows, nextRows, logRows] = await Promise.all([
    db.from("characters").select(`${SUMMARY_COLUMNS}, dungeons_done`),
    db.from("level_gains").select("character_id, gained, history_since"),
    loadPlayers(),
    db.from("dungeons")
      .select("id, name, zone, min_level, max_level, faction_note, is_new, criteria_id, area_id, achievement")
      .order("min_level")
      .order("max_level"),
    fetchAll("dungeon_quests", "quest_id, area_id, title, level, min_level, faction, shareable, giver"),
    fetchAll("quest_prereqs", "quest_id, requires_quest_id, requires_title"),
    fetchAll("quest_next", "quest_id, next_quest_id"),
    fetchAll("character_dungeon_quests", "character_id, quest_id, state"),
  ]);
  if (chars.error) {
    els.rosterMessage.textContent = "Could not load the roster. Try reloading the page.";
    console.error(chars.error);
    return;
  }
  characters = chars.data.map((c) => ({ ...c, player_name: players.get(c.player_id) ?? null }));
  gains = new Map((gainRows.data ?? []).map((g) => [g.character_id, g]));
  dungeons = dungeonRows.data ?? [];

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

  fillPlayerList(els.playerList, players);
  renderBoard();
  renderLevelLine();
  renderRoster();
}

// Add character, behind the group passphrase ----------------------------------------

function showPassphraseState() {
  const remembered = passphrase.get() !== "";
  els.passField.hidden = remembered;
  els.passRemembered.hidden = !remembered;
}

els.forget.addEventListener("click", () => {
  passphrase.forget();
  showPassphraseState();
  els.addForm.elements.passphrase.focus();
});

els.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.addForm);
  const name = String(form.get("name")).trim();
  const surname = String(form.get("surname")).trim();
  const region = String(form.get("region"));
  const player = String(form.get("player") ?? "").trim();
  const typed = String(form.get("passphrase") ?? "");
  const pass = passphrase.get() || typed;

  els.addMessage.className = "form-message error";
  if (!name || !surname) {
    els.addMessage.textContent = "Name and surname are both needed.";
    return;
  }
  if (!pass) {
    els.addMessage.textContent = "Enter the group passphrase.";
    return;
  }

  const button = els.addForm.querySelector("button[type=submit]");
  button.disabled = true;
  els.addMessage.className = "form-message";
  els.addMessage.textContent = "Asking Blizzard...";
  try {
    const { character, existed } = await callSync({ action: "add", passphrase: pass, region, name, surname, player });
    passphrase.set(pass);
    els.addMessage.className = "form-message ok";
    els.addMessage.textContent = existed
      ? `${fullName(character)} is already on the roster. Change its player on its own page.`
      : `Added ${fullName(character)}.`;
    for (const field of ["name", "surname", "passphrase"]) els.addForm.elements[field].value = "";
    showPassphraseState();
    await load();
  } catch (err) {
    if (err.wrongPassphrase) {
      passphrase.forget();
      showPassphraseState();
    }
    els.addMessage.className = "form-message error";
    els.addMessage.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

for (const control of [els.faction, els.region, els.sort]) control.addEventListener("change", renderRoster);

showPassphraseState();
load();
