// Storage selector + session-write debouncing. Picks the Postgres adapter
// when DATABASE_URL is set, otherwise the default JSON-file adapter.
//
// Characters and users are read/written through async methods (awaited in the
// REST handlers). Sessions are kept synchronous for the realtime hot path:
// the file adapter reads them straight off disk, and the Postgres adapter
// serves them from an in-memory cache that is primed at boot and kept warm on
// every write -- so getOrCreateSession() never has to await.
const usePg = !!process.env.DATABASE_URL;
const adapter = usePg ? require("./storage/pg-store") : require("./storage/file-store");

if (usePg) console.log("Storage: Postgres (DATABASE_URL set)");
else console.log("Storage: JSON files under server/data/");

const sessionCache = {}; // only used for the async (pg) adapter

async function preload() {
  await adapter.ready;
  if (usePg && adapter.loadAllSessions) {
    const all = await adapter.loadAllSessions();
    Object.assign(sessionCache, all);
  }
}

// ---------- Characters (async) ----------
const loadCharacters = async () => adapter.loadCharacters();
const saveCharacter = async (character) => adapter.saveCharacter(character);
const deleteCharacter = async (id) => adapter.deleteCharacter(id);

// ---------- Users (async) ----------
const loadUsers = async () => adapter.loadUsers();
const getUser = async (username) => adapter.getUser(username);
const saveUser = async (user) => adapter.saveUser(user);

// ---------- Sessions (sync read, debounced write) ----------
function loadSession(sessionId) {
  if (usePg) return sessionCache[sessionId] || null;
  return adapter.loadSession(sessionId);
}

const saveTimers = new Map();

// Debounced so a burst of token drags/dice rolls doesn't hammer storage.
function saveSessionDebounced(sessionId, sessionData) {
  clearTimeout(saveTimers.get(sessionId));
  const timer = setTimeout(() => {
    saveTimers.delete(sessionId);
    // members/socket presence is ephemeral -- only persist durable game state.
    const { members, ...durable } = sessionData;
    if (usePg) sessionCache[sessionId] = durable;
    Promise.resolve(adapter.writeSession(sessionId, durable)).catch((err) => console.error(`Failed to persist session "${sessionId}":`, err.message));
  }, 500);
  saveTimers.set(sessionId, timer);
}

module.exports = {
  ready: adapter.ready,
  preload,
  loadCharacters,
  saveCharacter,
  deleteCharacter,
  loadUsers,
  getUser,
  saveUser,
  loadSession,
  saveSessionDebounced,
};
