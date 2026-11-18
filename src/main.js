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
import {
  dungeons,
  feeders,
  loadDungeonData,
  standing,
  GOING,
  worthwhileQuests,
  questsFor,
  questSummary,
  questList,
  cellStatus,
  sectionOf,
} from "./dungeons.js";

// Scott's rule: flag a player when none of their characters is within this
// many levels of the middle of the group.
const LEVEL_GAP_FLAG = 5;
const REGION_ORDER = ["us", "eu", "kr", "tw"];
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

// The run grid: one table per group, a row per dungeon, a column per player.


function lineTitle(units) {
  const first = units[0].characters[0];
  return `${first.region.toUpperCase()}, ${titleCase(first.faction)}, ${first.ruleset ?? "unknown ruleset"}`;
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

// Tabs: one per group that can play together (region, faction, ruleset).
const TAB_KEY = "forever-roster-group";

function lineKey(units) {
  const c = units[0].characters[0];
  return `${c.region}|${c.faction}|${c.ruleset}`;
}

function rememberedTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function rememberTab(key) {
  try {
    localStorage.setItem(TAB_KEY, key);
  } catch {
    // storage blocked: the page just opens on the biggest group next time
  }
}

let selectedTab = rememberedTab();

// The dungeons worth showing for a group: in a group, two or more of you can
// go and someone still needs it; alone, you can go and still need it.
function boardCards(units) {
  const needed = units.length > 1 ? 2 : 1;
  const cards = [];
  for (const d of dungeons) {
    const rows = units.map((unit) => ({ unit, s: standing(unit, d) }));
    const able = rows.filter((r) => GOING.has(r.s.kind) || r.s.kind === "done").length;
    const canGo = rows.filter((r) => GOING.has(r.s.kind)).length;
    if (able >= needed && canGo >= 1) cards.push({ d, rows, canGo });
  }
  return cards;
}

// Suggested runs -----------------------------------------------------------------------

const TRIP_SPREAD = 10; // dungeons in one trip start within this many levels of each other
const TRIP_SIZE = 3;
const SUGGESTIONS = 3;

function feedsInto(from, to, faction) {
  return feeders.find((f) => f.from_dungeon === from.name && f.to_dungeon === to.name && (!f.faction || f.faction === faction));
}

// Turns the shown dungeons into trips: dungeons in the same trip area and of
// similar level go together, a feeder before the dungeon it feeds. Trips are
// ranked by the level you out-grow them, lowest first, then by how many of
// you still need them.
function suggestTrips(units, cards) {
  const faction = units[0].characters[0].faction;
  // A group trip is for dungeons at least two of you still need.
  const wanted = Math.min(2, units.length);
  const byArea = new Map();
  for (const card of cards.filter((c) => c.canGo >= wanted)) {
    const area = card.d.trip_area ?? card.d.name;
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(card);
  }

  const trips = [];
  for (const [area, list] of byArea) {
    list.sort((a, b) => a.d.min_level - b.d.min_level || a.d.max_level - b.d.max_level);
    let trip = null;
    for (const card of list) {
      if (!trip || trip.cards.length >= TRIP_SIZE || card.d.min_level - trip.cards[0].d.min_level > TRIP_SPREAD) {
        trip = { area, cards: [] };
        trips.push(trip);
      }
      trip.cards.push(card);
    }
  }

  for (const trip of trips) {
    // A feeder goes before the dungeon it feeds.
    trip.cards.sort((a, b) => {
      if (feedsInto(a.d, b.d, faction)) return -1;
      if (feedsInto(b.d, a.d, faction)) return 1;
      return a.d.min_level - b.d.min_level;
    });
    trip.outgrow = Math.min(...trip.cards.map((c) => c.d.max_level));
    trip.need = trip.cards.reduce((n, c) => n + c.canGo, 0);
    trip.notes = [];
    for (const a of trip.cards) {
      for (const b of cards) {
        const f = a !== b && feedsInto(a.d, b.d, faction);
        if (!f) continue;
        const inTrip = trip.cards.includes(b);
        trip.notes.push(
          inTrip
            ? `Run ${a.d.name} first: ${f.quest} leads to ${f.leads_to ?? b.d.name}.`
            : `${a.d.name} also feeds ${b.d.name}: ${f.quest} leads to ${f.leads_to ?? "it"}.`,
        );
      }
    }
  }
  return trips.sort((a, b) => a.outgrow - b.outgrow || b.need - a.need).slice(0, SUGGESTIONS);
}

function shortName(unit) {
  return unit.player ?? fullName(unit.characters[0]);
}

// What each player needs to do before the trip, over all its dungeons.
function tripPrep(units, trip) {
  return units.map((unit, i) => {
    let pickup = 0;
    let blocked = 0;
    let going = false;
    for (const card of trip.cards) {
      const s = card.rows[i].s;
      if (!GOING.has(s.kind)) continue;
      going = true;
      for (const x of questsFor(s.character, card.d)) {
        if (x.kind === "pickup") pickup++;
        if (x.kind === "blocked") blocked++;
      }
    }
    let text = "Ready";
    let tone = "ready";
    if (!going) {
      text = "Nothing needed";
      tone = "quiet";
    } else if (pickup) {
      text = `Pick up ${pickup}`;
      tone = "todo";
    } else if (blocked) {
      text = "Pre-quest first";
      tone = "blocked";
    }
    return el("li", { class: `trip-prep tone-${tone}` }, el("span", { class: "trip-prep-name" }, shortName(unit)), el("span", { class: "rg-status" }, text));
  });
}

function tripCard(units, trip, index) {
  const ordered = trip.cards.length > 1 && trip.notes.some((n) => n.startsWith("Run "));
  const zones = [...new Set(trip.cards.map((c) => c.d.zone).filter(Boolean))].join(" · ");
  return el(
    "article",
    { class: "trip" },
    el(
      "header",
      { class: "trip-head" },
      el("span", { class: "trip-rank" }, index === 0 ? "Start here" : `Then`),
      el("h3", { class: "trip-title" }, trip.cards.map((c) => c.d.name).join(ordered ? " → " : " + ")),
      el("p", { class: "trip-where" }, zones || trip.area),
    ),
    el(
      "ul",
      { class: "trip-dungeons" },
      trip.cards.map((c) =>
        el(
          "li",
          {},
          el("span", { class: "trip-dungeon-name" }, c.d.name),
          el("span", { class: "trip-meta" }, `${c.d.min_level}–${c.d.max_level}`),
          el("span", { class: "trip-meta" }, `${c.canGo} of ${units.length} ${c.d.achievement ? `need it · ${c.d.achievement.replace(" Spelunker", "")}` : "need it"}`),
        )
      ),
    ),
    el("ul", { class: "trip-preps" }, tripPrep(units, trip)),
    trip.notes.length > 0 && el("ul", { class: "trip-notes" }, trip.notes.map((n) => el("li", {}, n))),
  );
}

function suggestedRuns(units, cards) {
  const trips = suggestTrips(units, cards);
  if (!trips.length) return null;
  return el(
    "section",
    { class: "trips", "aria-label": "Suggested runs" },
    el("h3", { class: "trips-title" }, "Suggested runs"),
    el(
      "p",
      { class: "trips-why" },
      "Lowest first, before you out-level them; dungeons in the same area together; a dungeon that feeds another goes first.",
    ),
    el("div", { class: "trips-row" }, trips.map((t, i) => tripCard(units, t, i))),
  );
}

// The board -------------------------------------------------------------------------

function groupTabs(lines, current) {
  return el(
    "div",
    { class: "group-tabs", role: "tablist", "aria-label": "Groups" },
    lines.map((units) => {
      const key = lineKey(units);
      const c = units[0].characters[0];
      const tab = el(
        "button",
        {
          class: "group-tab",
          type: "button",
          role: "tab",
          "aria-selected": key === current ? "true" : "false",
          tabindex: key === current ? "0" : "-1",
        },
        el("span", { class: "group-tab-name" }, `${c.region.toUpperCase()} · ${titleCase(c.faction)} · ${c.ruleset ?? "?"}`),
        el("span", { class: "group-tab-count" }, units.length === 1 ? shortName(units[0]) : `${units.length} players`),
      );
      tab.addEventListener("click", () => {
        selectedTab = key;
        rememberTab(key);
        renderBoard();
      });
      return tab;
    }),
  );
}

function renderBoard() {
  const lines = linesOf(characters).sort((a, b) => b.length - a.length);
  if (lines.length === 0) {
    els.boardSummary.textContent = "";
    els.board.replaceChildren(el("p", { class: "muted" }, "Add characters to see which dungeons you can run."));
    return;
  }

  let units = lines.find((u) => lineKey(u) === selectedTab);
  if (!units) units = lines[0];
  const key = lineKey(units);
  const cards = boardCards(units);
  const solo = units.length === 1;

  let body;
  if (cards.length) {
    body = [suggestedRuns(units, cards), runGrid(units, cards)];
  } else {
    const mid = median(units.map(top).sort((a, b) => a - b));
    const next = dungeons.find((d) => d.min_level > mid);
    body = el(
      "p",
      { class: "muted" },
      solo ? "Nothing to run right now that you still need." : "Nothing fits two or more of you right now that someone still needs.",
      next ? ` Next up: ${next.name} from level ${next.min_level}.` : "",
    );
  }

  const n = cards.length;
  els.boardSummary.textContent = solo
    ? `${n} ${n === 1 ? "dungeon" : "dungeons"} ${shortName(units[0])} can run and still needs. Click a row for the quests.`
    : `${n} ${n === 1 ? "dungeon fits" : "dungeons fit"} the group and still ${n === 1 ? "has" : "have"} someone who needs ${n === 1 ? "it" : "them"}. Click a row for everyone's quests.`;
  els.board.replaceChildren(
    lines.length > 1 ? groupTabs(lines, key) : el("h3", { class: "group-title" }, lineTitle(units)),
    el("div", { class: "board-line", role: lines.length > 1 ? "tabpanel" : null }, body),
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
  const [chars, gainRows, players] = await Promise.all([
    db.from("characters").select(`${SUMMARY_COLUMNS}, dungeons_done`),
    db.from("level_gains").select("character_id, gained, history_since"),
    loadPlayers(),
    loadDungeonData(),
  ]);
  if (chars.error) {
    els.rosterMessage.textContent = "Could not load the roster. Try reloading the page.";
    console.error(chars.error);
    return;
  }
  characters = chars.data.map((c) => ({ ...c, player_name: players.get(c.player_id) ?? null }));
  gains = new Map((gainRows.data ?? []).map((g) => [g.character_id, g]));
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
