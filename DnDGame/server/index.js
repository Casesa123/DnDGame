const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { buildContentStore, saveHomebrewPack, CATEGORIES } = require("./rules-engine/loader");
const { buildCharacter } = require("./rules-engine/characterBuilder");
const dataStore = require("./data-store");
const combat = require("./combat");

// ---------- Deployment config (env-configurable for real hosting) ----------

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
// "*" (default) is fine for a quick local/LAN game with friends; set
// ALLOWED_ORIGIN to your real domain once you host this somewhere permanent.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// STUN alone often isn't enough for two players behind different home
// routers/CGNAT to connect directly -- a TURN relay is usually what makes
// voice/video actually work "over the internet" rather than only on one
// LAN. Set TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL for your own TURN server
// in production. The fallback below is the Open Relay Project's public demo
// TURN server -- free, but unauthenticated, rate-limited, and not something
// to depend on for a real campaign.
const TURN_URLS = process.env.TURN_URLS ? process.env.TURN_URLS.split(",").map((s) => s.trim()) : [
  "turn:openrelay.metered.ca:80",
  "turn:openrelay.metered.ca:443",
  "turn:openrelay.metered.ca:443?transport=tcp",
];
const TURN_USERNAME = process.env.TURN_USERNAME || "openrelayproject";
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || "openrelayproject";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

let contentStore = buildContentStore();

// ---------- REST API ----------

app.get("/api/content", (req, res) => {
  res.json(contentStore);
});

app.get("/api/ice-servers", (req, res) => {
  res.json({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
    ],
  });
});

app.post("/api/homebrew", (req, res) => {
  const { packName, races, classes, spells, monsters, items } = req.body || {};
  if (!packName || !packName.trim()) {
    return res.status(400).json({ ok: false, error: "packName is required." });
  }
  const pack = {
    races: races || {},
    classes: classes || {},
    spells: spells || {},
    monsters: monsters || {},
    items: items || {},
  };
  const totalEntries = CATEGORIES.reduce((sum, cat) => sum + Object.keys(pack[cat]).length, 0);
  if (totalEntries === 0) {
    return res.status(400).json({ ok: false, error: "Homebrew pack contained no races, classes, spells, monsters, or items." });
  }
  const savedName = saveHomebrewPack(packName, pack);
  contentStore = buildContentStore();
  res.json({ ok: true, packName: savedName, content: contentStore });
});

app.post("/api/characters/validate", (req, res) => {
  const result = buildCharacter(req.body || {}, contentStore);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ---------- Accounts (optional; lightweight token auth) ----------
// Passwords are salted+hashed with scrypt. A login issues an opaque bearer
// token held in memory (tokens don't survive a restart -- users just log in
// again). This is deliberately simple: enough to tie characters to a person
// and enforce ownership, not a hardened public auth system.
const authTokens = new Map(); // token -> username

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}
function issueToken(username) {
  const token = crypto.randomBytes(24).toString("hex");
  authTokens.set(token, username);
  return token;
}
function userFromReq(req) {
  const auth = req.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return authTokens.get(token) || null;
}

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};
  const name = (username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(name)) return res.status(400).json({ ok: false, error: "Username must be 3-20 chars: letters, numbers, underscore." });
  if (!password || password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
  if (await dataStore.getUser(name)) return res.status(400).json({ ok: false, error: "That username is taken." });
  const { salt, hash } = hashPassword(password);
  await dataStore.saveUser({ username: name, salt, hash, createdAt: Date.now() });
  res.json({ ok: true, username: name, token: issueToken(name) });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const name = (username || "").trim().toLowerCase();
  const user = await dataStore.getUser(name);
  if (!user || !verifyPassword(password || "", user.salt, user.hash)) {
    return res.status(401).json({ ok: false, error: "Wrong username or password." });
  }
  res.json({ ok: true, username: name, token: issueToken(name) });
});

// ---------- Saved characters (persisted; owner-scoped when logged in) ----------

