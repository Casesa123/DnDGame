const { getCantripsKnown, getSpellsKnown, slotsForSingleClass, multiclassSlots, WARLOCK_SLOTS } = require("./spellSlots");

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonusForLevel(level) {
  return 2 + Math.floor((level - 1) / 4);
}

// Applies a race's ability score increases on top of base scores. Handles
// both flat bonuses (e.g. { dex: 2 }) and the Half-Elf-style "+1 to two
// abilities of your choice" via a `choice` block -- since this tool has no
// point-buy-style choice UI yet, the choice is auto-applied to the two
// highest eligible base scores (a reasonable stand-in for a player pick).
function applyRaceBonuses(baseScores, race) {
  const result = { ...baseScores };
  if (!race || !race.abilityScoreIncrease) return result;

  const asi = race.abilityScoreIncrease;
  if (asi.all) {
    for (const key of ABILITY_KEYS) {
      result[key] = (result[key] || 0) + asi.all;
    }
  }
  for (const key of ABILITY_KEYS) {
    if (typeof asi[key] === "number") {
      result[key] = (result[key] || 0) + asi[key];
    }
  }
  if (asi.choice) {
    const except = asi.choice.except || [];
    const eligible = ABILITY_KEYS.filter((k) => !except.includes(k)).sort((a, b) => (baseScores[b] || 0) - (baseScores[a] || 0));
    for (let i = 0; i < asi.choice.count && i < eligible.length; i++) {
      result[eligible[i]] += asi.choice.amount;
    }
  }
  return result;
}

// Applies each class's Ability Score Improvement levels. Without a full
// feat system, ASIs default to +2 on that class's primary ability (capped
// at 20) unless the caller supplies explicit choices.
function applyAbilityScoreImprovements(scores, classLevels, classesData, asiChoices) {
  const result = { ...scores };
  let choiceIndex = 0;
  for (const cl of classLevels) {
    const klass = classesData[cl.classId];
    if (!klass || !klass.asiLevels) continue;
    for (const asiLevel of klass.asiLevels) {
      if (cl.level < asiLevel) continue;
      const explicit = asiChoices && asiChoices[choiceIndex];
      choiceIndex++;
      if (explicit && explicit.abilities) {
        for (const [key, amount] of Object.entries(explicit.abilities)) {
          result[key] = Math.min(20, (result[key] || 0) + amount);
        }
      } else {
        const primary = klass.primaryAbility[0];
        result[primary] = Math.min(20, (result[primary] || 0) + 2);
      }
    }
  }
  return result;
}

function computeMaxHp(classLevels, classesData, conMod) {
  let hp = 0;
  let isFirstLevelEver = true;
  for (const cl of classLevels) {
    const klass = classesData[cl.classId];
    const hitDie = klass.hitDie;
    for (let i = 0; i < cl.level; i++) {
      if (isFirstLevelEver) {
        hp += hitDie + conMod;
        isFirstLevelEver = false;
      } else {
        hp += Math.floor(hitDie / 2) + 1 + conMod;
      }
    }
  }
  return Math.max(1, hp);
}

function computeArmorClass(dexMod, equippedArmor, equippedShield) {
  let ac;
  if (equippedArmor) {
    const dexPart = equippedArmor.dexBonus === "full" ? dexMod : equippedArmor.dexBonus === "max2" ? Math.min(dexMod, 2) : 0;
    ac = equippedArmor.baseAC + dexPart;
  } else {
    ac = 10 + dexMod;
  }
  if (equippedShield) ac += equippedShield.baseAC;
  return ac;
}

function totalLevel(classLevels) {
  return classLevels.reduce((sum, cl) => sum + cl.level, 0);
}

