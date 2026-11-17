import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

const ROSTER_COLUMNS =
  "id, region, first_name, surname, level, class, race, faction, guild, ruleset, " +
  "item_level, avatar_url, last_synced_at, sync_error, claimed_by";

// Classes in the theme. Anything else (Forever may add more) shows in plain text.
const CLASS_KEYS = new Set(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);

const els = {
  roster: document.getElementById("roster"),
  rosterMessage: document.getElementById("roster-message"),
  addForm: document.getElementById("add-form"),
  addMessage: document.getElementById("add-message"),
  faction: document.getElementById("filter-faction"),
  region: document.getElementById("filter-region"),
  sort: document.getElementById("sort"),
};

let characters = [];

// Small DOM helper. Text always goes in through textContent, never innerHTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function timeAgo(iso) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function titleCase(word) {
  return word ? word.charAt(0) + word.slice(1).toLowerCase() : "";
}

async function callSync(body) {
  const { data, error } = await db.functions.invoke("sync", { body });
  if (!error) return data;
  // Non-2xx responses carry our own error message in the body.
  let message = "Something went wrong. Try again in a minute.";
  try {
    const payload = await error.context.json();
    if (payload?.error) message = payload.error;
    if (payload?.retry_after) message += ` Try again in ${Math.ceil(payload.retry_after / 60)} min.`;
  } catch {
    // keep the generic message
  }
  throw new Error(message);
}

function avatar(c) {
  const initial = el("span", { class: "avatar avatar-fallback", "aria-hidden": "true" }, c.first_name.charAt(0));
  if (!c.avatar_url) return initial;
  const img = el("img", { class: "avatar", src: c.avatar_url, alt: "", loading: "lazy", width: 64, height: 64 });
  img.addEventListener("error", () => img.replaceWith(initial));
  return img;
}

function card(c) {
  const classKey = (c.class ?? "").toLowerCase();
  const classAttr = CLASS_KEYS.has(classKey) ? `class-name class-${classKey}` : "class-name";

  const refresh = el("button", { class: "btn btn-small", type: "button" }, "Refresh");
  const status = el("p", { class: "card-status", role: "status", "aria-live": "polite" });
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    status.textContent = "Refreshing...";
    try {
      const { character } = await callSync({ action: "refresh", id: c.id });
      Object.assign(c, character);
      render();
    } catch (err) {
      status.textContent = err.message;
      refresh.disabled = false;
    }
  });

  return el(
    "article",
    { class: "card" },
    el(
      "div",
      { class: "card-top" },
      avatar(c),
      el(
        "div",
        { class: "card-id" },
        el("h3", { class: "char-name" }, `${c.first_name} ${c.surname}`),
        el(
          "p",
          { class: "char-line" },
          `Level ${c.level ?? "?"} `,
          el("span", { class: classAttr }, c.class ?? "Unknown class"),
        ),
        el("p", { class: "char-line" }, c.race ?? ""),
      ),
    ),
    el(
      "div",
      { class: "badges" },
      c.faction && el("span", { class: `badge badge-${c.faction.toLowerCase()}` }, titleCase(c.faction)),
      c.ruleset && el("span", { class: "badge" }, c.ruleset),
      el("span", { class: "badge" }, c.region.toUpperCase()),
    ),
    el(
      "dl",
      { class: "facts" },
      c.guild && [el("dt", {}, "Guild"), el("dd", {}, c.guild)],
      c.item_level != null && [el("dt", {}, "Item level"), el("dd", {}, c.item_level)],
      c.claimed_by && [el("dt", {}, "Played by"), el("dd", {}, c.claimed_by)],
    ),
    c.sync_error && el("p", { class: "card-error" }, `Last refresh failed: ${c.sync_error}`),
    el(
      "div",
      { class: "card-foot" },
      el("span", { class: "stamp" }, `Updated ${timeAgo(c.last_synced_at)}`),
      refresh,
    ),
    status,
  );
}

function visibleCharacters() {
  const faction = els.faction.value;
  const region = els.region.value;
  const list = characters.filter((c) => (!faction || c.faction === faction) && (!region || c.region === region));
  const byName = (a, b) => `${a.first_name} ${a.surname}`.localeCompare(`${b.first_name} ${b.surname}`);
  switch (els.sort.value) {
    case "level-asc":
      return list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || byName(a, b));
    case "name":
      return list.sort(byName);
    default:
      return list.sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || byName(a, b));
  }
}

function render() {
  const list = visibleCharacters();
  els.roster.replaceChildren(...list.map(card));
  if (characters.length === 0) {
    els.rosterMessage.textContent = "Nobody on the roster yet. Add the first character above.";
  } else if (list.length === 0) {
    els.rosterMessage.textContent = "No characters match these filters.";
  } else {
    els.rosterMessage.textContent = "";
  }
}

async function load() {
  els.rosterMessage.textContent = "Loading the roster...";
  const { data, error } = await db.from("characters").select(ROSTER_COLUMNS);
  if (error) {
    els.rosterMessage.textContent = "Could not load the roster. Try reloading the page.";
    console.error(error);
    return;
  }
  characters = data;
  render();
}

els.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.addForm);
  const name = String(form.get("name")).trim();
  const surname = String(form.get("surname")).trim();
  const region = String(form.get("region"));
  if (!name || !surname) {
    els.addMessage.textContent = "Name and surname are both needed.";
    return;
  }

  const button = els.addForm.querySelector("button");
  button.disabled = true;
  els.addMessage.className = "form-message";
  els.addMessage.textContent = "Asking Blizzard...";
  try {
    const { character, existed } = await callSync({ action: "add", region, name, surname });
    els.addMessage.className = "form-message ok";
    els.addMessage.textContent = existed
      ? `${character.first_name} ${character.surname} is already on the roster.`
      : `Added ${character.first_name} ${character.surname}.`;
    if (!existed) els.addForm.reset();
    await load();
  } catch (err) {
    els.addMessage.className = "form-message error";
    els.addMessage.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

for (const control of [els.faction, els.region, els.sort]) control.addEventListener("change", render);

load();