app.get("/api/characters", async (req, res) => {
  const user = userFromReq(req);
  const all = await dataStore.loadCharacters();
  // Logged-in users see their own characters plus any legacy un-owned ones;
  // anonymous users see only the un-owned pool. Keeps single-group use simple
  // while giving real per-user separation once accounts are in play.
  const filtered = {};
  for (const [id, c] of Object.entries(all)) {
    if (!c.ownerUser || (user && c.ownerUser === user)) filtered[id] = c;
  }
  res.json(filtered);
});

app.post("/api/characters", async (req, res) => {
  const { character } = req.body || {};
  if (!character || typeof character !== "object" || !character.name || !character.name.trim()) {
    return res.status(400).json({ ok: false, error: "A character object with a name is required." });
  }
  const user = userFromReq(req);
  if (character.id) {
    const existing = (await dataStore.loadCharacters())[character.id];
    if (existing && existing.ownerUser && existing.ownerUser !== user) {
      return res.status(403).json({ ok: false, error: "That character belongs to another account." });
    }
  }
  const saved = await dataStore.saveCharacter({ ...character, ownerUser: user || character.ownerUser || null });
  res.json({ ok: true, character: saved });
});

app.delete("/api/characters/:id", async (req, res) => {
  const user = userFromReq(req);
  const existing = (await dataStore.loadCharacters())[req.params.id];
  if (existing && existing.ownerUser && existing.ownerUser !== user) {
    return res.status(403).json({ ok: false, error: "That character belongs to another account." });
  }
  const removed = await dataStore.deleteCharacter(req.params.id);
  res.json({ ok: removed });
});

app.use(express.static(path.join(__dirname, "..", "client")));

// ---------- Realtime session server ----------

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGIN } });

// In-memory per-room game state, backed by data-store.js so it survives a
// server restart. Rooms with nobody in them get evicted from memory after a
// grace period (the on-disk copy remains and is reloaded on the next join).
const sessions = new Map();
const emptyRoomTimers = new Map();
const ROOM_CLEANUP_DELAY_MS = 10 * 60 * 1000;

function getOrCreateSession(sessionId) {
  clearTimeout(emptyRoomTimers.get(sessionId));
  emptyRoomTimers.delete(sessionId);

  if (!sessions.has(sessionId)) {
    const persisted = dataStore.loadSession(sessionId);
    sessions.set(sessionId, {
      tokens: (persisted && persisted.tokens) || {},
      initiative: (persisted && persisted.initiative) || [],
      chatLog: (persisted && persisted.chatLog) || [],
      diceLog: (persisted && persisted.diceLog) || [],
      combatLog: (persisted && persisted.combatLog) || [],
      dmNotes: (persisted && persisted.dmNotes) || [],
      map: (persisted && persisted.map) || { background: "", fogEnabled: false, revealed: {} },
      members: {},
    });
  }
  return sessions.get(sessionId);
}

// Logical map grid dimensions -- token coordinates and fog cells are stored
// as fractions/indices against this, so they line up across screen sizes.
const GRID_N = 20;

function tokenCell(token) {
  const c = Math.min(GRID_N - 1, Math.max(0, Math.floor((token.fx ?? 0.5) * GRID_N)));
  const r = Math.min(GRID_N - 1, Math.max(0, Math.floor((token.fy ?? 0.5) * GRID_N)));
  return `${c},${r}`;
}

function persistSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) dataStore.saveSessionDebounced(sessionId, session);
}

function scheduleRoomCleanup(sessionId) {
  clearTimeout(emptyRoomTimers.get(sessionId));
  const timer = setTimeout(() => {
    emptyRoomTimers.delete(sessionId);
    const session = sessions.get(sessionId);
    if (session && Object.keys(session.members).length === 0) {
      sessions.delete(sessionId);
    }
  }, ROOM_CLEANUP_DELAY_MS);
  emptyRoomTimers.set(sessionId, timer);
}

const TOKEN_COLORS = ["#C1521F", "#3E7C59", "#3568A8", "#A8342A", "#8A5FB0", "#B08A2E"];

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function playersRoom(sessionId) {
  return `${sessionId}:players`;
}
function dmRoom(sessionId) {
  return `${sessionId}:dm`;
}

