// Shared by every page: the Supabase client, DOM helpers, the sync call,
// the remembered passphrase and the leather character card.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

// Classes in the theme. Anything else (Forever may add more) shows in plain text.
const CLASS_KEYS = new Set(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);

export function classSpan(className) {
  const key = (className ?? "").toLowerCase();
  const cls = CLASS_KEYS.has(key) ? `class-name class-${key}` : "class-name";
  return el("span", { class: cls }, className ?? "Unknown class");
}

// Small DOM helper. Text always goes in through text nodes, never innerHTML.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function timeAgo(iso) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function titleCase(word) {
  return word ? word.charAt(0) + word.slice(1).toLowerCase() : "";
}

export function fullName(c) {
  return `${c.first_name} ${c.surname}`;
}

export function characterUrl(c) {
  return `character.html?c=${c.region}/${encodeURIComponent(c.slug)}`;
}

// Calls the sync Edge Function. Throws an Error carrying our own message;
// err.wrongPassphrase is set when the passphrase was rejected.
export async function callSync(body) {
  const { data, error } = await db.functions.invoke("sync", { body });
  if (!error) return data;
  const failure = new Error("Something went wrong. Try again in a minute.");
  try {
    const payload = await error.context.json();
    if (payload?.error) failure.message = payload.error;
    if (payload?.retry_after) failure.message += ` Try again in ${Math.ceil(payload.retry_after / 60)} min.`;
    failure.wrongPassphrase = Boolean(payload?.wrong_passphrase);
  } catch {
    // keep the generic message
  }
  throw failure;
}

// The group passphrase, remembered in this browser only.
const PASSPHRASE_KEY = "forever-roster-passphrase";

export const passphrase = {
  get() {
    try {
      return localStorage.getItem(PASSPHRASE_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(value) {
    try {
      localStorage.setItem(PASSPHRASE_KEY, value);
    } catch {
      // storage blocked; the user just types it again next time
    }
  },
  forget() {
    try {
      localStorage.removeItem(PASSPHRASE_KEY);
    } catch {
      // nothing to forget
    }
  },
};

export const PASSPHRASE_NOTE =
  "The passphrase only keeps strangers from adding or removing characters. It is not real security: " +
  "anyone with the link can see everything here.";

function avatar(c) {
  const initial = el("span", { class: "avatar avatar-fallback", "aria-hidden": "true" }, c.first_name.charAt(0));
  if (!c.avatar_url) return initial;
  const img = el("img", { class: "avatar", src: c.avatar_url, alt: "", loading: "lazy", width: 64, height: 64 });
  img.addEventListener("error", () => img.replaceWith(initial));
  return img;
}

// The leather card. onUpdate(character) is called after a successful refresh.
// With link set, the name links to the character page.
export function characterCard(c, { link = false, onUpdate } = {}) {
  const refresh = el("button", { class: "btn btn-small", type: "button" }, "Refresh");
  const status = el("p", { class: "card-status", role: "status", "aria-live": "polite" });
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    status.textContent = "Refreshing...";
    try {
      const { character } = await callSync({ action: "refresh", id: c.id });
      onUpdate?.(character);
    } catch (err) {
      status.textContent = err.message;
      refresh.disabled = false;
    }
  });

  const name = link ? el("a", { href: characterUrl(c) }, fullName(c)) : fullName(c);

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
        el("h3", { class: "char-name" }, name),
        el("p", { class: "char-line" }, `Level ${c.level ?? "?"} `, classSpan(c.class)),
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
      c.last_login_at && [el("dt", {}, "Last on"), el("dd", {}, timeAgo(c.last_login_at))],
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

export const SUMMARY_COLUMNS =
  "id, region, slug, first_name, surname, level, class, race, faction, guild, ruleset, " +
  "item_level, avatar_url, last_login_at, last_synced_at, sync_error";
