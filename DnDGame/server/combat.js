// Server-authoritative combat resolution. Rolls happen here (not on the
// client) so two players never see different outcomes for the same attack
// and so a modified client can't fake damage.

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

function rollDice(count, sides, mod = 0) {
  const rolls = [];
  for (let i = 0; i < Math.max(0, count); i++) rolls.push(rollDie(sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + mod };
}

function abilityMod(score) {
  return Math.floor(((score || 10) - 10) / 2);
}

function parseDice(str) {
  const m = /(\d+)d(\d+)/i.exec(str || "");
  if (!m) return { count: 1, sides: 6 };
  return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10) };
}

// ---------- Building attack option lists for tokens ----------

// A weapon becomes an attack option with correct 5e to-hit/damage:
// finesse weapons use the better of Str/Dex, ranged use Dex, else Str; we
// assume the character is proficient with weapons they chose to equip.
function weaponAttackOption(weapon, mods, profBonus) {
  const props = weapon.properties || [];
  const finesse = props.some((p) => p.startsWith("finesse"));
  let ability;
  if (finesse) ability = mods.dex >= mods.str ? "dex" : "str";
  else if (weapon.kind === "ranged") ability = "dex";
  else ability = "str";
  const mod = mods[ability];
  const dice = parseDice(weapon.damage);
  return {
    id: `weapon:${weapon.id}`,
    name: weapon.name,
    type: "weapon",
    toHit: profBonus + mod,
    damage: { count: dice.count, sides: dice.sides, mod, type: weapon.damageType || "bludgeoning" },
    spellLevel: 0,
    range: weapon.kind === "ranged" ? "ranged" : "melee",
  };
}

function unarmedOption(mods, profBonus) {
  return {
    id: "weapon:unarmed",
    name: "Unarmed Strike",
    type: "weapon",
    toHit: profBonus + mods.str,
    damage: { count: 0, sides: 0, mod: 1 + mods.str, type: "bludgeoning" },
    spellLevel: 0,
    range: "melee",
  };
}

// Turns a spell (with structured `combat` metadata) into an attack option.
function spellAttackOption(spell, spellAttackBonus, spellSaveDc, spellMod) {
  const c = spell.combat;
  if (!c) return null;
  const base = {
    id: `spell:${spell.id}`,
    name: spell.name,
    spellId: spell.id,
    spellLevel: spell.level,
    scales: c.scales || "none",
    range: spell.range,
  };
  if (c.kind === "heal") {
    return { ...base, type: "spell-heal", heal: { count: c.healDice.count, sides: c.healDice.sides, mod: c.addSpellMod ? spellMod : 0 } };
  }
  const damage = { count: c.damageDice.count, sides: c.damageDice.sides, mod: 0, type: c.damageType || "force" };
  if (c.kind === "attack") return { ...base, type: "spell-attack", toHit: spellAttackBonus, damage };
  if (c.kind === "save") return { ...base, type: "spell-save", save: { ability: c.save.ability, dc: spellSaveDc, onSave: c.save.onSave || "half" }, damage };
  if (c.kind === "auto") return { ...base, type: "spell-auto", damage };
  return null;
}

// Full combat profile for a player character token, computed from the saved
// sheet plus the live content store (so weapon/spell stats stay current).
function buildPcCombat(character, contentStore) {
  const mods = character.abilityModifiers || {};
  const profBonus = character.proficiencyBonus || 2;
  const attacks = [];

  const weaponIds = character.equippedWeaponIds || [];
  for (const id of weaponIds) {
    const w = contentStore.items[id];
    if (w && w.itemType === "weapon") attacks.push(weaponAttackOption(w, mods, profBonus));
  }
  if (!attacks.length) attacks.push(unarmedOption(mods, profBonus));

  // Spell attacks, per spellcasting class (each class may key off a
  // different ability). Only spells with structured combat metadata become
  // usable actions; pure-utility spells are ignored here.
  const saves = character.savingThrows || {};
  const sc = character.spellcasting;
  if (sc && sc.classes) {
    for (const [, classSc] of Object.entries(sc.classes)) {
      const abilityMods = mods[classSc.ability] || 0;
      const spellAttackBonus = profBonus + abilityMods;
      const spellSaveDc = 8 + profBonus + abilityMods;
      const allSpells = [...(classSc.cantrips || []), ...(classSc.spells || [])];
      for (const s of allSpells) {
        const live = contentStore.spells[s.id] || s;
        const opt = spellAttackOption(live, spellAttackBonus, spellSaveDc, abilityMods);
        if (opt) attacks.push(opt);
      }
    }
  }

  return {
    attacks,
    saves,
    slots: sc && sc.sharedSlots ? sc.sharedSlots.slice() : null,
    pactSlots: sc && sc.pactSlots ? { ...sc.pactSlots } : null,
  };
}

