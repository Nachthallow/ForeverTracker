// Forever Roster, Phase 0 probe. Throwaway: delete once the data source is proven.
//
// Asks Blizzard which Forever character endpoints answer for one character
// and reports status, field names and a short sample for each.
//
// Secrets (Supabase > Edge Functions > Secrets), never in the repo:
//   BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET
//
// Call: /functions/v1/probe?region=eu&name=Nachtwald&surname=Ravensong
// Add &full=1 to get whole response bodies instead of trimmed samples.

const REGIONS = ["us", "eu", "kr", "tw"];

// "" is the base profile. The rest are tried on the same path.
const ENDPOINTS = [
  "",
  "status",
  "equipment",
  "professions",
  "quests",
  "quests/completed",
  "character-media",
  "specializations",
  "statistics",
  "achievements",
  "reputations",
  "appearance",
];

const SAMPLE_CHARS = 1500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getToken(id: string, secret: string) {
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${id}:${secret}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, error: text.slice(0, 300) };
  return { ok: true as const, token: JSON.parse(text).access_token as string };
}

// Field names two levels deep, so we can see the shape without the bulk.
function shape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[] (empty)" : [`${value.length} items`, shape(value[0], depth + 1)];
  }
  if (value && typeof value === "object") {
    if (depth >= 2) return "{...}";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_links") continue;
      out[k] = shape(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

async function probeOne(base: string, sub: string, qs: string, token: string, full: boolean) {
  const path = sub ? `${base}/${sub}` : base;
  const started = Date.now();
  try {
    const res = await fetch(`${path}?${qs}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON; keep the raw text sample below
    }
    return {
      endpoint: sub || "(base profile)",
      status: res.status,
      ms: Date.now() - started,
      bytes: text.length,
      shape: res.ok && body ? shape(body) : undefined,
      body: full ? (body ?? text) : undefined,
      sample: full ? undefined : text.slice(0, SAMPLE_CHARS),
    };
  } catch (err) {
    return { endpoint: sub || "(base profile)", status: 0, error: String(err) };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const region = (url.searchParams.get("region") ?? "eu").toLowerCase();
  const name = (url.searchParams.get("name") ?? "Nachtwald").trim();
  const surname = (url.searchParams.get("surname") ?? "Ravensong").trim();
  const full = url.searchParams.get("full") === "1";

  if (!REGIONS.includes(region)) return json({ error: `region must be one of ${REGIONS.join(", ")}` }, 400);
  if (!name || !surname) return json({ error: "name and surname are required" }, 400);

  const id = Deno.env.get("BLIZZARD_CLIENT_ID");
  const secret = Deno.env.get("BLIZZARD_CLIENT_SECRET");
  if (!id || !secret) {
    return json({ error: "BLIZZARD_CLIENT_ID or BLIZZARD_CLIENT_SECRET is not set in Edge Function secrets" }, 500);
  }

  const auth = await getToken(id, secret);
  if (!auth.ok) return json({ step: "token", ...auth }, 502);

  const slug = encodeURIComponent(`${name}-${surname}`.toLowerCase());
  const base = `https://${region}.api.blizzard.com/profile/wow/character/${slug}`;
  const qs = `namespace=profile-forever-${region}&locale=en_US`;

  const results = [];
  for (const sub of ENDPOINTS) {
    results.push(await probeOne(base, sub, qs, auth.token, full));
  }

  return json({
    probed_at: new Date().toISOString(),
    token: "client credentials, ok",
    region,
    slug,
    namespace: `profile-forever-${region}`,
    summary: results.map((r) => `${r.status} ${r.endpoint}`),
    results,
  });
});
