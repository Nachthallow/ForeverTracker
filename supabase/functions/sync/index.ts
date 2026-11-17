// Forever Roster: sync characters from the Blizzard API into Postgres.
//
// POST body, one of:
//   { "action": "check", "passphrase": "..." }
//   { "action": "add", "passphrase": "...", "region": "us", "name": "Nachtwald", "surname": "Ravensong" }
//   { "action": "remove", "passphrase": "...", "id": 1 }
//   { "action": "refresh", "id": 1 }       10-minute cooldown per character
//   { "action": "all" }                    needs header x-cron-secret = CRON_SECRET
//
// Called from the browser with the publishable key, which is not a JWT, so JWT
// verification is off for this function (see config.toml). Writes use the
// service role. The group passphrase (GROUP_PASSPHRASE) keeps strangers from
// adding or removing characters; it is not real security.

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCharacter, makeSlug, NotFoundError, REGIONS, type Region } from "../_shared/blizzard.ts";

const COOLDOWN_MS = 10 * 60 * 1000;
const ALL_CONCURRENCY = 3;
const MAX_WRONG_PASSPHRASES = 5;
const PASSPHRASE_LOCK_MS = 15 * 60 * 1000;

// Columns sent back to the browser: everything except the raw JSON blobs.
const SUMMARY_COLUMNS =
  "id, region, blizzard_id, first_name, surname, slug, level, class, race, faction, guild, ruleset, " +
  "item_level, avatar_url, last_synced_at, sync_error";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
  } catch {
    throw new Error("no service key in the function environment");
  }
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false },
});

// Fetches one character and writes it. Character, quest log and level
// snapshot are saved in one transaction. Returns the stored summary row.
async function syncOne(region: Region, slug: string) {
  const { character, quests } = await fetchCharacter(region, slug);

  const { data: id, error } = await db.rpc("save_character_sync", {
    p_character: character,
    p_quests: quests,
  });
  if (error) throw new Error(`saving character: ${error.message}`);

  const { data: row, error: readError } = await db
    .from("characters")
    .select(SUMMARY_COLUMNS)
    .eq("id", id)
    .single();
  if (readError) throw new Error(`reading character back: ${readError.message}`);
  return row;
}

// Group passphrase -------------------------------------------------------------

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

