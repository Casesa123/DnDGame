# Ledgerhall — a self-hosted D&D 5e platform

A complete virtual tabletop for running real D&D 5e campaigns with friends
over any distance: a full SRD-scope rules engine, a leveling/multiclass
character builder with spells and equipment, a live multiplayer game session
with a battle map, **server-resolved weapon and spell combat**, DM/Player
roles, fog of war, and mesh voice/video with screen share. Optional accounts
tie characters to a person; everything persists to disk (or Postgres) so a
campaign survives restarts.

## Run it locally

```
cd server
npm install
npm start
```

Open **http://localhost:3000**. To try multiplayer, open a second tab and
join the same Session ID — one as **Player**, one as **Dungeon Master**.

## Host it for your group

The server binds to `0.0.0.0`, so anyone on your **LAN** can join at
`http://<your-ip>:3000`. For remote friends:

- **Quick:** a tunnel — `ngrok http 3000` or a Cloudflare Tunnel — gives you a
  public HTTPS URL instantly.
- **Permanent:** a small VPS with Docker. This repo ships a `Dockerfile`,
  `docker-compose.yml` (app + a Caddy reverse proxy for **automatic HTTPS**),
  and `.env.example`:
  ```
  cp .env.example .env   # set DOMAIN, ALLOWED_ORIGIN, TURN_*, optionally DATABASE_URL
  docker compose up -d
  ```
  (The Docker build follows the standard Node pattern but wasn't runnable in
  the sandbox it was written in — test `docker build` before relying on it.)

**HTTPS is required for remote voice/video** — browsers block camera/mic on
plain HTTP for anyone but `localhost`.

**A TURN server is usually required for remote voice/video** to traverse home
routers/CGNAT. Set `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` to your
own (self-host `coturn`, or use Twilio/Metered/Xirsys). Unset, it falls back
to a public demo TURN server — fine for a quick test, not for a weekly game.

Env vars: `PORT` (3000), `HOST` (`0.0.0.0`), `ALLOWED_ORIGIN` (CORS lock-down),
`TURN_*`, and `DATABASE_URL` (see Storage).

## Storage

By default, all data (characters, users, session state, homebrew) is stored as
JSON files under `server/data/` and `content-packs/homebrew/` — durable and
simple for a single server. Set **`DATABASE_URL`** (and `npm install pg`) to
switch to Postgres instead; tables are created automatically. The Postgres
adapter follows standard `pg` usage but wasn't exercised against a live
database in the sandbox — test it before trusting a campaign to it. The file
store is what's been used end-to-end.

## What's implemented

**Content (SRD-scope, original wording):** 13 race/subrace entries (all 9 core
races), 12 classes with full level 1–20 progressions, subclasses, and ASI
levels; 220 spells (65 with structured combat data for auto-resolution); 124
monsters (CR 0–24); 120 weapons/armor/gear/magic items.

**Character builder:** race, multiclassing (per-class levels), subclass at the
right level, ability scores, equipped armor/shield/**weapons**, and
prepared/known spells per class. Computes HP, AC, saves, proficiency, and
spell slots (including the multiclass shared table and separate Warlock pact
magic). Save characters to reuse them at the table.

**Compendium:** searchable, filterable browser across every race, class, spell,
monster, and item currently loaded (core + homebrew).

**Live session (Socket.io):** a shared battle map with screen-independent token
positions and a 20×20 grid (5 ft/square). Drag to move, **shift-drag to measure
distance**, click a token for a detail panel (HP editor, spell-slot tracker,
**condition toggles**, long rest, remove). Initiative tracker, dice roller, and
chat, all synced and persisted.

**Real combat, resolved server-side:** turn on Attack mode, click your token,
pick from its actual attacks — **each equipped weapon** (correct to-hit and
damage from Str/Dex/finesse), plus **spell attacks** (attack roll vs AC),
**saving-throw spells** (the target rolls its save against your spell DC),
**auto-hit** spells (Magic Missile), and **healing** spells. Cantrips scale
with level, leveled spells scale with the slot you spend, and spell slots are
tracked and consumed. Every roll happens on the server, so results are
consistent and can't be faked by a modified client.

**Player vs. Dungeon Master roles:**
- *DM tools:* view any player's sheet, private notes, **secret dice rolls**,
  per-monster **Hide** and **Reveal HP** toggles, and a **fog of war** map —
  paint revealed cells, and non-PC tokens on hidden cells vanish from players
  entirely. All enforced server-side (players' sockets never receive gated
  data), plus a map **background image**.
- *Players:* bring in your saved character, act only on your own PC token
  (ownership enforced), and fight.

**Voice & video:** mesh WebRTC with mute, camera toggle, and **screen share**
(great for the DM to show a map or handout). ICE/TURN config is served from the
backend, and connections attempt an ICE restart on failure so a brief network
blip doesn't drop the call.

**Optional accounts:** register/login (scrypt-hashed passwords). When signed in,
your saved characters are scoped to you and only you (or the DM) can edit your
tokens. Skip it entirely for casual local play.

**Homebrew:** add a custom monster, spell, item, race, or class via a **form**
(no JSON needed) or by pasting a raw JSON pack. Everything is namespaced and
appears immediately in the builder and Compendium.

## What's simplified or deferred

- **Combat scope:** covers weapon attacks, spell attacks/saves/auto/heal, spell
  slots, and conditions — but not every 5e wrinkle (no reactions, resistances,
  cover, concentration checks, or multiattack automation; conditions are
  tracked and displayed but don't auto-apply mechanical effects).
- **Auth is lightweight:** in-memory bearer tokens (you re-login after a server
  restart), suited to a private group — not a hardened public auth system.
- **Voice/video is mesh**, which is right for a normal table (DM + 4–6). A
  larger table would want an SFU (mediasoup fits the stack); that's a
  substantial separate effort, deliberately not half-built here.
- **Maps** have a background image and fog of war, but no multi-map library,
  drawing tools, or dynamic line-of-sight.

## Legal note on content

Everything bundled is SRD-scope (openly licensed) with original wording, not
copied from Wizards of the Coast books, and a few Product-Identity-only
monsters (beholder, mind flayer, etc.) are deliberately excluded. Proprietary
setting content would need to come from your own homebrew imports.