// Spellcasting is computed per spellcasting class the character has levels
// in. Full/half casters combine onto the shared multiclass slot table;
// Pact Magic (warlock) is always separate, per 5e rules.
function buildSpellcasting(classLevels, classesData, contentStore, spellChoices, errors) {
  const spellcastingClasses = classLevels.filter((cl) => classesData[cl.classId] && classesData[cl.classId].spellcasting);
  if (!spellcastingClasses.length) return null;

  const sharedCasterLevels = [];
  const result = { classes: {}, sharedSlots: null, pactSlots: null };

  for (const cl of classLevels) {
    const klass = classesData[cl.classId];
    if (!klass || !klass.spellcasting) continue;
    const sc = klass.spellcasting;
    const abilityMod = null; // filled by caller since it needs final ability mods
    const cantripsKnown = getCantripsKnown(cl.classId, cl.level);
    const knownCount = getSpellsKnown(cl.classId, cl.level); // null => "prepared" caster

    if (sc.type === "pact") {
      sharedCasterLevels.push({ casterType: "third-skip", level: cl.level }); // not combined
    } else {
      sharedCasterLevels.push({ casterType: sc.type, level: cl.level });
    }

    const chosen = (spellChoices && spellChoices[cl.classId]) || { cantrips: [], spells: [] };
    const classSpellList = Object.values(contentStore.spells || {}).filter((s) => (s.classes || []).includes(cl.classId));
    const validCantripIds = new Set(classSpellList.filter((s) => s.level === 0).map((s) => s.id));
    const validSpellIds = new Set(classSpellList.filter((s) => s.level > 0).map((s) => s.id));

    const chosenCantrips = (chosen.cantrips || []).filter((id) => {
      if (!validCantripIds.has(id)) {
        errors.push(`"${id}" is not a ${klass.name} cantrip.`);
        return false;
      }
      return true;
    });
    if (chosenCantrips.length > cantripsKnown) {
      errors.push(`${klass.name} can only know ${cantripsKnown} cantrip(s) at level ${cl.level}, but ${chosenCantrips.length} were chosen.`);
    }

    const chosenSpells = (chosen.spells || []).filter((id) => {
      if (!validSpellIds.has(id)) {
        errors.push(`"${id}" is not on the ${klass.name} spell list.`);
        return false;
      }
      return true;
    });
    const maxAllowed = knownCount === null ? null : knownCount;
    if (maxAllowed !== null && chosenSpells.length > maxAllowed) {
      errors.push(`${klass.name} can only know ${maxAllowed} spell(s) at level ${cl.level}, but ${chosenSpells.length} were chosen.`);
    }

    result.classes[cl.classId] = {
      ability: sc.ability,
      type: sc.type,
      preparedCaster: sc.prepared,
      cantripsKnownMax: cantripsKnown,
      cantrips: chosenCantrips.map((id) => contentStore.spells[id]),
      spellsKnownMax: maxAllowed,
      spells: chosenSpells.map((id) => contentStore.spells[id]),
    };
  }

  const combinable = sharedCasterLevels.filter((c) => c.casterType === "full" || c.casterType === "half");
  if (combinable.length) {
    result.sharedSlots = combinable.length === 1 ? slotsForSingleClass(combinable[0].casterType, combinable[0].level) : multiclassSlots(combinable);
  }
  const warlockEntry = classLevels.find((cl) => classesData[cl.classId] && classesData[cl.classId].spellcasting && classesData[cl.classId].spellcasting.type === "pact");
  if (warlockEntry) {
    result.pactSlots = WARLOCK_SLOTS[Math.max(1, Math.min(20, warlockEntry.level))];
  }

  return result;
}

function resolveSubclassFeatures(classesData, cl) {
  const klass = classesData[cl.classId];
  if (!klass || !cl.subclassId) return [];
  const subclass = (klass.subclasses || []).find((s) => s.id === cl.subclassId);
  if (!subclass) return [];
  return subclass.features.filter((f) => f.level <= cl.level).map((f) => ({ ...f, subclass: subclass.name }));
}

function resolveClassFeatures(classesData, cl) {
  const klass = classesData[cl.classId];
  if (!klass) return [];
  const features = [];
  for (const levelEntry of klass.levels || []) {
    if (levelEntry.level > cl.level) break;
    for (const f of levelEntry.features || []) features.push(f);
  }
  return features.concat(resolveSubclassFeatures(classesData, cl));
}