// Compares SHA-256 digests byte by byte without stopping early, so the time
// taken does not depend on how much of the guess is right.
async function sameText(a: string, b: string): Promise<boolean> {
  const encode = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [x, y] = (await Promise.all([encode(a), encode(b)])).map((d) => new Uint8Array(d));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Returns null when the passphrase is right, or the error response to send.
async function checkPassphrase(req: Request, given: unknown): Promise<Response | null> {
  const expected = Deno.env.get("GROUP_PASSPHRASE");
  if (!expected) return json({ error: "The group passphrase has not been set up yet." }, 503);

  const ip = clientIp(req);
  const now = Date.now();
  const { data: attempt } = await db
    .from("passphrase_attempts")
    .select("failed_attempts, locked_until, last_failed_at")
    .eq("ip", ip)
    .maybeSingle();

  const lockedUntil = attempt?.locked_until ? Date.parse(attempt.locked_until) : 0;
  if (lockedUntil > now) {
    return json({
      error: "Too many wrong passphrases from here.",
      retry_after: Math.ceil((lockedUntil - now) / 1000),
    }, 429);
  }

  if (typeof given === "string" && given.length > 0 && await sameText(given, expected)) {
    if (attempt) await db.from("passphrase_attempts").delete().eq("ip", ip);
    return null;
  }

  // Count wrong tries within the last 15 minutes; older ones are forgotten.
  const recent = attempt?.last_failed_at && now - Date.parse(attempt.last_failed_at) < PASSPHRASE_LOCK_MS;
  const failed = (recent ? attempt.failed_attempts : 0) + 1;
  const locked = failed >= MAX_WRONG_PASSPHRASES;
  await db.from("passphrase_attempts").upsert({
    ip,
    failed_attempts: locked ? 0 : failed,
    locked_until: locked ? new Date(now + PASSPHRASE_LOCK_MS).toISOString() : null,
    last_failed_at: new Date(now).toISOString(),
  });

  if (locked) {
    return json({ error: "Too many wrong passphrases from here.", retry_after: PASSPHRASE_LOCK_MS / 1000 }, 429);
  }
  const left = MAX_WRONG_PASSPHRASES - failed;
  return json({ error: `Wrong passphrase. ${left} ${left === 1 ? "try" : "tries"} left.`, wrong_passphrase: true }, 403);
}

async function recordFailure(id: number, err: unknown): Promise<string> {
  const message = err instanceof NotFoundError
    ? "Blizzard no longer finds this character. It may have been renamed or deleted."
    : String(err instanceof Error ? err.message : err);
  await db.from("characters").update({ sync_error: message }).eq("id", id);
  return message;
}

async function handleAdd(req: Request, body: Record<string, unknown>) {
  const denied = await checkPassphrase(req, body.passphrase);
  if (denied) return denied;

  const region = String(body.region ?? "us").toLowerCase() as Region;
  const name = String(body.name ?? "").trim();
  const surname = String(body.surname ?? "").trim();

  if (!REGIONS.includes(region)) return json({ error: `Region must be one of ${REGIONS.join(", ")}.` }, 400);
  if (!name || !surname) return json({ error: "Name and surname are both needed." }, 400);
  if (name.length > 32 || surname.length > 32) return json({ error: "That name is too long." }, 400);

  const slug = makeSlug(name, surname);

  const { data: existing } = await db
    .from("characters")
    .select(SUMMARY_COLUMNS)
    .eq("region", region)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return json({ character: existing, existed: true });

  try {
    return json({ character: await syncOne(region, slug), existed: false });
  } catch (err) {
    if (err instanceof NotFoundError) {
      const other = region === "us" ? "EU" : "US";
      return json({
        error: `${name} ${surname} was not found in ${region.toUpperCase()}. Check the spelling, or try ${other}. ` +
          "New characters may only show up after reaching level 10 and logging out.",
      }, 404);
    }
    console.error("add failed", slug, err);
    return json({ error: "Blizzard did not answer properly. Try again in a minute." }, 502);
  }
}

async function handleRemove(req: Request, body: Record<string, unknown>) {
  const denied = await checkPassphrase(req, body.passphrase);
  if (denied) return denied;

  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: "Missing character id." }, 400);

  // Cascades to the quest log and level history.
  const { data: removed, error } = await db
    .from("characters")
    .delete()
    .eq("id", id)
    .select("first_name, surname")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!removed) return json({ error: "No such character." }, 404);
  return json({ removed });
}

async function handleRefresh(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: "Missing character id." }, 400);

  const { data: row } = await db
    .from("characters")
    .select("id, region, slug, last_synced_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return json({ error: "No such character." }, 404);

  const since = row.last_synced_at ? Date.now() - Date.parse(row.last_synced_at) : Infinity;
  if (since < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - since) / 1000);
    return json({ error: "Refreshed less than 10 minutes ago.", retry_after: retryAfter }, 429);
  }

  try {
    return json({ character: await syncOne(row.region, row.slug) });
  } catch (err) {
    console.error("refresh failed", row.slug, err);
    return json({ error: await recordFailure(row.id, err) }, 502);
  }
}

async function handleAll(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || !(await sameText(req.headers.get("x-cron-secret") ?? "", secret))) return json({ error: "Not allowed." }, 401);

  const { data: rows, error } = await db.from("characters").select("id, region, slug").order("id");
  if (error) return json({ error: error.message }, 500);

  const results: { id: number; slug: string; ok: boolean; error?: string }[] = [];
  const queue = [...rows];
  async function worker() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        await syncOne(row.region, row.slug);
        results.push({ id: row.id, slug: row.slug, ok: true });
      } catch (err) {
        results.push({ id: row.id, slug: row.slug, ok: false, error: await recordFailure(row.id, err) });
      }
    }
  }
  await Promise.all(Array.from({ length: ALL_CONCURRENCY }, worker));

  return json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  switch (body.action) {
    case "check":
      return (await checkPassphrase(req, body.passphrase)) ?? json({ ok: true });
    case "add":
      return handleAdd(req, body);
    case "remove":
      return handleRemove(req, body);
    case "refresh":
      return handleRefresh(body);
    case "all":
      return handleAll(req);
    default:
      return json({ error: "action must be check, add, remove, refresh or all." }, 400);
  }
});
