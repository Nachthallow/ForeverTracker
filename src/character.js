// Character page: character.html?c=<region>/<slug>
import {
  db,
  el,
  fullName,
  characterUrl,
  callSync,
  passphrase,
  characterCard,
  loadPlayers,
  fillPlayerList,
  PASSPHRASE_NOTE,
  SUMMARY_COLUMNS,
} from "./lib.js";

const sheet = document.getElementById("sheet");

// Paper-doll order. Slots not listed here go at the end in API order.
const SLOT_ORDER = [
  "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST",
  "HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2",
  "MAIN_HAND", "OFF_HAND", "RANGED",
];

function slotRank(type) {
  const i = SLOT_ORDER.indexOf(type);
  return i === -1 ? SLOT_ORDER.length : i;
}

function parseTarget() {
  const raw = new URLSearchParams(location.search).get("c") ?? "";
  const cut = raw.indexOf("/");
  if (cut < 1) return null;
  return { region: raw.slice(0, cut).toLowerCase(), slug: raw.slice(cut + 1).toLowerCase() };
}

function gearSection(equipment) {
  const items = [...(equipment?.equipped_items ?? [])].sort((a, b) => slotRank(a.slot?.type) - slotRank(b.slot?.type));
  if (items.length === 0) return el("section", { class: "panel" }, el("h2", {}, "Gear"), el("p", { class: "muted" }, "No gear stored yet."));

  return el(
    "section",
    { class: "panel", "aria-labelledby": "gear-heading" },
    el("h2", { id: "gear-heading" }, "Gear"),
    el(
      "table",
      { class: "gear" },
      el("thead", {}, el("tr", {}, el("th", {}, "Slot"), el("th", {}, "Item"), el("th", { class: "num" }, "Item level"))),
      el(
        "tbody",
        {},
        items.map((item) => {
          const quality = (item.quality?.type ?? "common").toLowerCase();
          return el(
            "tr",
            {},
            el("td", { class: "slot" }, item.slot?.name ?? item.slot?.type ?? ""),
            el(
              "td",
              {},
              el("span", { class: `item q-${quality}` }, item.name ?? "Unknown item"),
              " ",
              el("span", { class: `tag q-${quality}` }, item.quality?.name ?? titleQuality(quality)),
            ),
            el("td", { class: "num" }, item.level?.value ?? ""),
          );
        }),
      ),
    ),
  );
}

function titleQuality(q) {
  return q.charAt(0).toUpperCase() + q.slice(1);
}