// A DM can hide a monster token entirely (prepping an ambush) or just hide
// its exact HP (players see a coarse status instead). PC tokens are always
// shown in full to everyone -- only monster tokens can be gated.
function isTokenGated(token) {
  return token.kind === "monster" && (token.hidden || token.revealHp === false);
}

// With fog of war on, non-PC tokens sitting on an unrevealed cell are hidden
// from players entirely (the party can always see their own PCs).
function isTokenFogHidden(session, token) {
  if (!session.map || !session.map.fogEnabled) return false;
  if (token.kind === "pc") return false;
  return !session.map.revealed[tokenCell(token)];
}

function hpStatusLabel(hp, maxHp) {
  if (hp <= 0) return "Down";
  const pct = maxHp > 0 ? hp / maxHp : 0;
  if (pct > 0.75) return "Healthy";
  if (pct > 0.5) return "Injured";
  if (pct > 0.25) return "Bloodied";
  return "Critical";
}

// Strip DM-only internals (exact HP, attack bonuses, saves, spell slots)
// from a monster the players can see but shouldn't have full numbers for.
function redactToken(token) {
  const { hp, maxHp, attacks, saves, slots, pactSlots, ...rest } = token;
  return { ...rest, hp: null, maxHp: null, hpStatus: hpStatusLabel(hp, maxHp) };
}

// Broadcasts a token's current state to the right audience: full truth to
// everyone if it isn't gated, otherwise full truth to the DM room only and
// a redacted (or entirely absent) view to the players room.
function broadcastToken(sessionId, token) {
  const session = sessions.get(sessionId);
  const fogHidden = session && isTokenFogHidden(session, token);
  if (!isTokenGated(token) && !fogHidden) {
    io.to(dmRoom(sessionId)).emit("token-upsert", token);
    io.to(playersRoom(sessionId)).emit("token-upsert", token);
    return;
  }
  io.to(dmRoom(sessionId)).emit("token-upsert", token);
  if (token.hidden || fogHidden) {
    io.to(playersRoom(sessionId)).emit("token-remove", { id: token.id });
  } else {
    io.to(playersRoom(sessionId)).emit("token-upsert", redactToken(token));
  }
}

function sessionStateForRole(session, role) {
  const tokens = {};
  for (const [id, token] of Object.entries(session.tokens)) {
    if (role === "dm") {
      tokens[id] = token;
    } else if (!token.hidden && !isTokenFogHidden(session, token)) {
      tokens[id] = isTokenGated(token) ? redactToken(token) : token;
    }
  }
  return {
    tokens,
    initiative: session.initiative,
    chatLog: session.chatLog,
    diceLog: role === "dm" ? session.diceLog : session.diceLog.filter((d) => !d.secret),
    combatLog: session.combatLog,
    dmNotes: role === "dm" ? session.dmNotes : undefined,
    map: session.map,
    members: session.members,
  };
}

