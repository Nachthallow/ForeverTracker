// Front page: the group view. Level line first, then the characters grouped
// by player and region, then the add form.
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

const els = {
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
    db.from("characters").select(SUMMARY_COLUMNS),
    db.from("level_gains").select("character_id, gained, history_since"),
    loadPlayers(),
  ]);
  if (chars.error) {
    els.rosterMessage.textContent = "Could not load the roster. Try reloading the page.";
    console.error(chars.error);
    return;
  }
  characters = chars.data.map((c) => ({ ...c, player_name: players.get(c.player_id) ?? null }));
  gains = new Map((gainRows.data ?? []).map((g) => [g.character_id, g]));
  fillPlayerList(els.playerList, players);
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
