const fs = require("fs");
const path = require("path");

const CORE_DIR = path.join(__dirname, "content-packs", "core");
const HOMEBREW_DIR = path.join(__dirname, "content-packs", "homebrew");

const CATEGORIES = ["races", "classes", "spells", "monsters", "items"];

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function loadCore() {
  const store = { races: {}, classes: {}, spells: {}, monsters: {} };
  for (const cat of CATEGORIES) {
    const data = readJsonSafe(path.join(CORE_DIR, `${cat}.json`));
    if (data) store[cat] = { ...data };
  }
  return store;
}

function listHomebrewPacks() {
  if (!fs.existsSync(HOMEBREW_DIR)) return [];
  return fs
    .readdirSync(HOMEBREW_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadHomebrewPack(packName) {
  return readJsonSafe(path.join(HOMEBREW_DIR, `${packName}.json`));
}

// Merges core content with all homebrew packs currently on disk.
// Homebrew entries are tagged with their pack name as source so the
// client can visually distinguish official vs homebrew content, and
// so id collisions are namespaced (homebrew ids are prefixed).
function buildContentStore() {
  const store = loadCore();
  const packs = listHomebrewPacks();

  for (const packName of packs) {
    const pack = loadHomebrewPack(packName);
    if (!pack) continue;

    for (const cat of CATEGORIES) {
      if (!pack[cat]) continue;
      for (const [rawId, entry] of Object.entries(pack[cat])) {
        const namespacedId = `hb:${packName}:${rawId}`;
        store[cat][namespacedId] = {
          ...entry,
          id: namespacedId,
          source: `homebrew:${packName}`,
        };
      }
    }
  }

  return store;
}

function saveHomebrewPack(packName, packData) {
  if (!fs.existsSync(HOMEBREW_DIR)) {
    fs.mkdirSync(HOMEBREW_DIR, { recursive: true });
  }
  const safeName = packName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const filePath = path.join(HOMEBREW_DIR, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(packData, null, 2), "utf-8");
  return safeName;
}

module.exports = {
  buildContentStore,
  listHomebrewPacks,
  saveHomebrewPack,
  CATEGORIES,
};
