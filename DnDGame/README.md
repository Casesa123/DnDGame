# Ledgerhall — a self-hosted D&D 5e platform

A full slice of a virtual tabletop for running real D&D 5e campaigns with
friends: a complete SRD-scope rules engine (all 9 races, all 12 classes,
220 spells, 124 monsters, 120 weapons/armor/items), a leveling/multiclass
character builder, and a live multiplayer game session (map/tokens,
initiative, dice, chat, server-resolved combat, DM/Player modes, and mesh
voice/video with screen share) — all running from a single Node server you
control. Characters and session state persist to disk, so restarting the
server doesn't wipe a campaign in progress.

## Run it locally

```
cd server
npm install
npm start
```

Then open **http://localhost:3000**. To test multiplayer features, open a
second browser tab/window and join the same Session ID — one as Player, one
as Dungeon Master.

## Host it for your actual group (not just your wifi)

The server binds to `0.0.0.0` by default, so anyone on your **local network**
can already join by using your machine's LAN IP (e.g. `http://192.168.1.23:3000`)
instead of `localhost`. For friends who aren't on your network, you have two
practical options:

**Quick/temporary — a tunnel.** Run a tool like `ngrok http 3000` or a
Cloudflare Tunnel and share the URL it gives you. Good for a one-off session,
free, no server rental, and gives you HTTPS automatically (see below for why
that matters).

**Permanent — a small VPS + Docker.** This repo includes a `Dockerfile` and
`docker-compose.yml`:

```
cp .env.example .env   # fill in DOMAIN, ALLOWED_ORIGIN, TURN_* — see below
docker compose up -d
```

This starts the app plus a Caddy reverse proxy that gets you **free automatic
HTTPS** once you point a domain's DNS A record at your server. Point `DOMAIN`
in `.env` at that domain. (I wasn't able to test the actual `docker build` in
the sandboxed environment this was built in — no Docker daemon available —
but it follows the standard Node/Express container pattern.)

**Why HTTPS matters here:** browsers block camera/mic access (`getUserMedia`)
on plain HTTP for anyone except `localhost`. Voice/video simply won't work
for remote players without it.

**Why you probably need a TURN server:** STUN (used for local-network peer
discovery) often isn't enough for two players behind different home
routers/CGNAT to connect their video directly to each other. A TURN relay
is what actually gets voice/video working across the internet. Set
`TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` (comma-separate multiple
URLs) to your own TURN server for a permanent setup — self-host `coturn` or
use a provider like Twilio, Metered, or Xirsys. If you leave these unset,
the app falls back to the Open Relay Project's public demo TURN server, which
works but is unauthenticated, rate-limited, and not something to depend on
for a real weekly campaign.

Other environment variables: `PORT` (default 3000), `HOST` (default
`0.0.0.0`), `ALLOWED_ORIGIN` (CORS origin lock-down, default `*`).

## What's actually implemented right now

- **Rules engine** (`server/rules-engine/`): JSON content packs for
  **13 race/subrace entries** (all 9 core PHB races), **12 classes** (full
  level 1-20 feature progression, ASI levels, one subclass each with its own
  feature levels), **220 spells** across all 8 casting classes and levels
  0-9, **124 monsters** spanning CR 0-24, and **120 items** (full weapon and
  armor lists, adventuring gear, curated magic items). All original wording
  (SRD-scope mechanics, not copied WotC text — see the legal note below).
- **Character builder**: pick a race, one or more classes with individual
  levels (multiclassing), a subclass once you hit the right level, ability
  scores, equipped armor/shield, and prepared/known spells per spellcasting
  class. The server computes HP (correct 5e first-level-max / average-per-level
  math per class), AC (from equipped armor or unarmored), saving throws,
  proficiency bonus, spell slots (including the proper multiclass shared
  slot table and separate Warlock pact magic), and resolves Ability Score
  Improvements (defaults to +2 primary ability; pass explicit choices if you
  want). "Save character" persists it to `server/data/characters.json`.
- **Compendium tab**: searchable, filterable browser across every race,
  class, spell, monster, and item currently loaded (core + any homebrew) —
  filter spells by level/class, monsters by type, items by category.
- **Live session** (Socket.io): a Session ID puts you in a room. Map token
  placement/movement, initiative, dice, chat, and combat sync in real time.
  Session state (tokens/HP, logs, DM notes) is debounce-saved to
  `server/data/sessions/<id>.json` and reloaded on the next join — a server
  restart doesn't lose an in-progress game. Empty rooms are evicted from
  memory (not disk) after 10 minutes.
