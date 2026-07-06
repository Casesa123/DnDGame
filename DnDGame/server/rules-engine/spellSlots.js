// Standard 5e spellcasting math, shared across all classes so classes.json
// only needs to say *what kind* of caster a class is (full/half/pact/none).

// Slots per spell level (index 0 = 1st-level slots ... index 8 = 9th-level
// slots) for a full caster, indexed by effective caster level 1-20.
const FULL_CASTER_SLOTS = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

// Pact magic: { slots: count, level: slot level }, indexed by warlock level.
const WARLOCK_SLOTS = {
  1: { slots: 1, level: 1 },
  2: { slots: 2, level: 1 },
  3: { slots: 2, level: 2 },
  4: { slots: 2, level: 2 },
  5: { slots: 2, level: 3 },
  6: { slots: 2, level: 3 },
  7: { slots: 2, level: 4 },
  8: { slots: 2, level: 4 },
  9: { slots: 2, level: 5 },
  10: { slots: 2, level: 5 },
  11: { slots: 3, level: 5 },
  12: { slots: 3, level: 5 },
  13: { slots: 3, level: 5 },
  14: { slots: 3, level: 5 },
  15: { slots: 3, level: 5 },
  16: { slots: 3, level: 5 },
  17: { slots: 4, level: 5 },
  18: { slots: 4, level: 5 },
  19: { slots: 4, level: 5 },
  20: { slots: 4, level: 5 },
};

// { 1: countAtLevel1, 4: countAtLevel4, 10: countAtLevel10, ... } -- read as
// "this many cantrips known starting at this level, until the next entry".
const CANTRIPS_KNOWN_TABLE = {
  bard: { 1: 2, 4: 3, 10: 4 },
  cleric: { 1: 3, 4: 4, 10: 5 },
  druid: { 1: 2, 4: 3, 10: 4 },
  sorcerer: { 1: 4, 4: 5, 10: 6 },
  warlock: { 1: 2, 4: 3, 10: 4 },
  wizard: { 1: 3, 4: 4, 10: 5 },
};

// Approximate standard "spells known" tables for classes that know a fixed
// list of spells rather than preparing from the whole class list.
const SPELLS_KNOWN_TABLE = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};

function tableLookup(table, level) {
  const milestones = Object.keys(table).map(Number).sort((a, b) => a - b);
  let value = 0;
  for (const m of milestones) {
    if (level >= m) value = table[m];
  }
  return value;
}

function getCantripsKnown(classId, level) {
  const table = CANTRIPS_KNOWN_TABLE[classId];
  if (!table) return 0;
  return tableLookup(table, level);
}

function getSpellsKnown(classId, level) {
  const table = SPELLS_KNOWN_TABLE[classId];
  if (!table) return null; // null means "prepared caster", not "known spells" caster
  return table[Math.max(1, Math.min(20, level))] || 0;
}

// Returns { slots: [9 numbers], pact: {slots, level} | null } for a single
// class at a given level and casterType ("full" | "half" | "none").
function slotsForSingleClass(casterType, level) {
  if (casterType === "full") return FULL_CASTER_SLOTS[Math.max(1, Math.min(20, level))];
  if (casterType === "half") {
    const effective = Math.floor(level / 2);
    return effective > 0 ? FULL_CASTER_SLOTS[effective] : [0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

// Multiclass spell slots: sum each class's contribution to the shared caster
// level (full casters contribute their full level, half casters half,
// rounded down), then look up the combined level on the full-caster table.
// Pact magic (warlock) slots are always separate and never combine.
function multiclassSlots(casterLevels) {
  let combined = 0;
  for (const { casterType, level } of casterLevels) {
    if (casterType === "full") combined += level;
    else if (casterType === "half") combined += Math.floor(level / 2);
    else if (casterType === "third") combined += Math.floor(level / 3);
  }
  return combined > 0 ? FULL_CASTER_SLOTS[Math.min(20, combined)] : [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

module.exports = {
  FULL_CASTER_SLOTS,
  WARLOCK_SLOTS,
  getCantripsKnown,
  getSpellsKnown,
  slotsForSingleClass,
  multiclassSlots,
};
