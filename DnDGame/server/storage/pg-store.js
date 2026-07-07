// Optional Postgres storage adapter, used only when DATABASE_URL is set.
//
// NOTE: this follows the standard `pg` usage pattern but was NOT able to be
// run against a live Postgres in the environment it was written in -- treat
// it as a starting point and test it against your own database before
// relying on it for a real campaign. The default file-store.js is what's
// been exercised end-to-end.
//
// To use: `npm install pg`, set DATABASE_URL, and start the server. Tables
// are created automatically on first connect.
let pool = null;

function getPool() {
  if (!pool) {
    const { Pool } = require("pg"); // lazy require so the default path never needs pg installed
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : undefined });
  }
  return pool;
}

// Characters/sessions/users are stored as JSONB blobs keyed by id -- the app
// treats them as documents, so a document store shape maps cleanly and keeps
// this adapter simple.
const ready = (async () => {
  const p = getPool();
  await p.query(`CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
  await p.query(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data JSONB NOT NULL)`);
  await p.query(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
})().catch((err) => {
  console.error("Postgres init failed:", err.message);
});

// These loaders are async in the pg adapter; the file adapter is sync. The
// selector in data-store.js normalizes both to promises, and index.js awaits
// storage.ready at boot then uses the (already-cached) in-memory session map,
// so the sync/async difference doesn't leak into the hot path.
async function loadCharacters() {
  const { rows } = await getPool().query(`SELECT data FROM characters`);
  return Object.fromEntries(rows.map((r) => [r.data.id, r.data]));
}

async function saveCharacter(character) {
  const id = character.id || `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...character, id, savedAt: Date.now() };
  await getPool().query(`INSERT INTO characters (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`, [id, record]);
  return record;
}

async function deleteCharacter(id) {
  const res = await getPool().query(`DELETE FROM characters WHERE id = $1`, [id]);
  return res.rowCount > 0;
}

async function loadUsers() {
  const { rows } = await getPool().query(`SELECT data FROM users`);
  return Object.fromEntries(rows.map((r) => [r.data.username, r.data]));
}

async function getUser(username) {
  const { rows } = await getPool().query(`SELECT data FROM users WHERE username = $1`, [username]);
  return rows[0] ? rows[0].data : null;
}

async function saveUser(user) {
  await getPool().query(`INSERT INTO users (username, data) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET data = $2`, [user.username, user]);
  return user;
}

async function loadSession(sessionId) {
  const { rows } = await getPool().query(`SELECT data FROM sessions WHERE id = $1`, [sessionId]);
  return rows[0] ? rows[0].data : null;
}

async function loadAllSessions() {
  const { rows } = await getPool().query(`SELECT id, data FROM sessions`);
  return Object.fromEntries(rows.map((r) => [r.id, r.data]));
}

async function writeSession(sessionId, durable) {
  await getPool().query(`INSERT INTO sessions (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`, [sessionId, durable]);
}

module.exports = { loadCharacters, saveCharacter, deleteCharacter, loadUsers, getUser, saveUser, loadSession, loadAllSessions, writeSession, ready };
