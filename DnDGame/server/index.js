const path = require("path");
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

// ---------- Saved characters (persisted to disk) ----------

app.get("/api/characters", (req, res) => {
  res.json(dataStore.loadCharacters());
});

app.post("/api/characters", (req, res) => {
  const { character } = req.body || {};
  if (!character || typeof character !== "object" || !character.name || !character.name.trim()) {
    return res.status(400).json({ ok: false, error: "A character object with a name is required." });
  }
  const saved = dataStore.saveCharacter(character);
  res.json({ ok: true, character: saved });
});

app.delete("/api/characters/:id", (req, res) => {
  const removed = dataStore.deleteCharacter(req.params.id);
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
      members: {},
    });
  }
  return sessions.get(sessionId);
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

function hpStatusLabel(hp, maxHp) {
  if (hp <= 0) return "Down";
  const pct = maxHp > 0 ? hp / maxHp : 0;
  if (pct > 0.75) return "Healthy";
  if (pct > 0.5) return "Injured";
  if (pct > 0.25) return "Bloodied";
  return "Critical";
}

function redactToken(token) {
  return { ...token, hp: null, maxHp: null, hpStatus: hpStatusLabel(token.hp, token.maxHp) };
}

// Broadcasts a token's current state to the right audience: full truth to
// everyone if it isn't gated, otherwise full truth to the DM room only and
// a redacted (or entirely absent) view to the players room.
function broadcastToken(sessionId, token) {
  if (!isTokenGated(token)) {
    io.to(sessionId).emit("token-upsert", token);
    return;
  }
  io.to(dmRoom(sessionId)).emit("token-upsert", token);
  if (token.hidden) {
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
    } else if (!token.hidden) {
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
    members: session.members,
  };
}

io.on("connection", (socket) => {
  let currentSessionId = null;
  let currentRole = "player";

  socket.on("join-session", ({ sessionId, userName, clientId, role } = {}) => {
    if (!sessionId || typeof sessionId !== "string") return;
    currentSessionId = sessionId;
    currentRole = role === "dm" ? "dm" : "player";
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
    if (!isFiniteNumber(token.x) || !isFiniteNumber(token.y)) return;
    const session = getOrCreateSession(currentSessionId);
    const existing = session.tokens[token.id];
    // Preserve DM-set gating flags across plain moves (client may not echo them back).
    const merged = existing ? { ...existing, ...token, hidden: token.hidden ?? existing.hidden, revealHp: token.revealHp ?? existing.revealHp } : token;
    session.tokens[token.id] = merged;
    broadcastToken(currentSessionId, merged);
    persistSession(currentSessionId);
  });

  socket.on("token-remove", ({ id } = {}) => {
    if (!currentSessionId || typeof id !== "string") return;
    const session = getOrCreateSession(currentSessionId);
    delete session.tokens[id];
    io.to(currentSessionId).emit("token-remove", { id });
    persistSession(currentSessionId);
  });

  // Adds/updates the caller's own PC token, computed server-side from their
  // saved character sheet so HP/AC/attack bonus are trustworthy for combat.
  socket.on("add-pc-token", ({ clientId, character, x, y } = {}) => {
    if (!currentSessionId || !clientId || !character || !character.name) return;
    const session = getOrCreateSession(currentSessionId);
    const id = `pc-${clientId}`;
    const token = {
      id,
      kind: "pc",
      x: isFiniteNumber(x) ? x : 60,
      y: isFiniteNumber(y) ? y : 60,
      label: character.name.trim().slice(0, 2).toUpperCase(),
      name: character.name.trim().slice(0, 60),
      color: TOKEN_COLORS[Math.floor(Math.random() * TOKEN_COLORS.length)],
      characterId: character.id || null,
      ownerClientId: clientId,
      hp: isFiniteNumber(character.currentHp) ? character.currentHp : character.maxHp,
      maxHp: character.maxHp,
      ac: character.armorClass,
      atk: combat.pcAttackProfile(character),
    };
    session.tokens[id] = token;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  // DM/anyone adds a monster token from the bestiary. Monster HP starts
  // hidden from players by default -- the DM reveals it explicitly.
  socket.on("add-monster-token", ({ monsterId, x, y } = {}) => {
    if (!currentSessionId || typeof monsterId !== "string") return;
    const monster = contentStore.monsters[monsterId];
    if (!monster) return;
    const session = getOrCreateSession(currentSessionId);
    const id = `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const hp = rollHitDice(monster.hitDice);
    const token = {
      id,
      kind: "monster",
      x: isFiniteNumber(x) ? x : 200,
      y: isFiniteNumber(y) ? y : 60,
      label: monster.name.slice(0, 2).toUpperCase(),
      name: monster.name,
      color: "#6B5E45",
      monsterId,
      hp,
      maxHp: hp,
      ac: monster.ac,
      atk: combat.parseMonsterAttack(monster),
      hidden: false,
      revealHp: false,
    };
    session.tokens[id] = token;
    broadcastToken(currentSessionId, token);
    persistSession(currentSessionId);
  });

  socket.on("attack-roll", ({ attackerTokenId, targetTokenId } = {}) => {
    if (!currentSessionId) return;
    const session = getOrCreateSession(currentSessionId);
    const attacker = session.tokens[attackerTokenId];
    const target = session.tokens[targetTokenId];
    if (!attacker || !target || attackerTokenId === targetTokenId) return;
    if (typeof target.hp !== "number") return;

    const result = combat.resolveAttack(attacker, target);
    if (result.hit && result.damage) {
      target.hp = Math.max(0, target.hp - result.damage.total);
      session.tokens[targetTokenId] = target;
    }

    const entry = {
      at: Date.now(),
      attackerName: attacker.name || attacker.label,
      targetName: target.name || target.label,
      ...result,
    };
    session.combatLog.push(entry);
    session.combatLog = session.combatLog.slice(-50);

    io.to(currentSessionId).emit("attack-result", entry);
    if (result.hit && result.damage) {
      broadcastToken(currentSessionId, target);
    }
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

server.listen(PORT, HOST, () => {
  console.log(`DnD platform server listening on http://${HOST}:${PORT} (reachable at your LAN/public IP on port ${PORT})`);
});
