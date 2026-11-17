// Forever Roster: everything that knows about the Blizzard API lives here.
// The Forever profile API is undocumented, so URL building and field mapping
// stay in this one module. Raw equipment and professions JSON is stored as-is
// so a mapping change does not need a re-fetch.

export const REGIONS = ["us", "eu", "kr", "tw"] as const;
export type Region = (typeof REGIONS)[number];

export class NotFoundError extends Error {}

export class BlizzardError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Client credentials tokens last about a day; reuse one while the function
// instance stays warm.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const id = Deno.env.get("BLIZZARD_CLIENT_ID");
  const secret = Deno.env.get("BLIZZARD_CLIENT_SECRET");
  if (!id || !secret) throw new Error("BLIZZARD_CLIENT_ID or BLIZZARD_CLIENT_SECRET is not set");

  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${id}:${secret}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new BlizzardError(res.status, `token request failed: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export function makeSlug(name: string, surname: string): string {
  return `${name.trim()}-${surname.trim()}`.toLowerCase();
}

async function get(region: Region, slug: string, sub: string, token: string) {
  const path = sub ? `/${sub}` : "";
  const url =
    `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(slug)}${path}` +
    `?namespace=profile-forever-${region}&locale=en_US`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new NotFoundError(`${sub || "profile"} not found`);
  if (!res.ok) throw new BlizzardError(res.status, `${sub || "profile"} returned ${res.status}`);
  return res.json();
}

export type CharacterRow = {
  region: Region;
  blizzard_id: number;
  first_name: string;
  surname: string;
  slug: string;
  level: number | null;
  experience: number | null;
  class: string | null;
  class_id: number | null;
  race: string | null;
  race_id: number | null;
  faction: string | null;
  guild: string | null;
  ruleset: string | null;
  item_level: number | null;
  avatar_url: string | null;
  equipment: unknown;
  professions: unknown;
  dungeons_done: number[] | null; // null when achievements did not load: keep what is stored
  last_login_at: string | null;
};

export type QuestRow = { quest_id: number; name: string | null; state: "in_progress" | "completed" };

type NamedRef = { id: number; name?: string };

// Forever lists every dungeon as one criterion of these three achievements
// (Novice, Experienced and Master Spelunker). A completed criterion means the
// character has completed that dungeon. dungeons.criteria_id holds the IDs.
const SPELUNKER_ACHIEVEMENTS = new Set([62031, 62032, 62033]);

type AchievementEntry = {
  id: number;
  criteria?: { child_criteria?: { id: number; is_completed?: boolean }[] };
};

function completedDungeonCriteria(achievements: { achievements?: AchievementEntry[] } | null): number[] | null {
  if (!achievements) return null;
  const done: number[] = [];
  for (const a of achievements?.achievements ?? []) {
    if (!SPELUNKER_ACHIEVEMENTS.has(a.id)) continue;
    for (const c of a.criteria?.child_criteria ?? []) if (c.is_completed) done.push(c.id);
  }
  return done;
}

// Fetches everything one character needs. Throws NotFoundError if Blizzard
// does not know the character in this region.
export async function fetchCharacter(region: Region, slug: string) {
  const token = await getToken();

  // The base profile first: a 404 here means wrong name or wrong region,
  // and there is no point making the other six calls.
  const base = await get(region, slug, "", token);

  const [equipment, professions, quests, completed, media, achievements] = await Promise.all([
    get(region, slug, "equipment", token),
    get(region, slug, "professions", token),
    get(region, slug, "quests", token),
    get(region, slug, "quests/completed", token),
    // A missing render should not fail the whole sync.
    get(region, slug, "character-media", token).catch(() => null),
    // Dungeon completions come from achievements; a failure here should not fail the sync.
    get(region, slug, "achievements", token).catch(() => null),
  ]);

  const character: CharacterRow = {
    region,
    blizzard_id: base.id,
    first_name: base.name,
    surname: base.surname,
    slug: makeSlug(base.name, base.surname),
    level: base.level ?? null,
    experience: base.experience ?? null,
    class: base.character_class?.name ?? null,
    class_id: base.character_class?.id ?? null,
    race: base.race?.name ?? null,
    race_id: base.race?.id ?? null,
    faction: base.faction?.type ?? null,
    guild: base.guild?.name ?? null,
    ruleset: base.ruleset?.name ?? null,
    item_level: base.average_item_level ?? null,
    avatar_url: media?.assets?.find((a: { key: string }) => a.key === "avatar")?.value ?? null,
    equipment,
    professions,
    dungeons_done: completedDungeonCriteria(achievements),
    last_login_at: base.last_login_timestamp ? new Date(base.last_login_timestamp).toISOString() : null,
  };

  const toRows = (list: NamedRef[] | undefined, state: QuestRow["state"]): QuestRow[] =>
    (list ?? []).map((q) => ({ quest_id: q.id, name: q.name ?? null, state }));

  const questRows = [
    ...toRows(quests.in_progress, "in_progress"),
    ...toRows(completed.quests, "completed"),
  ];

  return { character, quests: questRows };
}
