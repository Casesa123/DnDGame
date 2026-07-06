const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const CHARACTERS_FILE = path.join(DATA_DIR, "characters.json");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    return fallback;
  }
}

// Write-to-temp-then-rename so a crash mid-write can't corrupt the file.
function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// ---------- Characters ----------

function loadCharacters() {
  ensureDataDirs();
  return readJsonSafe(CHARACTERS_FILE, {});
}

function saveCharacter(character) {
  ensureDataDirs();
  const all = loadCharacters();
  const id = character.id || `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...character, id, savedAt: Date.now() };
  all[id] = record;
  writeJsonAtomic(CHARACTERS_FILE, all);
  return record;
}

function deleteCharacter(id) {
  const all = loadCharacters();
  if (!all[id]) return false;
  delete all[id];
  writeJsonAtomic(CHARACTERS_FILE, all);
  return true;
}

// ---------- Sessions ----------

function sessionFilePath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

function loadSession(sessionId) {
  ensureDataDirs();
  return readJsonSafe(sessionFilePath(sessionId), null);
}

const saveTimers = new Map();

// Debounced so a burst of token drags/dice rolls doesn't hammer the disk.
function saveSessionDebounced(sessionId, sessionData) {
  ensureDataDirs();
  clearTimeout(saveTimers.get(sessionId));
  const timer = setTimeout(() => {
    saveTimers.delete(sessionId);
    // members/socket presence is ephemeral -- only persist durable game state.
    const { members, ...durable } = sessionData;
    try {
      writeJsonAtomic(sessionFilePath(sessionId), durable);
    } catch (err) {
      console.error(`Failed to persist session "${sessionId}":`, err.message);
    }
  }, 500);
  saveTimers.set(sessionId, timer);
}

module.exports = {
  loadCharacters,
  saveCharacter,
  deleteCharacter,
  loadSession,
  saveSessionDebounced,
};
