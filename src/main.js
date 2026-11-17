// Front page: the group view. Level line first, then the roster cards.
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
  SUMMARY_COLUMNS,
} from "./lib.js";

// Scott's rule: flag anyone this many levels or more from the middle of the group.
const LEVEL_GAP_FLAG = 5;

const els = {
  levelLine: document.getElementById("level-line"),
  roster: document.getElementById("roster"),
  rosterMessage: document.getElementById("roster-message"),
  addForm: document.getElementById("add-form"),
  addMessage: document.getElementById("add-message"),
  passField: document.getElementById("pass-field"),
  passRemembered: document.getElementById("pass-remembered"),
  forget: document.getElementById("forget-pass"),
  faction: document.getElementById("filter-faction"),
  region: document.getElementById("filter-region"),
  sort: document.getElementById("sort"),
};

let characters = [];
let gains = new Map();

// Level line --------------------------------------------------------------------

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

// Characters of different factions or rulesets cannot group, so each
// faction and ruleset pair gets its own line.
function groupsOf(list) {
  const groups = new Map();
  for (const c of list) {
    const key = `${c.faction ?? "?"}|${c.ruleset ?? "?"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].map((members) => members.sort((a, b) => (a.level ?? 0) - (b.level ?? 0)));
}

function levelChip(c, middle, groupSize) {
  const offset = (c.level ?? 0) - middle;
  let flag = null;
  if (groupSize > 1 && Math.abs(offset) >= LEVEL_GAP_FLAG) {
    flag = el(
      "span",
      { class: "badge badge-flag" },
      `${Math.round(Math.abs(offset))} ${offset > 0 ? "ahead" : "behind"}`,
    );
  }
  const gain = gainText(c);
  return el(
    "li",
    { class: flag ? "level-chip flagged" : "level-chip" },
    el("span", { class: "chip-level" }, c.level ?? "?"),
    el("a", { class: "chip-name", href: characterUrl(c) }, fullName(c)),
    classSpan(c.class),
    el("span", { class: "chip-meta" }, `Last on ${timeAgo(c.last_login_at)}`),
    gain && el("span", { class: "chip-meta" }, gain),
    flag,
  );
}

function renderLevelLine() {
  if (characters.length === 0) {
    els.levelLine.replaceChildren(el("p", { class: "muted" }, "Add characters to see the level line."));
    return;
  }
  const groups = groupsOf([...characters]);
  const blocks = groups.map((members) => {
    const levels = members.map((c) => c.level ?? 0);
    const low = levels[0];
    const high = levels[levels.length - 1];
    const middle = median(levels);
    const first = members[0];
    const summary = members.length === 1
      ? "Only one character here so far."
      : low === high
      ? `Everyone is level ${low}.`
      : `Levels ${low} to ${high}, a gap of ${high - low}.`;
    return el(
      "div",
      { class: "level-group" },
      groups.length > 1 && el("h3", { class: "group-title" }, `${titleCase(first.faction)}, ${first.ruleset ?? "unknown ruleset"}`),
      el("p", { class: "level-summary" }, summary),
      el("ol", { class: "level-line" }, members.map((c) => levelChip(c, middle, members.length))),
    );
  });
  els.levelLine.replaceChildren(
    ...blocks,
    el("p", { class: "muted small" }, `Flagged: ${LEVEL_GAP_FLAG} or more levels from the middle of the group.`),
  );
}

// Roster cards --------------------------------------------------------------------

function visibleCharacters() {
  const faction = els.faction.value;
  const region = els.region.value;
  const list = characters.filter((c) => (!faction || c.faction === faction) && (!region || c.region === region));
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));
  switch (els.sort.value) {
    case "level-asc":
      return list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || byName(a, b));
    case "name":
      return list.sort(byName);
    default:
      return list.sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || byName(a, b));
  }
}

function renderRoster() {
  const list = visibleCharacters();
  els.roster.replaceChildren(
    ...list.map((c) =>
      characterCard(c, {
        link: true,
        onUpdate: (fresh) => {
          Object.assign(c, fresh);
          load();
        },
      })
    ),
  );
  if (characters.length === 0) {
    els.rosterMessage.textContent = "Nobody on the roster yet. Add the first character above.";
  } else if (list.length === 0) {
    els.rosterMessage.textContent = "No characters match these filters.";
  } else {
    els.rosterMessage.textContent = "";
  }
}

async function load() {
  if (characters.length === 0) els.rosterMessage.textContent = "Loading the roster...";
  const [chars, gainRows] = await Promise.all([
    db.from("characters").select(SUMMARY_COLUMNS),
    db.from("level_gains").select("character_id, gained, history_since"),
  ]);
  if (chars.error) {
    els.rosterMessage.textContent = "Could not load the roster. Try reloading the page.";
    console.error(chars.error);
    return;
  }
  characters = chars.data;
  gains = new Map((gainRows.data ?? []).map((g) => [g.character_id, g]));
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
    const { character, existed } = await callSync({ action: "add", passphrase: pass, region, name, surname });
    passphrase.set(pass);
    els.addMessage.className = "form-message ok";
    els.addMessage.textContent = existed
      ? `${fullName(character)} is already on the roster.`
      : `Added ${fullName(character)}.`;
    els.addForm.elements.name.value = "";
    els.addForm.elements.surname.value = "";
    els.addForm.elements.passphrase.value = "";
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