// Monster tokens: parse every action that looks like an attack, and derive
// saving-throw bonuses from ability scores (monsters use raw ability mods).
function buildMonsterCombat(monster) {
  const attacks = [];
  for (const action of monster.actions || []) {
    const m = /([+-]\d+)\s*to hit,\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*(\w+)?/i.exec(action.description || "");
    if (!m) continue;
    attacks.push({
      id: `mon:${action.name}`,
      name: action.name,
      type: "weapon",
      toHit: parseInt(m[1], 10),
      damage: {
        count: parseInt(m[2], 10),
        sides: parseInt(m[3], 10),
        mod: m[4] ? parseInt(m[4].replace(/\s+/g, ""), 10) : 0,
        type: (m[5] || "bludgeoning").toLowerCase(),
      },
      spellLevel: 0,
      range: /ranged/i.test(action.description) ? "ranged" : "melee",
    });
  }
  if (!attacks.length) {
    attacks.push({ id: "mon:strike", name: "Strike", type: "weapon", toHit: 3, damage: { count: 1, sides: 6, mod: 0, type: "bludgeoning" }, spellLevel: 0, range: "melee" });
  }
  const saves = {};
  const ab = monster.abilities || {};
  for (const k of ABILITY_KEYS) saves[k] = abilityMod(ab[k]);
  return { attacks, saves };
}

// ---------- Scaling ----------

// Applies cantrip (character-level) or upcast (slot-level) scaling to a
// damaging spell option's dice, returning a new {count, sides, mod, type}.
function scaledDamage(action, casterLevel, slotLevel) {
  const d = action.damage;
  if (!d) return d;
  let count = d.count;
  if (action.spellId === "magic-missile") {
    // 3 darts at 1st level, +1 dart per slot level above 1st; each +1 dart.
    const darts = 3 + Math.max(0, (slotLevel || 1) - 1);
    return { count: darts, sides: 4, mod: darts, type: d.type };
  }
  if (action.scales === "cantrip") {
    const tiers = (casterLevel >= 5 ? 1 : 0) + (casterLevel >= 11 ? 1 : 0) + (casterLevel >= 17 ? 1 : 0);
    count = d.count + tiers;
  } else if (action.scales === "slot" && slotLevel) {
    count = d.count + Math.max(0, slotLevel - action.spellLevel);
  }
  return { count, sides: d.sides, mod: d.mod, type: d.type };
}

// ---------- Resolution ----------

function resolveAction(attacker, target, action, opts = {}) {
  const casterLevel = attacker.charLevel || 1;
  const slotLevel = opts.slotLevel || action.spellLevel || 0;

  if (action.type === "spell-heal") {
    const healRoll = rollDice(action.heal.count, action.heal.sides, action.heal.mod);
    return { kind: "heal", attackName: action.name, heal: healRoll };
  }

  if (action.type === "spell-save") {
    const dmg = scaledDamage(action, casterLevel, slotLevel);
    const saveBonus = (target.saves && target.saves[action.save.ability]) || 0;
    const d20 = rollDie(20);
    const saveTotal = d20 + saveBonus;
    const saved = saveTotal >= action.save.dc;
    const full = rollDice(dmg.count, dmg.sides, dmg.mod);
    let total = full.total;
    if (saved) total = action.save.onSave === "half" ? Math.floor(total / 2) : 0;
    return {
      kind: "save",
      attackName: action.name,
      saveAbility: action.save.ability,
      saveDc: action.save.dc,
      saveRoll: d20,
      saveTotal,
      saved,
      damage: { rolls: full.rolls, total, type: dmg.type },
    };
  }

  if (action.type === "spell-auto") {
    const dmg = scaledDamage(action, casterLevel, slotLevel);
    const roll = rollDice(dmg.count, dmg.sides, dmg.mod);
    return { kind: "auto", attackName: action.name, hit: true, damage: { rolls: roll.rolls, total: roll.total, type: dmg.type } };
  }

  // weapon or spell-attack: a d20 attack roll vs AC.
  const dmgBase = action.type === "spell-attack" ? scaledDamage(action, casterLevel, slotLevel) : action.damage;
  const d20 = rollDie(20);
  const toHitTotal = d20 + (action.toHit || 0);
  const targetAc = typeof target.ac === "number" ? target.ac : 10;
  const isCrit = d20 === 20;
  const isFumble = d20 === 1;
  const hit = !isFumble && (isCrit || toHitTotal >= targetAc);
  let damage = null;
  if (hit) {
    const count = isCrit ? dmgBase.count * 2 : dmgBase.count;
    const roll = rollDice(count, dmgBase.sides, dmgBase.mod);
    damage = { rolls: roll.rolls, total: roll.total, type: dmgBase.type };
  }
  return { kind: "attack", attackName: action.name, d20, bonus: action.toHit || 0, toHitTotal, targetAc, isCrit, isFumble, hit, damage };
}

module.exports = {
  rollDie,
  rollDice,
  abilityMod,
  buildPcCombat,
  buildMonsterCombat,
  resolveAction,
};
