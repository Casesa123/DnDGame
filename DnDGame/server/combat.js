// Server-authoritative combat resolution. Rolls happen here (not on the
// client) so two players never see different outcomes for the same attack
// and so a modified client can't fake damage.

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

function rollDice(count, sides, mod = 0) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + mod };
}

const DEFAULT_ATTACK = { bonus: 3, damage: { count: 1, sides: 6, mod: 0 } };

// Monster stat blocks describe attacks as free text, e.g.
// "Melee weapon attack: +4 to hit, 1d6+2 slashing damage." Parse the first
// action so placed monster tokens can fight without a full attack schema.
function parseMonsterAttack(monster) {
  const action = (monster.actions || [])[0];
  if (!action || !action.description) return { ...DEFAULT_ATTACK, name: action ? action.name : "Attack" };
  const m = /([+-]\d+)\s*to hit,\s*(\d+)d(\d+)\s*([+-]\s*\d+)?/i.exec(action.description);
  if (!m) return { ...DEFAULT_ATTACK, name: action.name };
  return {
    name: action.name,
    bonus: parseInt(m[1], 10),
    damage: {
      count: parseInt(m[2], 10),
      sides: parseInt(m[3], 10),
      mod: m[4] ? parseInt(m[4].replace(/\s+/g, ""), 10) : 0,
    },
  };
}

// Player characters don't have a weapon system yet (see README roadmap), so
// this is a deliberately simplified stand-in: proficiency bonus + the better
// of Str/Dex, versus a generic 1d8 weapon. Good enough to make combat
// playable now; a real weapon/spell-attack system is future work.
function pcAttackProfile(character) {
  const strMod = character.abilityModifiers?.str ?? 0;
  const dexMod = character.abilityModifiers?.dex ?? 0;
  const mod = Math.max(strMod, dexMod);
  const bonus = (character.proficiencyBonus || 2) + mod;
  return { name: "Attack", bonus, damage: { count: 1, sides: 8, mod } };
}

function resolveAttack(attackerToken, targetToken) {
  const atk = attackerToken.atk || DEFAULT_ATTACK;
  const d20 = rollDie(20);
  const toHitTotal = d20 + atk.bonus;
  const targetAc = typeof targetToken.ac === "number" ? targetToken.ac : 10;
  const isCrit = d20 === 20;
  const isFumble = d20 === 1;
  const hit = !isFumble && (isCrit || toHitTotal >= targetAc);

  let damage = null;
  if (hit) {
    const diceCount = isCrit ? atk.damage.count * 2 : atk.damage.count;
    damage = rollDice(diceCount, atk.damage.sides, atk.damage.mod);
  }

  return { attackName: atk.name || "Attack", d20, bonus: atk.bonus, toHitTotal, targetAc, isCrit, isFumble, hit, damage };
}

module.exports = { rollDie, rollDice, parseMonsterAttack, pcAttackProfile, resolveAttack };