- **Player vs. Dungeon Master mode**: pick your role when joining a session.
  - *Everyone*: bring a saved character in as a token (HP/AC/attack bonus
    computed server-side), drop monster tokens from the bestiary, roll dice,
    chat, use "Attack mode" to click an attacker then a target and resolve a
    server-authoritative attack roll (so nobody can fake damage).
  - *DM-only*: a DM Tools panel showing every monster token with **Hide**
    (removes it from players' view entirely, e.g. prepping an ambush) and
    **Reveal HP** (monster HP defaults to a coarse status word — Healthy/
    Injured/Bloodied/Critical/Down — for players until you reveal exact
    numbers) toggles; a **Party panel** to view any player's full saved
    character sheet; **private DM notes**; and **secret dice rolls** (only
    you see the result). All of this is enforced server-side — the gating
    isn't just hidden in the UI, players' sockets are never sent the true
    data for hidden/masked tokens.
- **Voice & video**: mesh WebRTC (every participant connects directly to
  every other). Mute/camera toggles and screen share (for the DM to show a
  map or handout) are built in. ICE servers (STUN + TURN) are fetched from
  the server so you can configure TURN once for everyone. Mesh is
  intentionally simple and fine for a typical table (DM + 4-6 players); see
  "Next steps" for scaling further.
- **Homebrew import**: paste a JSON pack with any of `races`/`classes`/
  `spells`/`monsters`/`items`. Entries are namespaced (`hb:<pack>:<id>`) so
  they never collide with core content, and immediately show up everywhere
  (character builder, compendium, monster/item pickers).

## What's simplified or not yet built

- **Combat is one generic attack action**, not full 5e weapon/spell-attack
  rules: PC attack bonus is proficiency + best of Str/Dex against a generic
  1d8 weapon (equip a real weapon from the compendium and it still won't
  change your attack math yet); no spell attacks/saves, no reactions,
  no conditions tracking. Monster attacks are parsed from their stat block
  text.
- **No accounts/auth** — identity is a per-browser random id in
  `localStorage` plus a typed display name and a self-declared Player/DM
  role. This is a trust model suited to a private group of friends, not a
  public server: anyone with the Session ID can join, and role/token
  ownership aren't cryptographically enforced.
- **Persistence is JSON files on disk**, not a real database — correct and
  durable for one server running one campaign at a time, not for scaling to
  many concurrent tables across multiple server instances.
- **No map backgrounds/images, fog of war on the grid itself, or
  grid-square distance rules** — the hidden-token DM tool covers "the
  players don't know this monster is here yet," but there's no
  line-of-sight or vision system.
- **Mesh WebRTC** won't hold up much past a full table (DM + 4-6 players);
  see "Next steps."

## Next steps, roughly in order

1. **Real weapon/spell attacks** — wire equipped weapons and known spells
   into the attack/damage math instead of the current simplified generic
   attack, add saving-throw spells, conditions, and reactions.
2. **A real database** — swap the JSON-file store (`server/data-store.js`)
   for Postgres if/when you need multi-instance deployment or many
   concurrent campaigns.
3. **Scale the video call** — replace mesh WebRTC with an SFU (mediasoup is
   the natural choice given the Node/Socket.io stack already in use) once
   you need tables larger than ~4-6 people, or want recording.
4. **Maps** — background images, fog of war, grid distance/measurement.
5. **Accounts** — real auth would let a character/session be tied to a user
   rather than a per-browser random id, and let token/role actions be
   properly enforced rather than trust-based.
6. **Homebrew UX** — homebrew import is still raw JSON; a form-based builder
   (like the character builder) would make it usable by non-technical
   players.

## Legal note on content

"Full D&D" content is bounded by Wizards of the Coast's IP. The SRD (System
Reference Document) is released under an open license and covers core
mechanics plus a very wide set of races, classes, spells, monsters, and
equipment — that's the foundation this entire dataset is built on, with
original wording throughout (not copied book text). A handful of specific
Product-Identity-only creatures (beholder, mind flayer, displacer beast, and
a few others) are deliberately excluded. Proprietary setting content (named
NPCs, specific published adventures, Forgotten Realms lore, etc.) isn't
included and would need to come from your own homebrew imports.