// Builds and validates a full character sheet (level 1-20, optionally
// multiclassed) against the content store.
// Accepts either:
//   - the simple/legacy shape: { name, raceId, classId, baseAbilityScores }
//     (always builds a single-class level 1 character), or
//   - the full shape: { name, raceId, baseAbilityScores, classLevels: [
//       { classId, level, subclassId? }, ... ], asiChoices?, spellChoices?,
//       equippedArmorId?, equippedShieldId?, equipmentIds? }
// Returns { ok: true, character } or { ok: false, errors }.
function buildCharacter(input, contentStore) {
  const errors = [];
  const { name, raceId, baseAbilityScores } = input;

  const classLevels = input.classLevels && input.classLevels.length ? input.classLevels : input.classId ? [{ classId: input.classId, level: 1 }] : [];

  const race = contentStore.races[raceId];
  if (!name || !name.trim()) errors.push("Character name is required.");
  if (!race) errors.push(`Unknown race id: ${raceId}`);
  if (!classLevels.length) errors.push("At least one class and level is required.");

  for (const cl of classLevels) {
    const klass = contentStore.classes[cl.classId];
    if (!klass) {
      errors.push(`Unknown class id: ${cl.classId}`);
      continue;
    }
    if (!Number.isInteger(cl.level) || cl.level < 1 || cl.level > 20) {
      errors.push(`Level for ${klass.name} must be an integer between 1 and 20.`);
    }
    if (cl.subclassId && !(klass.subclasses || []).some((s) => s.id === cl.subclassId)) {
      errors.push(`"${cl.subclassId}" is not a valid subclass of ${klass.name}.`);
    }
    if (!cl.subclassId && cl.level >= klass.subclassLevel) {
      errors.push(`${klass.name} must choose a subclass by level ${klass.subclassLevel}.`);
    }
  }

  for (const key of ABILITY_KEYS) {
    const val = baseAbilityScores ? baseAbilityScores[key] : undefined;
    if (typeof val !== "number" || val < 1 || val > 20) {
      errors.push(`Base ability score for ${key} must be a number between 1 and 20.`);
    }
  }

  const charLevel = totalLevel(classLevels);
  if (charLevel > 20) errors.push("Total character level cannot exceed 20.");

  if (errors.length) return { ok: false, errors };

  let finalScores = applyRaceBonuses(baseAbilityScores, race);
  finalScores = applyAbilityScoreImprovements(finalScores, classLevels, contentStore.classes, input.asiChoices);

  const conMod = abilityModifier(finalScores.con);
  const proficiencyBonus = proficiencyBonusForLevel(charLevel);
  const maxHp = computeMaxHp(classLevels, contentStore.classes, conMod);

  const equippedArmor = input.equippedArmorId ? contentStore.items[input.equippedArmorId] : null;
  const equippedShield = input.equippedShieldId ? contentStore.items[input.equippedShieldId] : null;
  const armorClass = computeArmorClass(abilityModifier(finalScores.dex), equippedArmor, equippedShield);

  const savingThrowProfs = new Set();
  for (const cl of classLevels) {
    for (const s of contentStore.classes[cl.classId].savingThrowProficiencies || []) savingThrowProfs.add(s);
  }
  const savingThrows = {};
  for (const key of ABILITY_KEYS) {
    const mod = abilityModifier(finalScores[key]);
    savingThrows[key] = mod + (savingThrowProfs.has(key) ? proficiencyBonus : 0);
  }

  const classFeatures = [];
  const classSummaries = [];
  for (const cl of classLevels) {
    const klass = contentStore.classes[cl.classId];
    const subclass = cl.subclassId ? (klass.subclasses || []).find((s) => s.id === cl.subclassId) : null;
    classSummaries.push({ id: klass.id, name: klass.name, level: cl.level, subclass: subclass ? { id: subclass.id, name: subclass.name } : null, hitDie: klass.hitDie });
    classFeatures.push(...resolveClassFeatures(contentStore.classes, cl).map((f) => ({ ...f, fromClass: klass.name })));
  }

  const spellChoiceErrors = [];
  const spellcasting = buildSpellcasting(classLevels, contentStore.classes, contentStore, input.spellChoices, spellChoiceErrors);
  if (spellChoiceErrors.length) return { ok: false, errors: spellChoiceErrors };

  const equipmentIds = input.equipmentIds || [];
  const equipment = equipmentIds.map((id) => contentStore.items[id]).filter(Boolean);
  const startingEquipmentText = [...new Set(classLevels.flatMap((cl) => contentStore.classes[cl.classId].startingEquipment || []))];

  const character = {
    id: input.id,
    name: name.trim(),
    level: charLevel,
    race: { id: race.id, name: race.name, source: race.source },
    classes: classSummaries,
    abilityScores: finalScores,
    abilityModifiers: Object.fromEntries(ABILITY_KEYS.map((k) => [k, abilityModifier(finalScores[k])])),
    proficiencyBonus,
    maxHp,
    currentHp: typeof input.currentHp === "number" ? input.currentHp : maxHp,
    armorClass,
    speed: race.speed,
    savingThrows,
    raceTraits: race.traits || [],
    classFeatures,
    startingEquipment: startingEquipmentText,
    equipment,
    equippedArmor: equippedArmor ? { id: equippedArmor.id, name: equippedArmor.name } : null,
    equippedShield: equippedShield ? { id: equippedShield.id, name: equippedShield.name } : null,
    spellcasting,
  };

  return { ok: true, character };
}

module.exports = {
  buildCharacter,
  abilityModifier,
  proficiencyBonusForLevel,
  ABILITY_KEYS,
};
