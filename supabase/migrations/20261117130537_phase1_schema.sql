-- Forever Roster, Phase 1 schema.
--
-- Access model: the browser uses the publishable key and can only read.
-- Every write goes through an Edge Function (service role) or a
-- security-definer RPC added in a later phase.

-- Characters --------------------------------------------------------------

create table public.characters (
  id              bigint generated always as identity primary key,
  region          text not null default 'us' check (region in ('us', 'eu', 'kr', 'tw')),
  blizzard_id     bigint not null,
  first_name      text not null,
  surname         text not null,
  slug            text not null,              -- lowercase "name-surname", not URL-encoded
  level           int,
  experience      bigint,
  class           text,
  class_id        int,
  race            text,
  race_id         int,
  faction         text check (faction in ('ALLIANCE', 'HORDE')),
  guild           text,
  ruleset         text,
  item_level      int,
  avatar_url      text,
  equipment       jsonb,                      -- raw Blizzard response, re-mappable without a re-fetch
  professions     jsonb,                      -- raw Blizzard response
  zone            text,                       -- self-reported, optional
  last_login_at   timestamptz,
  last_synced_at  timestamptz,
  sync_error      text,                       -- last failure message, null when the last sync worked
  claimed_by      text,                       -- display name, honor system
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (region, slug),
  unique (region, blizzard_id)
);

-- PIN hashes and wrong-PIN counters live apart from characters so they can
-- never leak through a "select *". No policies: invisible to the browser.
create table public.character_pins (
  character_id    bigint primary key references public.characters (id) on delete cascade,
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz
);

-- Quest log, replaced on each sync -----------------------------------------

create table public.character_quests (
  character_id    bigint not null references public.characters (id) on delete cascade,
  quest_id        int not null,
  name            text,
  state           text not null check (state in ('in_progress', 'completed')),
  primary key (character_id, quest_id, state)
);

create index character_quests_quest_id_idx on public.character_quests (quest_id);

-- Dungeons, seeded in Phase 3 ------------------------------------------------

create table public.dungeons (
  id              bigint generated always as identity primary key,
  name            text not null unique,
  zone            text,
  min_level       int not null,
  max_level       int not null,
  faction_note    text,
  is_new          boolean not null default false,
  check (min_level <= max_level)
);

-- Needs board ---------------------------------------------------------------

create table public.needs (
  id              bigint generated always as identity primary key,
  character_id    bigint not null references public.characters (id) on delete cascade,
  type            text not null check (type in ('quest', 'gear', 'recipe', 'hunting')),
  name            text not null,
  quality         text check (quality in ('poor', 'common', 'uncommon', 'rare', 'epic', 'legendary')),
  source          text,
  note            text,
  done            boolean not null default false,
  created_at      timestamptz not null default now()
);

create index needs_character_id_idx on public.needs (character_id);

-- Row Level Security --------------------------------------------------------

alter table public.characters       enable row level security;
alter table public.character_pins   enable row level security;
alter table public.character_quests enable row level security;
alter table public.dungeons         enable row level security;
alter table public.needs            enable row level security;

create policy "anyone can read" on public.characters       for select to anon, authenticated using (true);
create policy "anyone can read" on public.character_quests for select to anon, authenticated using (true);
create policy "anyone can read" on public.dungeons         for select to anon, authenticated using (true);
create policy "anyone can read" on public.needs            for select to anon, authenticated using (true);

-- Belt and braces: RLS already blocks writes without policies, but take the
-- table privileges away too so a stray policy later cannot open them.
revoke insert, update, delete, truncate on
  public.characters, public.character_quests, public.dungeons, public.needs
  from anon, authenticated;
revoke all on public.character_pins from anon, authenticated;