function professionBlock(p) {
  return (p.tiers ?? []).map((tier) => {
    const skill = tier.skill_points ?? 0;
    const max = tier.max_skill_points ?? 0;
    const recipes = [...(tier.known_recipes ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const pct = max ? Math.min(100, Math.round((skill / max) * 100)) : 0;
    return el(
      "div",
      { class: "profession" },
      el(
        "div",
        { class: "prof-head" },
        el("span", { class: "prof-name" }, p.profession?.name ?? tier.tier?.name ?? "Profession"),
        el("span", { class: "prof-skill" }, `${skill} / ${max}`),
      ),
      el("div", { class: "bar", role: "presentation" }, el("span", { style: `width: ${pct}%` })),
      recipes.length > 0 &&
        el(
          "details",
          {},
          el("summary", {}, `${recipes.length} known ${recipes.length === 1 ? "recipe" : "recipes"}`),
          el("ul", { class: "recipe-list" }, recipes.map((r) => el("li", {}, r.name))),
        ),
    );
  });
}

function professionsSection(professions) {
  const primaries = professions?.primaries ?? [];
  const secondaries = professions?.secondaries ?? [];
  const body = primaries.length + secondaries.length === 0
    ? el("p", { class: "muted" }, "No professions stored yet.")
    : [
      primaries.length > 0 && [el("h3", { class: "sub" }, "Primary"), primaries.map(professionBlock)],
      secondaries.length > 0 && [el("h3", { class: "sub" }, "Secondary"), secondaries.map(professionBlock)],
    ];
  return el(
    "section",
    { class: "panel", "aria-labelledby": "prof-heading" },
    el("h2", { id: "prof-heading" }, "Professions"),
    body,
  );
}

function questSection(inProgress, completedCount) {
  return el(
    "section",
    { class: "panel", "aria-labelledby": "quest-heading" },
    el("h2", { id: "quest-heading" }, "Quest log"),
    el(
      "p",
      {},
      `${inProgress.length} in progress. ${completedCount ?? "?"} completed in total.`,
    ),
    inProgress.length > 0 &&
      el("ul", { class: "quest-list" }, inProgress.map((q) => el("li", {}, q.name ?? `Quest ${q.quest_id}`))),
  );
}

// Who plays this character, their other characters, and a form to change it.
function playerSection(c, players, others) {
  const message = el("p", { class: "form-message", role: "status", "aria-live": "polite" });
  const list = el("datalist", { id: "player-options" });
  fillPlayerList(list, players);
  const playerInput = el("input", {
    name: "player",
    list: "player-options",
    autocomplete: "off",
    maxlength: 32,
    value: c.player_name ?? "",
    placeholder: "Who plays it",
  });
  const passInput = el("input", { name: "passphrase", type: "password", autocomplete: "current-password" });
  const passLabel = el("label", { hidden: passphrase.get() !== "" }, el("span", {}, "Group passphrase"), passInput);
  const save = el("button", { type: "submit", class: "btn" }, "Save player");

  const form = el(
    "form",
    { class: "add-form" },
    el("label", {}, el("span", {}, "Player"), playerInput, list),
    passLabel,
    save,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pass = passphrase.get() || passInput.value;
    if (!pass) {
      passLabel.hidden = false;
      message.className = "form-message error";
      message.textContent = "Enter the group passphrase.";
      return;
    }
    save.disabled = true;
    try {
      await callSync({ action: "set_player", id: c.id, player: playerInput.value.trim(), passphrase: pass });
      passphrase.set(pass);
      await load();
    } catch (err) {
      if (err.wrongPassphrase) {
        passphrase.forget();
        passLabel.hidden = false;
      }
      message.className = "form-message error";
      message.textContent = err.message;
      save.disabled = false;
    }
  });

  return el(
    "section",
    { class: "panel", "aria-labelledby": "player-heading" },
    el("h2", { id: "player-heading" }, "Player"),
    el("p", {}, c.player_name ? `Played by ${c.player_name}.` : "Not tagged to a player yet."),
    others.length > 0 &&
      el(
        "p",
        {},
        `${c.player_name} also plays: `,
        others.map((o, i) => [
          i > 0 ? ", " : "",
          el("a", { href: characterUrl(o) }, fullName(o)),
          ` (${o.level ?? "?"}, ${o.region.toUpperCase()})`,
        ]),
      ),
    form,
    message,
    el("p", { class: "muted small" }, "Leave the field empty to remove the tag. A player with no characters left is removed."),
  );
}

function removeSection(c) {
  const message = el("p", { class: "form-message", role: "status", "aria-live": "polite" });
  const passInput = el("input", { name: "passphrase", type: "password", autocomplete: "current-password" });
  const passLabel = el("label", {}, el("span", {}, "Group passphrase"), passInput);
  const confirmButton = el("button", { type: "submit", class: "btn" }, `Yes, remove ${c.first_name}`);
  const form = el(
    "form",
    { class: "add-form", hidden: true },
    passLabel,
    confirmButton,
  );
  const start = el("button", { type: "button", class: "btn" }, "Remove from roster");

  start.addEventListener("click", () => {
    start.hidden = true;
    form.hidden = false;
    passLabel.hidden = passphrase.get() !== "";
    message.className = "form-message";
    message.textContent =
      `This deletes ${fullName(c)}'s synced data and level history. Adding the character again ` +
      "brings back everything except the history.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pass = passphrase.get() || passInput.value;
    if (!pass) {
      message.className = "form-message error";
      message.textContent = "Enter the group passphrase.";
      return;
    }
    confirmButton.disabled = true;
    try {
      await callSync({ action: "remove", id: c.id, passphrase: pass });
      passphrase.set(pass);
      location.href = "./";
    } catch (err) {
      if (err.wrongPassphrase) {
        passphrase.forget();
        passLabel.hidden = false;
      }
      message.className = "form-message error";
      message.textContent = err.message;
      confirmButton.disabled = false;
    }
  });

  return el(
    "section",
    { class: "panel", "aria-labelledby": "remove-heading" },
    el("h2", { id: "remove-heading" }, "Remove"),
    start,
    form,
    message,
    el("p", { class: "muted small" }, PASSPHRASE_NOTE),
  );
}

async function load() {
  const target = parseTarget();
  if (!target) {
    sheet.replaceChildren(el("p", {}, "No character in this link. ", el("a", { href: "./" }, "Back to the group.")));
    return;
  }

  const { data: c, error } = await db
    .from("characters")
    .select(`${SUMMARY_COLUMNS}, equipment, professions`)
    .eq("region", target.region)
    .eq("slug", target.slug)
    .maybeSingle();
  if (error || !c) {
    sheet.replaceChildren(
      el("p", {}, "That character is not on the roster. ", el("a", { href: "./" }, "Back to the group.")),
    );
    if (error) console.error(error);
    return;
  }

  const players = await loadPlayers();
  c.player_name = players.get(c.player_id) ?? null;

  const [quests, completed, others] = await Promise.all([
    db.from("character_quests").select("quest_id, name").eq("character_id", c.id).eq("state", "in_progress").order("name"),
    db.from("character_quests").select("quest_id", { count: "exact", head: true }).eq("character_id", c.id).eq("state", "completed"),
    c.player_id != null
      ? db.from("characters").select("id, region, slug, first_name, surname, level").eq("player_id", c.player_id).neq("id", c.id).order("level", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  document.title = `${fullName(c)} - Forever Roster`;
  sheet.replaceChildren(
    el("div", { class: "sheet-head" }, characterCard(c, { onUpdate: load })),
    el("div", { class: "sheet-grid" }, gearSection(c.equipment), professionsSection(c.professions)),
    questSection(quests.data ?? [], completed.count),
    playerSection(c, players, others.data ?? []),
    removeSection(c),
  );
}

load();