io.on("connection", (socket) => {
  let currentSessionId = null;
  let currentRole = "player";
  let currentClientId = null;

  // Who may move/edit/remove a token:
  //  - DM can touch anything.
  //  - a PC token: only the browser that owns it.
  //  - a monster/NPC token: only the DM or whoever placed it (players can't
  //    push the DM's monsters around).
  //  - a plain marker: anyone (they're lightweight shared annotations).
  const canEditToken = (token) => {
    if (currentRole === "dm") return true;
    if (token.kind === "pc") return token.ownerClientId === currentClientId;
    if (token.kind === "monster") return token.placedByClientId === currentClientId;
    return true;
  };

  socket.on("join-session", ({ sessionId, userName, clientId, role } = {}) => {
    if (!sessionId || typeof sessionId !== "string") return;
    currentSessionId = sessionId;
    currentRole = role === "dm" ? "dm" : "player";
    currentClientId = clientId || null;
    socket.join(sessionId);
    socket.join(currentRole === "dm" ? dmRoom(sessionId) : playersRoom(sessionId));

    const session = getOrCreateSession(sessionId);
    const safeUserName = (userName || "Adventurer").toString().slice(0, 40);
    session.members[socket.id] = { userName: safeUserName, clientId: clientId || null, role: currentRole };

    socket.emit("session-state", sessionStateForRole(session, currentRole));
    socket.to(sessionId).emit("member-joined", { socketId: socket.id, userName: safeUserName, role: currentRole });
    io.to(sessionId).emit("member-list", session.members);
  });

  socket.on("token-upsert", (token) => {
    if (!currentSessionId || !token || typeof token.id !== "string") return;
    // Coordinates are stored as fractions (0..1) of the map so they line up
    // across different screen sizes; accept legacy px only as a fallback.
    if (!isFiniteNumber(token.fx) || !isFiniteNumber(token.fy)) {
      if (!isFiniteNumber(token.x) || !isFiniteNumber(token.y)) return;
    }
    const session = getOrCreateSession(currentSessionId);
    const existing = session.tokens[token.id];
    // Only the owner/DM may move an existing owned token. New markers are
    // created freely (kind defaults to marker on the client).
    if (existing && !canEditToken(existing)) return;
    // Preserve server-authoritative combat state and DM gating flags across
    // plain moves (the client only echoes position/label for those).
    const merged = existing
      ? {
          ...existing,
          fx: isFiniteNumber(token.fx) ? token.fx : existing.fx,
          fy: isFiniteNumber(token.fy) ? token.fy : existing.fy,
          label: token.label ?? existing.label,
          color: token.color ?? existing.color,
        }
      : token;
    session.tokens[token.id] = merged;
    broadcastToken(currentSessionId, merged);
    persistSession(currentSessionId);
  });

  socket.on("token-remove", ({ id } = {}) => {
    if (!currentSessionId || typeof id !== "string") return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[id];
    if (token && !canEditToken(token)) return;
    delete session.tokens[id];
    io.to(currentSessionId).emit("token-remove", { id });
    persistSession(currentSessionId);
  });

  // Adds/updates the caller's own PC token, computed server-side from their
  // saved character sheet so HP/AC/attacks/saves/slots are trustworthy.
  socket.on("add-pc-token", ({ clientId, character, fx, fy } = {}) => {
    if (!currentSessionId || !clientId || !character || !character.name) return;
    const session = getOrCreateSession(currentSessionId);
    const id = `pc-${clientId}`;
    const existing = session.tokens[id];
    const pcCombat = combat.buildPcCombat(character, contentStore);
    const token = {
      id,
      kind: "pc",
      fx: isFiniteNumber(fx) ? fx : existing ? existing.fx : 0.15,
      fy: isFiniteNumber(fy) ? fy : existing ? existing.fy : 0.15,
      label: character.name.trim().slice(0, 2).toUpperCase(),
      name: character.name.trim().slice(0, 60),
      color: (existing && existing.color) || TOKEN_COLORS[Math.floor(Math.random() * TOKEN_COLORS.length)],
      characterId: character.id || null,
      ownerClientId: clientId,
      charLevel: character.level || 1,
      hp: existing && isFiniteNumber(existing.hp) ? existing.hp : isFiniteNumber(character.currentHp) ? character.currentHp : character.maxHp,
      maxHp: character.maxHp,
      ac: character.armorClass,
      conditions: (existing && existing.conditions) || [],
      attacks: pcCombat.attacks,
      saves: pcCombat.saves,
      slots: pcCombat.slots,
      slotsUsed: (existing && existing.slotsUsed) || (pcCombat.slots ? pcCombat.slots.map(() => 0) : null),
      pactSlots: pcCombat.pactSlots,
      pactUsed: (existing && existing.pactUsed) || 0,
    };
    session.tokens[id] = token;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // DM/anyone adds a monster token from the bestiary. HP defaults to the flat
  // average of its hit dice (the standard "fixed HP" used for consistency);
  // pass roll:true to roll the dice for variance instead. Monster HP starts
  // hidden from players by default -- the DM reveals it explicitly.
  socket.on("add-monster-token", ({ monsterId, fx, fy, roll } = {}) => {
    if (!currentSessionId || typeof monsterId !== "string") return;
    const monster = contentStore.monsters[monsterId];
    if (!monster) return;
    const session = getOrCreateSession(currentSessionId);
    const id = `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const hp = roll ? rollHitDice(monster.hitDice) : averageHitDice(monster.hitDice);
    const monCombat = combat.buildMonsterCombat(monster);
    const token = {
      id,
      kind: "monster",
      placedByClientId: currentClientId,
      fx: isFiniteNumber(fx) ? fx : 0.55,
      fy: isFiniteNumber(fy) ? fy : 0.15,
      label: monster.name.slice(0, 2).toUpperCase(),
      name: monster.name,
      color: "#6B5E45",
      monsterId,
      hp,
      maxHp: hp,
      ac: monster.ac,
      conditions: [],
      attacks: monCombat.attacks,
      saves: monCombat.saves,
      hidden: false,
      revealHp: false,
    };
    session.tokens[id] = token;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // Resolves a chosen attack/spell from the attacker's option list against a
  // target. Everything (rolls, saves, damage, healing, slot spend) happens
  // here server-side so results are consistent and un-fakeable.
  socket.on("attack-roll", ({ attackerTokenId, targetTokenId, attackIndex = 0, slotLevel } = {}) => {
    if (!currentSessionId) return;
    const session = getOrCreateSession(currentSessionId);
    const attacker = session.tokens[attackerTokenId];
    const target = session.tokens[targetTokenId];
    if (!attacker || !target) return;
    // A downed/dead combatant (0 HP) can't take actions.
    if (typeof attacker.hp === "number" && attacker.hp <= 0) {
      socket.emit("attack-result", { at: Date.now(), attackerName: attacker.name || attacker.label, targetName: target.name || target.label, kind: "downed", attackName: "", note: `${attacker.name || attacker.label} is down and can't act.` });
      return;
    }
    const action = (attacker.attacks || [])[attackIndex];
    if (!action) return;
    if (typeof target.hp !== "number") return;

    // Spending a leveled spell slot (cantrips and weapons are free).
    if (action.spellLevel > 0) {
      const useLevel = Math.max(action.spellLevel, Number(slotLevel) || action.spellLevel);
      if (!spendSpellSlot(attacker, useLevel)) {
        socket.emit("attack-result", { at: Date.now(), attackerName: attacker.name, targetName: target.name || target.label, kind: "no-slot", attackName: action.name, note: `No level ${useLevel} slot available.` });
        return;
      }
      action._slotLevel = useLevel;
    }

    const result = combat.resolveAction(attacker, target, action, { slotLevel: action._slotLevel });

    if (result.kind === "heal" && result.heal) {
      target.hp = Math.min(target.maxHp || target.hp, target.hp + result.heal.total);
      session.tokens[targetTokenId] = target;
    } else if (result.damage && result.damage.total > 0 && (result.hit || result.kind === "save" || result.kind === "auto")) {
      target.hp = Math.max(0, target.hp - result.damage.total);
      session.tokens[targetTokenId] = target;
    }

    const entry = {
      at: Date.now(),
      attackerName: attacker.name || attacker.label,
      targetName: target.name || target.label,
      slotLevel: action._slotLevel,
      ...result,
    };
    delete action._slotLevel;
    session.combatLog.push(entry);
    session.combatLog = session.combatLog.slice(-50);

    io.to(currentSessionId).emit("attack-result", entry);
    broadcastToken(currentSessionId, target);
    if (action.spellLevel > 0) broadcastToken(currentSessionId, attacker); // slot count changed
    persistSession(currentSessionId);
  });

  // ---- Conditions ----
  socket.on("token-set-conditions", ({ tokenId, conditions } = {}) => {
    if (!currentSessionId || typeof tokenId !== "string" || !Array.isArray(conditions)) return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[tokenId];
    if (!token || !canEditToken(token)) return;
    token.conditions = conditions.slice(0, 15).map((c) => String(c).slice(0, 20));
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // Manual HP set (owner of a PC token, or the DM). Handy for out-of-combat
  // healing, temp HP, or DM adjudication.
  socket.on("token-set-hp", ({ tokenId, hp } = {}) => {
    if (!currentSessionId || typeof tokenId !== "string" || !isFiniteNumber(hp)) return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[tokenId];
    if (!token || !canEditToken(token)) return;
    token.hp = Math.max(0, Math.min(token.maxHp || hp, Math.floor(hp)));
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // Restore all spell slots / reset (a "long rest") for a PC token.
  socket.on("token-long-rest", ({ tokenId } = {}) => {
    if (!currentSessionId || typeof tokenId !== "string") return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[tokenId];
    if (!token || token.kind !== "pc" || !canEditToken(token)) return;
    if (token.slotsUsed) token.slotsUsed = token.slotsUsed.map(() => 0);
    token.pactUsed = 0;
    token.hp = token.maxHp;
    token.conditions = [];
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // ---- Map / fog of war (DM controls the map, everyone sees it) ----
  socket.on("map-set-background", ({ url } = {}) => {
    if (!currentSessionId || currentRole !== "dm") return;
    const session = getOrCreateSession(currentSessionId);
    session.map.background = typeof url === "string" ? url.slice(0, 2000) : "";
    io.to(currentSessionId).emit("map-update", session.map);
    persistSession(currentSessionId);
  });

  socket.on("map-toggle-fog", () => {
    if (!currentSessionId || currentRole !== "dm") return;
    const session = getOrCreateSession(currentSessionId);
    session.map.fogEnabled = !session.map.fogEnabled;
    io.to(currentSessionId).emit("map-update", session.map);
    resendAllTokens(currentSessionId);
    persistSession(currentSessionId);
  });

  socket.on("map-reveal-cell", ({ cell, revealed } = {}) => {
    if (!currentSessionId || currentRole !== "dm" || typeof cell !== "string") return;
    const session = getOrCreateSession(currentSessionId);
    if (revealed) session.map.revealed[cell] = true;
    else delete session.map.revealed[cell];
    io.to(currentSessionId).emit("map-update", session.map);
    resendAllTokens(currentSessionId);
    persistSession(currentSessionId);
  });

  socket.on("map-reveal-all", ({ revealed } = {}) => {
    if (!currentSessionId || currentRole !== "dm") return;
    const session = getOrCreateSession(currentSessionId);
    session.map.revealed = {};
    if (revealed) {
      for (let c = 0; c < GRID_N; c++) for (let r = 0; r < GRID_N; r++) session.map.revealed[`${c},${r}`] = true;
    }
    io.to(currentSessionId).emit("map-update", session.map);
    resendAllTokens(currentSessionId);
    persistSession(currentSessionId);
  });

  // ---- DM-only tools ----
  socket.on("dm-toggle-hidden", ({ tokenId } = {}) => {
    if (!currentSessionId || currentRole !== "dm") return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[tokenId];
    if (!token || token.kind !== "monster") return;
    token.hidden = !token.hidden;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  socket.on("dm-toggle-hp-reveal", ({ tokenId } = {}) => {
    if (!currentSessionId || currentRole !== "dm") return;
    const session = getOrCreateSession(currentSessionId);
    const token = session.tokens[tokenId];
    if (!token || token.kind !== "monster") return;
    token.revealHp = !token.revealHp;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  socket.on("dm-note", ({ text } = {}) => {
    if (!currentSessionId || currentRole !== "dm" || typeof text !== "string") return;
    const trimmed = text.trim().slice(0, 1000);
    if (!trimmed) return;
    const session = getOrCreateSession(currentSessionId);
    const entry = { text: trimmed, at: Date.now() };
    session.dmNotes.push(entry);
    session.dmNotes = session.dmNotes.slice(-100);
    io.to(dmRoom(currentSessionId)).emit("dm-note", entry);
    persistSession(currentSessionId);
  });

  socket.on("initiative-update", (order) => {
    if (!currentSessionId || !Array.isArray(order)) return;
    const session = getOrCreateSession(currentSessionId);
    session.initiative = order.slice(0, 50);
    io.to(currentSessionId).emit("initiative-update", session.initiative);
    persistSession(currentSessionId);
  });

  socket.on("dice-roll", (roll) => {
    if (!currentSessionId || !roll || typeof roll.formula !== "string" || !Array.isArray(roll.rolls)) return;
    const session = getOrCreateSession(currentSessionId);
    const secret = !!roll.secret && currentRole === "dm";
    const entry = {
      formula: roll.formula.slice(0, 40),
      rolls: roll.rolls.slice(0, 100).map(Number),
      modifier: Number(roll.modifier) || 0,
      total: Number(roll.total) || 0,
      roller: (roll.roller || "Someone").toString().slice(0, 40),
      secret,
      at: Date.now(),
    };
    session.diceLog.push(entry);
    session.diceLog = session.diceLog.slice(-50);
    io.to(secret ? dmRoom(currentSessionId) : currentSessionId).emit("dice-roll", entry);
    persistSession(currentSessionId);
  });

  socket.on("chat-message", (msg) => {
    if (!currentSessionId || !msg || typeof msg.text !== "string") return;
    const text = msg.text.trim().slice(0, 500);
    if (!text) return;
    const session = getOrCreateSession(currentSessionId);
    const entry = { text, from: (msg.from || "Someone").toString().slice(0, 40), at: Date.now() };
    session.chatLog.push(entry);
    session.chatLog = session.chatLog.slice(-100);
    io.to(currentSessionId).emit("chat-message", entry);
    persistSession(currentSessionId);
  });

  // ---- WebRTC signaling relay (mesh topology) ----
  socket.on("webrtc-signal", ({ to, signal } = {}) => {
    if (typeof to !== "string" || !signal) return;
    io.to(to).emit("webrtc-signal", { from: socket.id, signal });
  });

  socket.on("disconnect", () => {
    if (!currentSessionId) return;
    const session = sessions.get(currentSessionId);
    if (session) {
      delete session.members[socket.id];
      io.to(currentSessionId).emit("member-left", { socketId: socket.id });
      io.to(currentSessionId).emit("member-list", session.members);
      if (Object.keys(session.members).length === 0) {
        scheduleRoomCleanup(currentSessionId);
      }
    }
  });
});

// Consumes one spell slot of at least `level` from a PC token, preferring the
// exact level and otherwise the lowest available higher slot. Pact slots are
// tried if a warlock has no matching shared slot. Returns true on success.
function spendSpellSlot(token, level) {
  if (token.slots && token.slotsUsed) {
    for (let lvl = level; lvl <= 9; lvl++) {
      const idx = lvl - 1;
      if ((token.slots[idx] || 0) - (token.slotsUsed[idx] || 0) > 0) {
        token.slotsUsed[idx] = (token.slotsUsed[idx] || 0) + 1;
        return true;
      }
    }
  }
  if (token.pactSlots && token.pactSlots.level >= level) {
    if ((token.pactSlots.slots || 0) - (token.pactUsed || 0) > 0) {
      token.pactUsed = (token.pactUsed || 0) + 1;
      return true;
    }
  }
  return false;
}

// Re-broadcasts every token in a room to the correct audiences. Used after a
// fog change so players gain/lose visibility of tokens as cells flip.
function resendAllTokens(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  for (const token of Object.values(session.tokens)) broadcastToken(sessionId, token);
}

function rollHitDice(hitDiceNotation) {
  const m = /(\d+)d(\d+)\s*([+-]\d+)?/i.exec(hitDiceNotation || "");
  if (!m) return 10;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  let total = mod;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  return Math.max(1, total);
}

// The "fixed" / average HP shown on a 5e stat block: count * average die + mod.
function averageHitDice(hitDiceNotation) {
  const m = /(\d+)d(\d+)\s*([+-]\d+)?/i.exec(hitDiceNotation || "");
  if (!m) return 10;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  return Math.max(1, Math.floor(count * ((sides + 1) / 2)) + mod);
}

// Wait for storage to be ready (and, for Postgres, warm the session cache)
// before accepting connections, so a restart restores in-progress games.
dataStore
  .preload()
  .catch((err) => console.error("Storage preload failed:", err.message))
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`DnD platform server listening on http://${HOST}:${PORT} (reachable at your LAN/public IP on port ${PORT})`);
    });
  });
