// Default storage adapter: JSON files on local disk. Correct and durable for
// a single server running one or more campaigns. See pg-store.js for the
// optional Postgres adapter used when DATABASE_URL is set.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CHARACTERS_FILE = path.join(DATA_DIR, "characters.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
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

// ---------- Users ----------

function loadUsers() {
  ensureDataDirs();
  return readJsonSafe(USERS_FILE, {});
}

function getUser(username) {
  return loadUsers()[username] || null;
}

function saveUser(user) {
  ensureDataDirs();
  const all = loadUsers();
  all[user.username] = user;
  writeJsonAtomic(USERS_FILE, all);
  return user;
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

function writeSession(sessionId, durable) {
  ensureDataDirs();
  writeJsonAtomic(sessionFilePath(sessionId), durable);
}

module.exports = {
  loadCharacters,
  saveCharacter,
  deleteCharacter,
  loadUsers,
  getUser,
  saveUser,
  loadSession,
  writeSession,
  ready: Promise.resolve(),
};
