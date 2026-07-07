// ============ Tabs ============
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const TOKEN_COLORS = ["#C1521F", "#3E7C59", "#3568A8", "#A8342A", "#8A5FB0", "#B08A2E"];

let contentStore = { races: {}, classes: {}, spells: {}, monsters: {} };

// A stable per-browser identity (not an account system) so that if you
// refresh or reconnect, re-adding your character reuses the same token
// instead of spawning a duplicate.
function getClientId() {
  let id = localStorage.getItem("dnd-client-id");
  if (!id) {
    id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("dnd-client-id", id);
  }
  return id;
}
const myClientId = getClientId();

// ============ Accounts (optional) ============
let authToken = localStorage.getItem("dnd-auth-token") || null;
let authUser = localStorage.getItem("dnd-auth-user") || null;

function authHeaders(extra = {}) {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

function updateAccountUI() {
  const status = document.getElementById("account-status");
  const loginBtn = document.getElementById("btn-account");
  const logoutBtn = document.getElementById("btn-logout");
  if (authUser) {
    status.textContent = `Signed in as ${authUser}`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "";
  } else {
    status.textContent = "";
    loginBtn.style.display = "";
    logoutBtn.style.display = "none";
  }
  const sessionName = document.getElementById("session-username");
  if (authUser && sessionName && !sessionName.value) sessionName.value = authUser;
}

function openAccountModal() {
  document.getElementById("account-error").textContent = "";
  document.getElementById("account-modal").style.display = "flex";
}
function closeAccountModal() {
  document.getElementById("account-modal").style.display = "none";
}

async function submitAccount(path) {
  const username = document.getElementById("account-username").value;
  const password = document.getElementById("account-password").value;
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const data = await res.json();
  if (!data.ok) {
    document.getElementById("account-error").textContent = data.error;
    return;
  }
  authToken = data.token;
  authUser = data.username;
  localStorage.setItem("dnd-auth-token", authToken);
  localStorage.setItem("dnd-auth-user", authUser);
  closeAccountModal();
  updateAccountUI();
  loadCharacters();
}

document.getElementById("btn-account").addEventListener("click", openAccountModal);
document.getElementById("btn-account-cancel").addEventListener("click", closeAccountModal);
document.getElementById("btn-do-login").addEventListener("click", () => submitAccount("/api/login"));
document.getElementById("btn-do-register").addEventListener("click", () => submitAccount("/api/register"));
document.getElementById("btn-logout").addEventListener("click", () => {
  authToken = null;
  authUser = null;
  localStorage.removeItem("dnd-auth-token");
  localStorage.removeItem("dnd-auth-user");
  updateAccountUI();
  loadCharacters();
});

// ============ Content loading ============
async function loadContent() {
  const res = await fetch("/api/content");
  contentStore = await res.json();
  populateBuilderOptions();
  renderContentSummary();
  populateSessionMonsterSelect();
  if (typeof refreshCompendium === "function") refreshCompendium();
}

function populateSessionMonsterSelect() {
  const select = document.getElementById("session-monster-select");
  if (!select) return;
  select.innerHTML = Object.values(contentStore.monsters)
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join("");
}

// ============ Saved characters ============
let savedCharacters = {};

async function loadCharacters() {
  const res = await fetch("/api/characters", { headers: authHeaders() });
  savedCharacters = await res.json();
  renderSavedCharacterList();
  populateSessionCharacterSelect();
}

function renderSavedCharacterList() {
  const list = document.getElementById("saved-character-list");
  if (!list) return;
  const entries = Object.values(savedCharacters);
  if (!entries.length) {
    list.innerHTML = `<li class="muted small">No saved characters yet. Build one above and click "Save character".</li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (c) =>
        `<li><b>${c.name}</b> &mdash; Level ${c.level} ${(c.race && c.race.name) || ""} ${(c.class && c.class.name) || ""}
          <button class="link-btn" data-delete-character="${c.id}" type="button" style="margin-left:10px">Delete</button>
        </li>`
    )
    .join("");
  list.querySelectorAll("[data-delete-character]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/characters/${btn.dataset.deleteCharacter}`, { method: "DELETE", headers: authHeaders() });
      await loadCharacters();
    });
  });
}

function populateSessionCharacterSelect() {
  const select = document.getElementById("session-character-select");
  if (!select) return;
  const entries = Object.values(savedCharacters);
  select.innerHTML = entries.length
    ? entries.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")
    : `<option value="">No saved characters</option>`;
}

function populateBuilderOptions() {
  const raceSelect = document.getElementById("char-race");
  raceSelect.innerHTML = Object.values(contentStore.races)
    .map((r) => `<option value="${r.id}">${r.name}${r.source !== "core" ? " (homebrew)" : ""}</option>`)
    .join("");

  const abilityWrap = document.getElementById("ability-inputs");
  abilityWrap.innerHTML = ABILITY_KEYS.map(
    (k) => `<label>${ABILITY_LABELS[k]}<input type="number" min="1" max="20" id="ability-${k}" value="10"></label>`
  ).join("");

  const armorSelect = document.getElementById("char-armor");
  const shieldSelect = document.getElementById("char-shield");
  const armors = Object.values(contentStore.items || {}).filter((i) => i.itemType === "armor" && i.category !== "shield");
  const shields = Object.values(contentStore.items || {}).filter((i) => i.itemType === "armor" && i.category === "shield");
  armorSelect.innerHTML = `<option value="">None</option>` + armors.map((a) => `<option value="${a.id}">${a.name} (AC ${a.baseAC})</option>`).join("");
  shieldSelect.innerHTML = `<option value="">None</option>` + shields.map((s) => `<option value="${s.id}">${s.name} (+${s.baseAC} AC)</option>`).join("");

  const weaponSelect = document.getElementById("char-weapons");
  if (weaponSelect) {
    const weapons = Object.values(contentStore.items || {}).filter((i) => i.itemType === "weapon").sort((a, b) => a.name.localeCompare(b.name));
    weaponSelect.innerHTML = weapons.map((w) => `<option value="${w.id}">${w.name} (${w.damage} ${w.damageType})</option>`).join("");
  }

  if (!classLevelRows.length) {
    const firstClassId = Object.keys(contentStore.classes)[0] || "";
    classLevelRows.push({ classId: firstClassId, level: 1, subclassId: "" });
  }
  renderClassLevelRows();
}

// ============ Classes & levels (multiclass builder) ============
const classLevelRows = [];
const spellSelections = {}; // classId -> { cantrips: Set<id>, spells: Set<id> }

function renderClassLevelRows() {
  const container = document.getElementById("class-levels-list");
  container.innerHTML = classLevelRows
    .map((row, i) => {
      const klass = contentStore.classes[row.classId];
      const classOptions = Object.values(contentStore.classes)
        .map((c) => `<option value="${c.id}" ${c.id === row.classId ? "selected" : ""}>${c.name}${c.source !== "core" ? " (homebrew)" : ""}</option>`)
        .join("");
      const showSubclass = klass && row.level >= klass.subclassLevel;
      const subclassOptions = showSubclass
        ? `<option value="">Choose...</option>` +
          (klass.subclasses || []).map((s) => `<option value="${s.id}" ${s.id === row.subclassId ? "selected" : ""}>${s.name}</option>`).join("")
        : "";
      return `
        <div class="class-level-row" data-row="${i}">
          <label>Class <select class="row-class">${classOptions}</select></label>
          <label>Level <input class="level-input" type="number" min="1" max="20" value="${row.level}"></label>
          ${showSubclass ? `<label>Subclass <select class="row-subclass">${subclassOptions}</select></label>` : ""}
          ${classLevelRows.length > 1 ? `<button type="button" class="link-btn remove-class-btn" data-remove="${i}">Remove</button>` : ""}
        </div>`;
    })
    .join("");

  container.querySelectorAll(".class-level-row").forEach((rowEl) => {
    const i = Number(rowEl.dataset.row);
    rowEl.querySelector(".row-class").addEventListener("change", (e) => {
      classLevelRows[i].classId = e.target.value;
      classLevelRows[i].subclassId = "";
      renderClassLevelRows();
    });
    rowEl.querySelector(".level-input").addEventListener("change", (e) => {
      classLevelRows[i].level = Math.max(1, Math.min(20, Number(e.target.value) || 1));
      renderClassLevelRows();
    });
    const subclassSelect = rowEl.querySelector(".row-subclass");
    if (subclassSelect) {
      subclassSelect.addEventListener("change", (e) => {
        classLevelRows[i].subclassId = e.target.value;
      });
    }
    const removeBtn = rowEl.querySelector("[data-remove]");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        classLevelRows.splice(i, 1);
        renderClassLevelRows();
      });
    }
  });

  renderSpellChoiceSection();
  renderAsiSection();
}

// A few original (SRD-safe) feats. Homebrew feats can be added later; PHB
// feats are copyrighted and aren't bundled. Half-feats grant +1 to an ability.
const FEATS = [
  { id: "grappler", name: "Grappler", ability: null, description: "Advantage on attacks against a creature you're grappling, and you can try to pin a grappled creature." },
  { id: "hardy", name: "Hardy", ability: "con", description: "+1 Constitution, and your hit point maximum increases by an amount equal to your level." },
  { id: "quick-reflexes", name: "Quick Reflexes", ability: "dex", description: "+1 Dexterity, and you have advantage on initiative rolls." },
  { id: "keen-mind", name: "Sharp Wit", ability: "int", description: "+1 Intelligence, and you always know which way is north and how many hours are left before sunrise or sunset." },
  { id: "stalwart", name: "Stalwart", ability: "str", description: "+1 Strength, and you count as one size larger when determining your carrying capacity and push/drag/lift." },
];

// The number of Ability Score Improvements a character has earned, summed
// across each class's ASI levels reached.
function countAsiSlots() {
  let n = 0;
  for (const row of classLevelRows) {
    const klass = contentStore.classes[row.classId];
    if (!klass || !klass.asiLevels) continue;
    n += klass.asiLevels.filter((lvl) => row.level >= lvl).length;
  }
  return n;
}

// asiSelections[i] = { mode: "asi"|"feat", a: abilityKey, b: abilityKey, featId }
const asiSelections = [];

function renderAsiSection() {
  const section = document.getElementById("asi-section");
  const slots = countAsiSlots();
  if (!slots) {
    section.innerHTML = "";
    return;
  }
  asiSelections.length = slots; // trim/grow
  for (let i = 0; i < slots; i++) if (!asiSelections[i]) asiSelections[i] = { mode: "asi", a: "str", b: "str", featId: FEATS[0].id };

  const abilityOpts = (sel) => ABILITY_KEYS.map((k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${ABILITY_LABELS[k]}</option>`).join("");
  const featOpts = (sel) => FEATS.map((f) => `<option value="${f.id}" ${f.id === sel ? "selected" : ""}>${f.name}</option>`).join("");

  section.innerHTML = `
    <div class="ability-block">
      <div class="ability-block-header"><span>Ability Score Improvements &amp; Feats (${slots})</span></div>
      <p class="muted small" style="text-transform:none">Each improvement: +1 to two abilities (pick the same twice for +2), or take a feat.</p>
      ${asiSelections
        .map(
          (s, i) => `
        <div class="asi-row" data-asi="${i}">
          <select class="asi-mode">
            <option value="asi" ${s.mode === "asi" ? "selected" : ""}>Ability Score Improvement</option>
            <option value="feat" ${s.mode === "feat" ? "selected" : ""}>Take a feat</option>
          </select>
          <span class="asi-asi" style="${s.mode === "asi" ? "" : "display:none"}">
            <select class="asi-a">${abilityOpts(s.a)}</select>
            <select class="asi-b">${abilityOpts(s.b)}</select>
          </span>
          <span class="asi-feat" style="${s.mode === "feat" ? "" : "display:none"}">
            <select class="asi-featid">${featOpts(s.featId)}</select>
          </span>
        </div>`
        )
        .join("")}
    </div>`;

  section.querySelectorAll(".asi-row").forEach((rowEl) => {
    const i = Number(rowEl.dataset.asi);
    rowEl.querySelector(".asi-mode").addEventListener("change", (e) => {
      asiSelections[i].mode = e.target.value;
      renderAsiSection();
    });
    const a = rowEl.querySelector(".asi-a");
    const b = rowEl.querySelector(".asi-b");
    if (a) a.addEventListener("change", (e) => (asiSelections[i].a = e.target.value));
    if (b) b.addEventListener("change", (e) => (asiSelections[i].b = e.target.value));
    const fid = rowEl.querySelector(".asi-featid");
    if (fid) fid.addEventListener("change", (e) => (asiSelections[i].featId = e.target.value));
  });
}

// Builds the asiChoices array the server expects, one entry per ASI slot.
function buildAsiChoices() {
  return asiSelections.slice(0, countAsiSlots()).map((s) => {
    if (s.mode === "feat") {
      const feat = FEATS.find((f) => f.id === s.featId) || FEATS[0];
      const abilities = feat.ability ? { [feat.ability]: 1 } : {};
      return { abilities, feat: { name: feat.name, description: feat.description } };
    }
    const abilities = {};
    abilities[s.a] = (abilities[s.a] || 0) + 1;
    abilities[s.b] = (abilities[s.b] || 0) + 1;
    return { abilities };
  });
}

document.getElementById("btn-add-class").addEventListener("click", () => {
  const usedIds = new Set(classLevelRows.map((r) => r.classId));
  const nextClass = Object.keys(contentStore.classes).find((id) => !usedIds.has(id)) || Object.keys(contentStore.classes)[0];
  classLevelRows.push({ classId: nextClass, level: 1, subclassId: "" });
  renderClassLevelRows();
});

function renderSpellChoiceSection() {
  const section = document.getElementById("spell-choice-section");
  const casterRows = classLevelRows.filter((r) => contentStore.classes[r.classId] && contentStore.classes[r.classId].spellcasting);

  section.innerHTML = casterRows
    .map((row) => {
      const klass = contentStore.classes[row.classId];
      if (!spellSelections[row.classId]) spellSelections[row.classId] = { cantrips: new Set(), spells: new Set() };
      const list = Object.values(contentStore.spells || {}).filter((s) => (s.classes || []).includes(row.classId));
      const cantrips = list.filter((s) => s.level === 0).sort((a, b) => a.name.localeCompare(b.name));
      const leveled = list.filter((s) => s.level > 0).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

      const cantripBoxes = cantrips
        .map(
          (s) =>
            `<label><input type="checkbox" data-class="${row.classId}" data-kind="cantrip" data-spell="${s.id}" ${
              spellSelections[row.classId].cantrips.has(s.id) ? "checked" : ""
            }> ${s.name}</label>`
        )
        .join("");
      const spellBoxes = leveled
        .map(
          (s) =>
            `<label><input type="checkbox" data-class="${row.classId}" data-kind="spell" data-spell="${s.id}" ${
              spellSelections[row.classId].spells.has(s.id) ? "checked" : ""
            }> Lv${s.level} ${s.name}</label>`
        )
        .join("");

      return `
        <div class="spell-picker">
          <h4>${klass.name} spells known/prepared</h4>
          ${cantrips.length ? `<div class="muted small">Cantrips</div><div class="spell-picker-group">${cantripBoxes}</div>` : ""}
          ${leveled.length ? `<div class="muted small">Leveled spells</div><div class="spell-picker-group">${spellBoxes}</div>` : ""}
        </div>`;
    })
    .join("");

  section.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", (e) => {
      const { class: classId, kind, spell } = e.target.dataset;
      const set = kind === "cantrip" ? spellSelections[classId].cantrips : spellSelections[classId].spells;
      if (e.target.checked) set.add(spell);
      else set.delete(spell);
    });
  });
}

function renderContentSummary() {
  const cats = [
    ["races", "Races"],
    ["classes", "Classes"],
    ["spells", "Spells"],
    ["monsters", "Monsters"],
    ["items", "Items"],
  ];
  const html = `<div class="content-summary-grid">${cats
    .map(([key, label]) => {
      const items = Object.values(contentStore[key]);
      const lis = items
        .map(
          (item) =>
            `<li>${item.name}<span class="${item.source === "core" ? "src-core" : "src-hb"}">${
              item.source === "core" ? "core" : "homebrew"
            }</span></li>`
        )
        .join("");
      return `<div class="content-summary-card"><h4>${label} (${items.length})</h4><ul>${lis}</ul></div>`;
    })
    .join("")}</div>`;
  document.getElementById("content-summary").innerHTML = html;
}

document.getElementById("btn-standard-array").addEventListener("click", () => {
  const values = [15, 14, 13, 12, 10, 8];
  ABILITY_KEYS.forEach((k, i) => {
    document.getElementById(`ability-${k}`).value = values[i];
  });
});

// ============ Character builder ============
let lastBuiltCharacter = null;

document.getElementById("btn-build").addEventListener("click", async () => {
  const name = document.getElementById("char-name").value;
  const raceId = document.getElementById("char-race").value;
  const baseAbilityScores = Object.fromEntries(
    ABILITY_KEYS.map((k) => [k, Number(document.getElementById(`ability-${k}`).value)])
  );
  const classLevels = classLevelRows.map((r) => ({
    classId: r.classId,
    level: r.level,
    subclassId: r.subclassId || undefined,
  }));
  const spellChoices = {};
  for (const [classId, sel] of Object.entries(spellSelections)) {
    if (classLevelRows.some((r) => r.classId === classId)) {
      spellChoices[classId] = { cantrips: [...sel.cantrips], spells: [...sel.spells] };
    }
  }
  const equippedArmorId = document.getElementById("char-armor").value || undefined;
  const equippedShieldId = document.getElementById("char-shield").value || undefined;
  const equippedWeaponIds = Array.from(document.getElementById("char-weapons").selectedOptions).map((o) => o.value);
  const asiChoices = buildAsiChoices();

  const res = await fetch("/api/characters/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, raceId, classLevels, baseAbilityScores, spellChoices, equippedArmorId, equippedShieldId, equippedWeaponIds, asiChoices }),
  });
  const data = await res.json();
  const errBox = document.getElementById("builder-errors");

  if (!data.ok) {
    errBox.textContent = data.errors.join(" ");
    document.getElementById("btn-save-character").disabled = true;
    lastBuiltCharacter = null;
    return;
  }
  errBox.textContent = "";
  lastBuiltCharacter = data.character;
  document.getElementById("btn-save-character").disabled = false;
  document.getElementById("save-status").textContent = "";
  renderCharacterSheet(data.character);
});

document.getElementById("btn-save-character").addEventListener("click", async () => {
  if (!lastBuiltCharacter) return;
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ character: lastBuiltCharacter }),
  });
  const data = await res.json();
  const statusEl = document.getElementById("save-status");
  if (!data.ok) {
    statusEl.textContent = "Error: " + data.error;
    return;
  }
  lastBuiltCharacter = data.character;
  statusEl.textContent = `Saved "${data.character.name}". Find it under "My character" in the Game session tab.`;
  await loadCharacters();
});

function renderCharacterSheet(c) {
  const out = document.getElementById("sheet-output");
  out.classList.add("visible");
  out.innerHTML = buildCharacterSheetHtml(c);
}

function buildCharacterSheetHtml(c) {
  const statRow = ABILITY_KEYS.map(
    (k) => `<div class="stat-chip"><div class="label">${ABILITY_LABELS[k]}</div><div class="value">${c.abilityScores[k]} (${fmtMod(c.abilityModifiers[k])})</div></div>`
  ).join("");

  const savesRow = ABILITY_KEYS.map(
    (k) => `<div class="stat-chip"><div class="label">Save ${ABILITY_LABELS[k]}</div><div class="value">${fmtMod(c.savingThrows[k])}</div></div>`
  ).join("");

  const traits = (c.raceTraits || [])
    .map((t) => `<li><b>${t.name}.</b> ${t.description}</li>`)
    .join("");
  const features = (c.classFeatures || [])
    .map((f) => `<li><b>${f.name}${f.subclass ? ` (${f.subclass})` : ""}.</b> ${f.description} <span class="muted small">(${f.fromClass})</span></li>`)
    .join("");
  const equipment = (c.startingEquipment || []).map((e) => `<li>${e}</li>`).join("");
  const purchasedEquipment = (c.equipment || []).map((e) => `<li>${e.name}</li>`).join("");
  const classLine = (c.classes || [])
    .map((cl) => `${cl.name} ${cl.level}${cl.subclass ? ` (${cl.subclass.name})` : ""}`)
    .join(" / ");

  const spellSection = renderSpellcastingSection(c.spellcasting);

  return `
    <div class="sheet-header">
      <div class="sheet-name">${c.name}</div>
      <div class="sheet-sub">Level ${c.level} ${c.race.name} ${classLine}</div>
    </div>
    <div class="vital-row">
      <div class="vital-chip"><div class="label">Hit points</div><div class="value">${c.currentHp} / ${c.maxHp}</div></div>
      <div class="vital-chip"><div class="label">Armor class</div><div class="value">${c.armorClass}</div></div>
      <div class="vital-chip"><div class="label">Speed</div><div class="value">${c.speed} ft</div></div>
      <div class="vital-chip"><div class="label">Proficiency</div><div class="value">${fmtMod(c.proficiencyBonus)}</div></div>
    </div>
    <div class="stat-row">${statRow}</div>
    <div class="stat-row">${savesRow}</div>
    <h3>Race traits</h3>
    <ul class="feature-list">${traits}</ul>
    <h3>Class features</h3>
    <ul class="feature-list">${features}</ul>
    ${(c.feats || []).length ? `<h3>Feats</h3><ul class="feature-list">${c.feats.map((f) => `<li><b>${f.name}.</b> ${f.description}</li>`).join("")}</ul>` : ""}
    ${spellSection}
    <h3>Starting equipment</h3>
    <ul class="feature-list">${equipment}</ul>
    ${purchasedEquipment ? `<h3>Equipped/purchased items</h3><ul class="feature-list">${purchasedEquipment}</ul>` : ""}
  `;
}

function renderSpellcastingSection(spellcasting) {
  if (!spellcasting) return "";
  const slotLine = (label, slots) =>
    slots
      ? `<div class="muted small">${label}: ${slots.map((n, i) => (n ? `Lv${i + 1}: ${n}` : "")).filter(Boolean).join(", ") || "none"}</div>`
      : "";

  const classBlocks = Object.entries(spellcasting.classes)
    .map(([classId, sc]) => {
      const cantrips = (sc.cantrips || []).map((s) => `<li>${s.name}</li>`).join("");
      const spells = (sc.spells || []).map((s) => `<li>Lv${s.level} ${s.name}</li>`).join("");
      return `
        <div class="muted small">${classId} spellcasting ability: ${sc.ability.toUpperCase()}${
        sc.preparedCaster ? " (prepared)" : " (known)"
      }, cantrips known: ${sc.cantripsKnownMax}${sc.spellsKnownMax !== null ? `, spells known: ${sc.spellsKnownMax}` : ""}</div>
        ${cantrips ? `<ul class="feature-list">${cantrips}</ul>` : ""}
        ${spells ? `<ul class="feature-list">${spells}</ul>` : ""}
      `;
    })
    .join("");

  const pactLine = spellcasting.pactSlots
    ? `<div class="muted small">Pact magic slots: ${spellcasting.pactSlots.slots} of level ${spellcasting.pactSlots.level}</div>`
    : "";

  return `
    <h3>Spellcasting</h3>
    ${slotLine("Spell slots", spellcasting.sharedSlots)}
    ${pactLine}
    ${classBlocks}
  `;
}

function fmtMod(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

// ============ Homebrew import ============
document.getElementById("btn-upload-homebrew").addEventListener("click", async () => {
  const packName = document.getElementById("hb-pack-name").value;
  const statusEl = document.getElementById("homebrew-status");
  let parsed;
  try {
    parsed = JSON.parse(document.getElementById("hb-json").value);
  } catch (e) {
    statusEl.textContent = "That's not valid JSON: " + e.message;
    return;
  }
  const res = await fetch("/api/homebrew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packName, ...parsed }),
  });
  const data = await res.json();
  if (!data.ok) {
    statusEl.textContent = "Error: " + data.error;
    return;
  }
  contentStore = data.content;
  statusEl.textContent = `Loaded pack "${data.packName}". Content lists refreshed.`;
  populateBuilderOptions();
  renderContentSummary();
  populateSessionMonsterSelect();
  refreshCompendium();
});

// ============ Realtime session ============
let socket = null;
let mySessionId = null;
let myUserName = null;
let myRole = "player";
let initiativeOrder = [];
let localStream = null;
let screenShareStream = null;
const peerConnections = {}; // socketId -> RTCPeerConnection
const knownMembers = {}; // socketId -> { userName }

document.getElementById("btn-join-session").addEventListener("click", () => {
  mySessionId = document.getElementById("session-id").value || "table-1";
  myUserName = document.getElementById("session-username").value || "Adventurer";
  myRole = document.getElementById("session-role").value === "dm" ? "dm" : "player";

  document.getElementById("dm-tools-card").style.display = myRole === "dm" ? "block" : "none";
  document.getElementById("secret-roll-wrap").style.display = myRole === "dm" ? "flex" : "none";

  if (socket) socket.disconnect();
  socket = io();

  socket.on("connect", () => {
    socket.emit("join-session", { sessionId: mySessionId, userName: myUserName, clientId: myClientId, role: myRole });
    document.getElementById("session-status").textContent = `Connected as ${myUserName} (${myRole === "dm" ? "DM" : "Player"}) to "${mySessionId}"`;
  });

  socket.on("session-state", (state) => {
    initiativeOrder = state.initiative || [];
    renderInitiative();
    Object.keys(latestTokens).forEach((id) => delete latestTokens[id]);
    document.querySelectorAll(".token").forEach((el) => el.remove());
    document.getElementById("log-feed").innerHTML = "";
    applyMapState(state.map);
    Object.values(state.tokens || {}).forEach(renderToken);
    Object.assign(knownMembers, state.members || {});
    (state.chatLog || [])
      .concat(state.diceLog || [])
      .concat((state.combatLog || []).map((e) => ({ combat: true, ...e })))
      .sort((a, b) => a.at - b.at)
      .forEach(appendLogEntry);
    document.getElementById("dm-map-controls").style.display = myRole === "dm" ? "flex" : "none";
    if (myRole === "dm") {
      document.getElementById("dm-note-log").innerHTML = "";
      (state.dmNotes || []).forEach(appendDmNote);
      renderDmTools();
    }
  });

  socket.on("dm-note", appendDmNote);
  socket.on("map-update", (map) => applyMapState(map));

  socket.on("member-list", (members) => {
    Object.assign(knownMembers, members);
  });

  socket.on("member-joined", ({ socketId, userName }) => {
    knownMembers[socketId] = { userName };
    // If we're already in the call, greet the new peer with an offer.
    if (localStream) ensurePeerConnection(socketId, true);
  });

  socket.on("member-left", ({ socketId }) => {
    delete knownMembers[socketId];
    if (peerConnections[socketId]) {
      peerConnections[socketId].close();
      delete peerConnections[socketId];
    }
    const tile = document.getElementById(`video-tile-${socketId}`);
    if (tile) tile.remove();
  });

  socket.on("token-upsert", (token) => {
    renderToken(token);
    if (myRole === "dm") renderDmTools();
    const panel = document.getElementById("token-panel");
    if (panel.style.display === "block" && panel.dataset.tokenId === token.id) openTokenPanel(token.id);
  });
  socket.on("token-remove", ({ id }) => {
    const el = document.getElementById(`token-${id}`);
    if (el) el.remove();
    delete latestTokens[id];
    if (myRole === "dm") renderDmTools();
    const panel = document.getElementById("token-panel");
    if (panel.style.display === "block" && panel.dataset.tokenId === id) panel.style.display = "none";
  });

  socket.on("initiative-update", (order) => {
    initiativeOrder = order;
    renderInitiative();
  });

  socket.on("dice-roll", (entry) => {
    animateForEntry(entry);
    appendLogEntry(entry);
  });
  socket.on("chat-message", appendLogEntry);
  socket.on("attack-result", (entry) => {
    const e = { combat: true, ...entry };
    animateForEntry(e);
    appendLogEntry(e);
  });

  socket.on("webrtc-signal", async ({ from, signal }) => {
    if (signal.type === "offer") {
      const pc = ensurePeerConnection(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-signal", { to: from, signal: pc.localDescription });
    } else if (signal.type === "answer") {
      const pc = peerConnections[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      const pc = peerConnections[from];
      if (pc) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (e) {
          /* ignore late candidates */
        }
      }
    }
  });
});

// ---- DM tools ----
function appendDmNote(entry) {
  const log = document.getElementById("dm-note-log");
  const div = document.createElement("div");
  div.className = "entry";
  div.textContent = entry.text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("btn-add-dm-note").addEventListener("click", () => {
  const input = document.getElementById("dm-note-input");
  const text = input.value.trim();
  if (!text || !socket) return;
  socket.emit("dm-note", { text });
  input.value = "";
});

function renderDmTools() {
  const monsterTools = document.getElementById("dm-monster-tools");
  const monsters = Object.values(latestTokens).filter((t) => t.kind === "monster");
  monsterTools.innerHTML = monsters.length
    ? monsters
        .map(
          (t) => `
      <div class="dm-tool-row">
        <span>${t.name || t.label} ${typeof t.hp === "number" ? `(${t.hp}/${t.maxHp} HP, AC ${t.ac})` : `(AC ${t.ac})`}</span>
        <div class="btns">
          <button type="button" class="secondary-btn" data-hide="${t.id}">${t.hidden ? "Reveal" : "Hide"}</button>
          <button type="button" class="secondary-btn" data-reveal-hp="${t.id}">${t.revealHp ? "Mask HP" : "Reveal HP"}</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="muted small">No monster tokens on the map yet.</p>`;

  monsterTools.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", () => socket && socket.emit("dm-toggle-hidden", { tokenId: btn.dataset.hide }));
  });
  monsterTools.querySelectorAll("[data-reveal-hp]").forEach((btn) => {
    btn.addEventListener("click", () => socket && socket.emit("dm-toggle-hp-reveal", { tokenId: btn.dataset.revealHp }));
  });

  const partyPanel = document.getElementById("dm-party-panel");
  const pcs = Object.values(latestTokens).filter((t) => t.kind === "pc");
  partyPanel.innerHTML = pcs.length
    ? pcs
        .map(
          (t, i) => `
      <div class="dm-tool-row">
        <span>${t.name || t.label} (${t.hp}/${t.maxHp} HP, AC ${t.ac})</span>
        <div class="btns"><button type="button" class="secondary-btn" data-view-sheet="${t.characterId || ""}">View sheet</button></div>
      </div>
      <div id="dm-sheet-${i}" style="display:none"></div>`
        )
        .join("")
    : `No party characters on the map yet.`;

  partyPanel.querySelectorAll("[data-view-sheet]").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const wrap = document.getElementById(`dm-sheet-${i}`);
      const charId = btn.dataset.viewSheet;
      const character = savedCharacters[charId];
      if (!character) {
        wrap.style.display = "block";
        wrap.innerHTML = `<p class="muted small">No saved sheet found for this character.</p>`;
        return;
      }
      const isOpen = wrap.style.display !== "none";
      if (isOpen) {
        wrap.style.display = "none";
      } else {
        wrap.innerHTML = buildCharacterSheetHtml(character);
        wrap.style.display = "block";
      }
    });
  });
}

// ---- Initiative ----
document.getElementById("btn-add-init").addEventListener("click", () => {
  const name = document.getElementById("init-name").value;
  const value = Number(document.getElementById("init-value").value);
  if (!name || Number.isNaN(value)) return;
  initiativeOrder.push({ name, value });
  initiativeOrder.sort((a, b) => b.value - a.value);
  socket && socket.emit("initiative-update", initiativeOrder);
  renderInitiative();
  document.getElementById("init-name").value = "";
  document.getElementById("init-value").value = "";
});

document.getElementById("btn-next-turn").addEventListener("click", () => {
  if (!initiativeOrder.length) return;
  initiativeOrder.push(initiativeOrder.shift());
  socket && socket.emit("initiative-update", initiativeOrder);
  renderInitiative();
});

function renderInitiative() {
  const list = document.getElementById("init-list");
  list.innerHTML = initiativeOrder
    .map((entry, i) => `<li class="${i === 0 ? "current" : ""}">${entry.name} &mdash; ${entry.value}</li>`)
    .join("");
}

// ---- Map / tokens ----
// Token positions are stored as fractions (fx,fy in 0..1) of the map so they
// line up across different screen sizes. The logical grid is GRID_N squares,
// each representing 5 feet, so distance can be measured.
const GRID_N = 20;
const FEET_PER_CELL = 5;
const mapGrid = document.getElementById("map-grid");
const fogLayer = document.getElementById("fog-layer");
let tokenCounter = 0;
const latestTokens = {}; // id -> most recent known token data
let mapState = { background: "", fogEnabled: false, revealed: {} };
let fogPaintMode = false; // DM: click cells to reveal/hide

function eventFraction(e) {
  const rect = mapGrid.getBoundingClientRect();
  return {
    fx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    fy: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
  };
}

mapGrid.addEventListener("click", (e) => {
  if (e.target !== mapGrid) return;
  if (fogPaintMode) return; // painting is handled on the fog layer
  const { fx, fy } = eventFraction(e);
  const label = prompt("Marker label (e.g. initials):", "M" + ++tokenCounter);
  if (label === null) return;
  const token = {
    id: `${socket ? socket.id : "local"}-${Date.now()}`,
    kind: "marker",
    fx,
    fy,
    label,
    color: TOKEN_COLORS[Math.floor(Math.random() * TOKEN_COLORS.length)],
  };
  socket && socket.emit("token-upsert", token);
  renderToken(token);
});

document.getElementById("btn-add-pc-token").addEventListener("click", () => {
  const character = savedCharacters[document.getElementById("session-character-select").value];
  if (!character) {
    alert('Save a character first (Character builder tab -> "Save character"), then pick it here.');
    return;
  }
  if (!socket) {
    alert("Join a session first.");
    return;
  }
  socket.emit("add-pc-token", { clientId: myClientId, character, fx: 0.12 + Math.random() * 0.1, fy: 0.12 + Math.random() * 0.1 });
});

document.getElementById("btn-add-monster-token").addEventListener("click", () => {
  const monsterId = document.getElementById("session-monster-select").value;
  if (!monsterId || !socket) return;
  const roll = document.getElementById("monster-roll-hp").checked;
  socket.emit("add-monster-token", { monsterId, fx: 0.55 + Math.random() * 0.1, fy: 0.12 + Math.random() * 0.1, roll });
});

// ---- Attack mode: click attacker -> pick an attack -> click target ----
let attackMode = false;
let selectedAttackerId = null;
let selectedAttackIndex = null;

document.getElementById("btn-attack-mode").addEventListener("click", (e) => {
  attackMode = !attackMode;
  selectedAttackerId = null;
  selectedAttackIndex = null;
  hideAttackMenu();
  e.target.textContent = `Attack mode: ${attackMode ? "on" : "off"}`;
  updateAttackStatus();
  refreshTokenSelectionStyles();
});

function updateAttackStatus() {
  const status = document.getElementById("attack-status");
  if (!attackMode) return (status.textContent = "");
  if (!selectedAttackerId) status.textContent = "Click your attacker's token.";
  else if (selectedAttackIndex === null) status.textContent = "Pick an attack.";
  else status.textContent = "Now click a target token.";
}

function refreshTokenSelectionStyles() {
  document.querySelectorAll(".token").forEach((el) => el.classList.remove("token-selected"));
  if (selectedAttackerId) {
    const el = document.getElementById(`token-${selectedAttackerId}`);
    if (el) el.classList.add("token-selected");
  }
}

function handleTokenClick(tokenId) {
  if (!attackMode) {
    openTokenPanel(tokenId);
    return;
  }
  if (!selectedAttackerId) {
    const t = latestTokens[tokenId];
    if (t && typeof t.hp === "number" && t.hp <= 0) {
      alert(`${t.name || t.label} is down (0 HP) and can't act.`);
      return;
    }
    selectedAttackerId = tokenId;
    selectedAttackIndex = null;
    showAttackMenu(tokenId);
  } else if (selectedAttackerId === tokenId) {
    selectedAttackerId = null;
    selectedAttackIndex = null;
    hideAttackMenu();
  } else if (selectedAttackIndex !== null) {
    const attacker = latestTokens[selectedAttackerId];
    const action = attacker && attacker.attacks && attacker.attacks[selectedAttackIndex];
    let slotLevel;
    if (action && action.spellLevel > 0) {
      const input = prompt(`Cast "${action.name}" at what slot level? (min ${action.spellLevel})`, String(action.spellLevel));
      if (input === null) return;
      slotLevel = Math.max(action.spellLevel, parseInt(input, 10) || action.spellLevel);
    }
    socket && socket.emit("attack-roll", { attackerTokenId: selectedAttackerId, targetTokenId: tokenId, attackIndex: selectedAttackIndex, slotLevel });
    selectedAttackerId = null;
    selectedAttackIndex = null;
    hideAttackMenu();
  }
  updateAttackStatus();
  refreshTokenSelectionStyles();
}

function showAttackMenu(tokenId) {
  const token = latestTokens[tokenId];
  const menu = document.getElementById("attack-menu");
  if (!token || !token.attacks || !token.attacks.length) {
    menu.style.display = "none";
    updateAttackStatus();
    return;
  }
  menu.innerHTML =
    `<div class="attack-menu-title">${token.name || token.label} — choose attack</div>` +
    token.attacks
      .map((a, i) => {
        let detail = "";
        if (a.type === "weapon" || a.type === "spell-attack") detail = `${fmtMod(a.toHit)} to hit, ${a.damage.count}d${a.damage.sides}${a.damage.mod ? fmtMod(a.damage.mod) : ""} ${a.damage.type}`;
        else if (a.type === "spell-save") detail = `${a.save.ability.toUpperCase()} save DC ${a.save.dc}, ${a.damage.count}d${a.damage.sides} ${a.damage.type}`;
        else if (a.type === "spell-auto") detail = `auto-hit, ${a.damage.count}d${a.damage.sides} ${a.damage.type}`;
        else if (a.type === "spell-heal") detail = `heal ${a.heal.count}d${a.heal.sides}${a.heal.mod ? fmtMod(a.heal.mod) : ""}`;
        const slot = a.spellLevel > 0 ? ` <span class="muted small">[Lv${a.spellLevel} slot]</span>` : "";
        return `<button type="button" class="attack-opt" data-idx="${i}">${a.name} <span class="muted small">${detail}</span>${slot}</button>`;
      })
      .join("");
  menu.style.display = "block";
  menu.querySelectorAll(".attack-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAttackIndex = Number(btn.dataset.idx);
      menu.querySelectorAll(".attack-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateAttackStatus();
    });
  });
}

function hideAttackMenu() {
  const menu = document.getElementById("attack-menu");
  if (menu) menu.style.display = "none";
}

// ---- Token detail panel (HP, conditions, rest, delete) ----
const CONDITIONS = ["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious", "Concentrating"];

function openTokenPanel(tokenId) {
  const token = latestTokens[tokenId];
  const panel = document.getElementById("token-panel");
  if (!token) return (panel.style.display = "none");
  const canEdit = myRole === "dm" || token.ownerClientId === myClientId || token.kind !== "pc";
  const hpLine =
    typeof token.hp === "number"
      ? `${token.hp} / ${token.maxHp} HP`
      : token.hpStatus
      ? `${token.hpStatus} (HP hidden by DM)`
      : "";

  panel.innerHTML = `
    <div class="token-panel-head">
      <b>${token.name || token.label}</b> <span class="muted small">${token.kind}${typeof token.ac === "number" ? ` · AC ${token.ac}` : ""}</span>
      <button type="button" class="link-btn" id="token-panel-close" style="float:right">Close</button>
    </div>
    <div class="muted small">${hpLine}</div>
    ${
      canEdit && typeof token.hp === "number"
        ? `<div class="field-row" style="margin-top:8px">
             <input id="token-hp-input" type="number" value="${token.hp}" style="width:80px" />
             <button type="button" class="secondary-btn" id="token-hp-set">Set HP</button>
             ${token.kind === "pc" ? `<button type="button" class="secondary-btn" id="token-rest">Long rest</button>` : ""}
             <button type="button" class="secondary-btn" id="token-delete">Remove token</button>
           </div>`
        : ""
    }
    ${renderSlotsLine(token)}
    <div class="conditions-wrap">${CONDITIONS.map(
      (c) => `<label class="cond-chip ${(token.conditions || []).includes(c) ? "on" : ""}"><input type="checkbox" data-cond="${c}" ${(token.conditions || []).includes(c) ? "checked" : ""} ${canEdit ? "" : "disabled"}> ${c}</label>`
    ).join("")}</div>
  `;
  panel.style.display = "block";
  panel.dataset.tokenId = tokenId;

  document.getElementById("token-panel-close").addEventListener("click", () => (panel.style.display = "none"));
  const hpSet = document.getElementById("token-hp-set");
  if (hpSet) hpSet.addEventListener("click", () => socket && socket.emit("token-set-hp", { tokenId, hp: Number(document.getElementById("token-hp-input").value) }));
  const rest = document.getElementById("token-rest");
  if (rest) rest.addEventListener("click", () => socket && socket.emit("token-long-rest", { tokenId }));
  const del = document.getElementById("token-delete");
  if (del) del.addEventListener("click", () => { socket && socket.emit("token-remove", { id: tokenId }); panel.style.display = "none"; });
  if (canEdit) {
    panel.querySelectorAll("[data-cond]").forEach((box) => {
      box.addEventListener("change", () => {
        const conds = Array.from(panel.querySelectorAll("[data-cond]")).filter((b) => b.checked).map((b) => b.dataset.cond);
        socket && socket.emit("token-set-conditions", { tokenId, conditions: conds });
      });
    });
  }
}

function renderSlotsLine(token) {
  if (!token.slots) return "";
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const total = token.slots[i] || 0;
    if (!total) continue;
    const used = (token.slotsUsed && token.slotsUsed[i]) || 0;
    parts.push(`Lv${i + 1}: ${total - used}/${total}`);
  }
  if (token.pactSlots) parts.push(`Pact Lv${token.pactSlots.level}: ${token.pactSlots.slots - (token.pactUsed || 0)}/${token.pactSlots.slots}`);
  return parts.length ? `<div class="muted small" style="margin-top:6px">Spell slots — ${parts.join(", ")}</div>` : "";
}

function renderToken(token) {
  const id = token.id;
  latestTokens[id] = { ...(latestTokens[id] || {}), ...token };

  let el = document.getElementById(`token-${id}`);
  if (!el) {
    el = document.createElement("div");
    el.className = "token";
    el.id = `token-${id}`;
    el.draggable = true;
    mapGrid.appendChild(el);
    el.addEventListener("dragend", (e) => {
      const { fx, fy } = eventFraction(e);
      const updated = { ...latestTokens[id], fx, fy };
      socket && socket.emit("token-upsert", updated);
      renderToken(updated);
    });
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handleTokenClick(id);
    });
  }

  const current = latestTokens[id];
  const fx = current.fx ?? 0.5;
  const fy = current.fy ?? 0.5;
  const downed = typeof current.hp === "number" && current.hp <= 0;
  el.className = `token token-${current.kind || "marker"}${selectedAttackerId === id ? " token-selected" : ""}${downed ? " token-downed" : ""}`;
  el.style.left = `calc(${fx * 100}% - 17px)`;
  el.style.top = `calc(${fy * 100}% - 17px)`;
  el.style.background = current.color;
  el.title = current.name ? `${current.name}${typeof current.ac === "number" ? ` (AC ${current.ac})` : ""}` : current.label;

  const hasHp = typeof current.hp === "number" && typeof current.maxHp === "number" && current.maxHp > 0;
  const hpPct = hasHp ? Math.max(0, Math.min(100, (current.hp / current.maxHp) * 100)) : 0;
  let hpBit = "";
  if (hasHp) {
    // PC (and DM-visible monster) HP shows the actual numbers; players see a
    // status word for gated monster HP.
    const numbers = current.kind === "pc" || current.kind === "monster" ? `<div class="token-hp-num">${current.hp}/${current.maxHp}</div>` : "";
    hpBit = `<div class="token-hp"><div class="token-hp-fill" style="width:${hpPct}%"></div></div>${numbers}`;
  } else if (current.hpStatus) {
    hpBit = `<div class="token-hp-status">${current.hpStatus}</div>`;
  }
  const downBadge = downed ? `<div class="token-down">DOWN</div>` : "";
  const condBit = (current.conditions || []).length ? `<div class="token-conds">${current.conditions.map((c) => c[0]).join("")}</div>` : "";
  el.innerHTML = `<span class="token-label">${current.label}</span>${hpBit}${downBadge}${condBit}`;
}

// ---- Distance measurement (drag on the map with Shift held, or measure mode) ----
let measuring = null;
mapGrid.addEventListener("mousedown", (e) => {
  if (!e.shiftKey) return;
  e.preventDefault();
  const { fx, fy } = eventFraction(e);
  measuring = { fx, fy };
});
mapGrid.addEventListener("mousemove", (e) => {
  if (!measuring) return;
  const { fx, fy } = eventFraction(e);
  const dcells = Math.hypot((fx - measuring.fx) * GRID_N, (fy - measuring.fy) * GRID_N);
  const feet = Math.round(dcells) * FEET_PER_CELL;
  const label = document.getElementById("measure-label");
  label.style.display = "block";
  label.textContent = `${feet} ft`;
  label.style.left = `${fx * 100}%`;
  label.style.top = `${fy * 100}%`;
});
window.addEventListener("mouseup", () => {
  measuring = null;
  const label = document.getElementById("measure-label");
  if (label) setTimeout(() => (label.style.display = "none"), 1200);
});

// ---- Map background + fog rendering ----
function applyMapState(map) {
  mapState = map || { background: "", fogEnabled: false, revealed: {} };
  mapGrid.style.backgroundImage = mapState.background ? `url("${CSS.escape ? mapState.background : mapState.background}")` : "";
  mapGrid.classList.toggle("has-bg", !!mapState.background);
  renderFog();
}

function renderFog() {
  if (!fogLayer) return;
  if (!mapState.fogEnabled) {
    fogLayer.style.display = "none";
    fogLayer.innerHTML = "";
    return;
  }
  fogLayer.style.display = "grid";
  let html = "";
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      const revealed = mapState.revealed[`${c},${r}`];
      html += `<div class="fog-cell ${revealed ? "revealed" : ""}" data-cell="${c},${r}"></div>`;
    }
  }
  fogLayer.innerHTML = html;
  // Painting is handled by the map click handler via event bubbling.
}

document.getElementById("btn-map-bg").addEventListener("click", () => {
  const url = prompt("Map background image URL (leave blank to clear):", mapState.background || "");
  if (url === null) return;
  socket && socket.emit("map-set-background", { url: url.trim() });
});
document.getElementById("btn-fog-toggle").addEventListener("click", () => socket && socket.emit("map-toggle-fog"));
document.getElementById("btn-fog-paint").addEventListener("click", (e) => {
  fogPaintMode = !fogPaintMode;
  e.target.textContent = `Paint fog: ${fogPaintMode ? "on" : "off"}`;
  fogLayer.style.pointerEvents = fogPaintMode ? "auto" : "none";
  fogLayer.classList.toggle("painting", fogPaintMode);
});

// Clicking (or dragging across) fog cells in paint mode reveals/hides them.
function paintCell(target) {
  if (!fogPaintMode || myRole !== "dm" || !target.classList.contains("fog-cell")) return;
  const cell = target.dataset.cell;
  socket && socket.emit("map-reveal-cell", { cell, revealed: !mapState.revealed[cell] });
}
fogLayer.addEventListener("click", (e) => paintCell(e.target));
document.getElementById("btn-fog-reveal-all").addEventListener("click", () => socket && socket.emit("map-reveal-all", { revealed: true }));
document.getElementById("btn-fog-hide-all").addEventListener("click", () => socket && socket.emit("map-reveal-all", { revealed: false }));

// ---- Dice ----
document.getElementById("btn-roll-dice").addEventListener("click", () => {
  const formula = document.getElementById("dice-formula").value.trim();
  const result = rollFormula(formula);
  if (result === null) return;
  const secret = myRole === "dm" && document.getElementById("dice-secret").checked;
  const roll = { formula, ...result, roller: myUserName || "Someone", secret };
  // The server echoes this back to everyone in the room, including us, so
  // only append locally when there's no session to echo it from.
  if (socket) {
    socket.emit("dice-roll", roll);
  } else {
    appendLogEntry({ ...roll, at: Date.now() });
  }
});

function rollFormula(formula) {
  const match = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(formula.replace(/\s+/g, ""));
  if (!match) {
    alert('Use a format like "1d20+5" or "2d6".');
    return null;
  }
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3].replace(/\s+/g, ""), 10) : 0;
  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = 1 + Math.floor(Math.random() * sides);
    rolls.push(r);
    total += r;
  }
  total += modifier;
  return { rolls, modifier, total };
}

// ---- Chat ----
document.getElementById("btn-send-chat").addEventListener("click", () => {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const msg = { text, from: myUserName || "Someone" };
  if (socket) {
    socket.emit("chat-message", msg);
  } else {
    appendLogEntry({ ...msg, at: Date.now() });
  }
  input.value = "";
});

function appendLogEntry(entry) {
  const feed = document.getElementById("log-feed");
  const div = document.createElement("div");
  if (entry.combat) {
    div.className = "entry combat";
    div.innerHTML = renderCombatEntry(entry);
  } else if (entry.formula) {
    div.className = "entry dice";
    div.innerHTML = `<span class="who">${entry.roller}</span>${entry.formula} &rarr; [${entry.rolls.join(", ")}]${
      entry.modifier ? fmtMod(entry.modifier) : ""
    } = <b>${entry.total}</b>${entry.secret ? ' <span class="muted small">(secret)</span>' : ""}`;
  } else {
    div.className = "entry";
    div.innerHTML = `<span class="who">${entry.from}:</span>${escapeHtml(entry.text)}`;
  }
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// ---- Dice roll animation ----
let diceAnimTimer = null;
let diceAnimInterval = null;

function animateRoll(finalValue, caption) {
  const overlay = document.getElementById("dice-overlay");
  const cube = overlay.querySelector(".dice-cube");
  const face = document.getElementById("dice-face");
  const cap = document.getElementById("dice-caption");
  clearTimeout(diceAnimTimer);
  clearInterval(diceAnimInterval);

  overlay.classList.add("show");
  cube.classList.add("rolling");
  cube.classList.remove("settled");
  cap.textContent = "rolling…";

  diceAnimInterval = setInterval(() => {
    face.textContent = 1 + Math.floor(Math.random() * 20);
  }, 60);

  diceAnimTimer = setTimeout(() => {
    clearInterval(diceAnimInterval);
    cube.classList.remove("rolling");
    cube.classList.add("settled");
    face.textContent = finalValue;
    cap.textContent = caption || "";
    diceAnimTimer = setTimeout(() => overlay.classList.remove("show"), 1100);
  }, 650);
}

// Picks the headline number/caption to show for a live roll or combat result.
function animateForEntry(e) {
  if (e.combat) {
    if (e.kind === "attack") animateRoll(e.d20, `${e.attackName}: ${e.toHitTotal} vs AC ${e.targetAc}`);
    else if (e.kind === "save") animateRoll(e.saveRoll, `${e.saveAbility.toUpperCase()} save ${e.saveTotal} vs DC ${e.saveDc}`);
    else if (e.kind === "auto" && e.damage) animateRoll(e.damage.total, `${e.attackName}: ${e.damage.total} damage`);
    else if (e.kind === "heal" && e.heal) animateRoll(e.heal.total, `${e.attackName}: ${e.heal.total} healed`);
  } else if (e.formula) {
    animateRoll(e.total, `${e.formula} = ${e.total}`);
  }
}

function renderCombatEntry(e) {
  const who = `<span class="who">${e.attackerName}</span>`;
  const slot = e.slotLevel ? ` <span class="muted small">(slot Lv${e.slotLevel})</span>` : "";
  if (e.kind === "no-slot" || e.kind === "downed") return `${who}${e.note}`;
  if (e.kind === "heal") return `${who}${e.attackName} heals ${e.targetName} for <b>${e.heal.total}</b>${slot}`;
  if (e.kind === "auto") return `${who}${e.attackName} hits ${e.targetName} for <b>${e.damage.total}</b> ${e.damage.type}${slot}`;
  if (e.kind === "save") {
    const outcome = e.saved ? "saves" : "fails";
    return `${who}${e.attackName} vs ${e.targetName}: ${e.saveAbility.toUpperCase()} save ${e.saveRoll} = ${e.saveTotal} vs DC ${e.saveDc} &mdash; <b>${outcome}</b>, <b>${e.damage.total}</b> ${e.damage.type}${slot}`;
  }
  // attack roll (weapon or spell-attack)
  const outcome = e.isFumble ? "fumbles!" : e.hit ? (e.isCrit ? "CRITS!" : "hits") : "misses";
  const dmg = e.hit && e.damage ? ` for <b>${e.damage.total}</b> ${e.damage.type}` : "";
  return `${who}${e.attackName || "Attack"} vs ${e.targetName}: ${e.d20}${fmtMod(e.bonus)} = ${e.toHitTotal} vs AC ${e.targetAc} &mdash; <b>${outcome}</b>${dmg}${slot}`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---- Voice & video (mesh WebRTC) ----
// Mesh means every participant connects directly to every other participant.
// That's simple and works well for a typical table (DM + 4-6 players), but
// don't expect it to hold up much past that -- each added participant adds
// another direct connection for everyone else to carry.
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
fetch("/api/ice-servers")
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg.iceServers) iceServers = cfg.iceServers;
  })
  .catch(() => {});

document.getElementById("btn-join-call").addEventListener("click", async () => {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    alert("Could not access camera/microphone: " + e.message);
    return;
  }
  addVideoTile("local", "You", localStream, true);
  document.getElementById("btn-toggle-mute").disabled = false;
  document.getElementById("btn-toggle-camera").disabled = false;
  document.getElementById("btn-screen-share").disabled = false;

  // Offer to everyone already known in the session.
  Object.keys(knownMembers).forEach((peerId) => {
    if (socket && peerId !== socket.id) ensurePeerConnection(peerId, true);
  });
});

document.getElementById("btn-toggle-mute").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Mute" : "Unmute";
});

document.getElementById("btn-toggle-camera").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Camera off" : "Camera on";
});

document.getElementById("btn-screen-share").addEventListener("click", async (e) => {
  if (!localStream) return;
  if (screenShareStream) {
    // Stop sharing: swap back to the camera track.
    screenShareStream.getTracks().forEach((t) => t.stop());
    screenShareStream = null;
    const camTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender && camTrack) sender.replaceTrack(camTrack);
    });
    addVideoTile("local", "You", localStream, true);
    e.target.textContent = "Share screen";
    return;
  }
  try {
    screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (err) {
    return; // user cancelled the picker
  }
  const screenTrack = screenShareStream.getVideoTracks()[0];
  Object.values(peerConnections).forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(screenTrack);
  });
  addVideoTile("local", "You (screen)", screenShareStream, true);
  e.target.textContent = "Stop sharing";
  screenTrack.addEventListener("ended", () => document.getElementById("btn-screen-share").click());
});

function ensurePeerConnection(peerId, initiator) {
  if (peerConnections[peerId]) return peerConnections[peerId];

  const pc = new RTCPeerConnection({ iceServers });
  peerConnections[peerId] = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("webrtc-signal", { to: peerId, signal: { candidate: e.candidate } });
    }
  };

  pc.ontrack = (e) => {
    const name = (knownMembers[peerId] && knownMembers[peerId].userName) || "Peer";
    addVideoTile(peerId, name, e.streams[0], false);
  };

  // If the connection drops (someone's wifi hiccups, a NAT rebinding, etc.)
  // try an ICE restart before giving up, so a transient blip doesn't kill
  // the call. Only the initiator side drives the renegotiation.
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed" && initiator) {
      try {
        pc.restartIce();
      } catch (_) {
        /* older browsers: fall back to a fresh renegotiation below */
      }
    }
  };

  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("webrtc-signal", { to: peerId, signal: pc.localDescription });
      } catch (_) {
        /* negotiation races are expected in mesh; the next event recovers */
      }
    };
  }

  return pc;
}

function addVideoTile(id, label, stream, muted) {
  let tile = document.getElementById(`video-tile-${id}`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = `video-tile-${id}`;
    tile.innerHTML = `<video autoplay playsinline ${muted ? "muted" : ""}></video><span class="tile-label">${label}</span>`;
    document.getElementById("video-grid").appendChild(tile);
  }
  tile.querySelector("video").srcObject = stream;
}

// ============ Compendium browser ============
const COMPENDIUM_CATS = [
  { key: "spells", label: "Spells" },
  { key: "monsters", label: "Monsters" },
  { key: "items", label: "Items" },
  { key: "races", label: "Races" },
  { key: "classes", label: "Classes" },
];
let compendiumCat = "spells";

function renderCompendiumTabs() {
  const wrap = document.getElementById("compendium-cats");
  if (!wrap) return;
  wrap.innerHTML = COMPENDIUM_CATS.map(
    (c) => `<button type="button" class="cat-btn ${c.key === compendiumCat ? "active" : ""}" data-cat="${c.key}">${c.label}</button>`
  ).join("");
  wrap.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      compendiumCat = btn.dataset.cat;
      renderCompendiumTabs();
      renderCompendiumFilters();
      renderCompendiumResults();
    });
  });
}

function renderCompendiumFilters() {
  const f1 = document.getElementById("compendium-filter-1");
  const f2 = document.getElementById("compendium-filter-2");
  if (!f1 || !f2) return;
  f1.style.display = "none";
  f2.style.display = "none";
  f1.innerHTML = "";
  f2.innerHTML = "";

  if (compendiumCat === "spells") {
    f1.style.display = "";
    f1.innerHTML =
      `<option value="">All levels</option>` +
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option value="${l}">${l === 0 ? "Cantrip" : "Level " + l}</option>`).join("");
    f2.style.display = "";
    const classIds = ["wizard", "cleric", "druid", "bard", "sorcerer", "warlock", "paladin", "ranger"];
    f2.innerHTML = `<option value="">All classes</option>` + classIds.map((c) => `<option value="${c}">${c[0].toUpperCase()}${c.slice(1)}</option>`).join("");
  } else if (compendiumCat === "monsters") {
    f1.style.display = "";
    const types = [...new Set(Object.values(contentStore.monsters || {}).map((m) => m.type))].sort();
    f1.innerHTML = `<option value="">All types</option>` + types.map((t) => `<option value="${t}">${t}</option>`).join("");
  } else if (compendiumCat === "items") {
    f1.style.display = "";
    f1.innerHTML =
      `<option value="">All item types</option>` +
      ["weapon", "armor", "gear", "magicItem"].map((t) => `<option value="${t}">${t}</option>`).join("");
  }
  f1.onchange = renderCompendiumResults;
  f2.onchange = renderCompendiumResults;
}

function crSortValue(cr) {
  if (!cr) return 0;
  if (String(cr).includes("/")) {
    const [a, b] = cr.split("/").map(Number);
    return a / b;
  }
  return Number(cr);
}

function abilityScoreCell(label, score) {
  const mod = Math.floor((score - 10) / 2);
  return `<div class="stat-ability"><div class="sa-label">${label}</div><div class="sa-score">${score}</div><div class="sa-mod">${fmtMod(mod)}</div></div>`;
}

function averageHpFromDice(notation) {
  const m = /(\d+)d(\d+)\s*([+-]\d+)?/i.exec(notation || "");
  if (!m) return null;
  const count = +m[1], sides = +m[2], mod = m[3] ? +m[3] : 0;
  return Math.max(1, Math.floor(count * ((sides + 1) / 2)) + mod);
}

function compendiumEntryHtml(cat, e) {
  const hb = e.source && e.source !== "core" ? ` <span class="src-hb">homebrew</span>` : "";
  let summary = e.name;
  let body = "";

  if (cat === "spells") {
    const lvl = e.level === 0 ? "Cantrip" : `Level ${e.level}`;
    summary = `${e.name} <span class="muted small">${lvl} &middot; ${e.school}</span>`;
    const comps = (e.components || []).join(", ") + (e.materials ? ` (${e.materials})` : "");
    body = `
      <div class="statblock-meta">
        <div><b>Level:</b> ${e.level === 0 ? "Cantrip" : e.level} (${e.school})</div>
        <div><b>Casting Time:</b> ${e.castingTime}</div>
        <div><b>Range:</b> ${e.range}</div>
        <div><b>Components:</b> ${comps}</div>
        <div><b>Duration:</b> ${e.concentration ? "Concentration, " : ""}${e.duration}${e.ritual ? " (ritual)" : ""}</div>
      </div>
      <p>${e.description}</p>
      ${e.damage ? `<p><b>Damage:</b> ${e.damage}</p>` : ""}
      ${e.healing ? `<p><b>Healing:</b> ${e.healing}</p>` : ""}
      ${e.higherLevels ? `<p><b>At Higher Levels.</b> ${e.higherLevels}</p>` : ""}
      <div class="muted small">Available to: ${(e.classes || []).map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")}</div>`;
  } else if (cat === "monsters") {
    summary = `${e.name} <span class="muted small">CR ${e.cr} &middot; ${e.type}</span>`;
    const a = e.abilities || {};
    const avg = averageHpFromDice(e.hitDice);
    const speedLine = `${e.speed} ft${e.flySpeed ? `, fly ${e.flySpeed} ft` : ""}${e.swimSpeed ? `, swim ${e.swimSpeed} ft` : ""}`;
    body = `
      ${e.description ? `<p class="flavor">${e.description}</p>` : ""}
      <div class="statblock-line">${e.size} ${e.type} &middot; Challenge ${e.cr}</div>
      <div class="statblock-meta">
        <div><b>Armor Class:</b> ${e.ac}</div>
        <div><b>Hit Points:</b> ${avg != null ? `${avg} (${e.hitDice})` : e.hitDice}</div>
        <div><b>Speed:</b> ${speedLine}</div>
      </div>
      <div class="stat-abilities">
        ${abilityScoreCell("STR", a.str)}${abilityScoreCell("DEX", a.dex)}${abilityScoreCell("CON", a.con)}
        ${abilityScoreCell("INT", a.int)}${abilityScoreCell("WIS", a.wis)}${abilityScoreCell("CHA", a.cha)}
      </div>
      ${(e.actions || []).length ? `<h4 class="statblock-h">Actions</h4><ul class="feature-list">${e.actions.map((act) => `<li><b>${act.name}.</b> ${act.description}</li>`).join("")}</ul>` : ""}`;
  } else if (cat === "items") {
    summary = `${e.name} <span class="muted small">${itemTypeLabel(e.itemType)}</span>`;
    if (e.itemType === "weapon") {
      body = `
        <div class="statblock-line">${cap(e.category)} ${e.kind} weapon</div>
        <div class="statblock-meta">
          <div><b>Damage:</b> ${e.damage} ${e.damageType}</div>
          <div><b>Properties:</b> ${(e.properties || []).length ? e.properties.join(", ") : "—"}</div>
          <div><b>Weight:</b> ${e.weight} lb</div>
          <div><b>Cost:</b> ${e.cost}</div>
        </div>`;
    } else if (e.itemType === "armor") {
      body = `
        <div class="statblock-line">${cap(e.category)} armor</div>
        <div class="statblock-meta">
          <div><b>Base AC:</b> ${e.baseAC}${e.dexBonus === "full" ? " + Dex" : e.dexBonus === "max2" ? " + Dex (max 2)" : ""}</div>
          <div><b>Strength:</b> ${e.strengthRequirement ? "Str " + e.strengthRequirement : "—"}</div>
          <div><b>Stealth:</b> ${e.stealthDisadvantage ? "Disadvantage" : "Normal"}</div>
          <div><b>Weight:</b> ${e.weight} lb</div>
          <div><b>Cost:</b> ${e.cost}</div>
        </div>`;
    } else if (e.itemType === "gear") {
      body = `<p>${e.description || ""}</p><div class="muted small">${e.weight} lb &middot; ${e.cost}</div>`;
    } else {
      body = `
        <div class="statblock-line">${cap(e.rarity)} ${e.type || "wondrous item"}${e.attunement ? " (requires attunement)" : ""}</div>
        <p>${e.description || ""}</p>`;
    }
  } else if (cat === "races") {
    summary = `${e.name} <span class="muted small">Speed ${e.speed} ft &middot; ${e.size}</span>`;
    const asi = e.abilityScoreIncrease || {};
    const asiText = Object.entries(asi)
      .filter(([k]) => k !== "choice")
      .map(([k, v]) => (k === "all" ? `+${v} to all abilities` : `+${v} ${k.toUpperCase()}`))
      .join(", ") + (asi.choice ? `, +${asi.choice.amount} to ${asi.choice.count} of your choice` : "");
    body = `
      ${e.description ? `<p class="flavor">${e.description}</p>` : ""}
      <div class="statblock-meta">
        <div><b>Ability Scores:</b> ${asiText || "—"}</div>
        <div><b>Size:</b> ${e.size}</div>
        <div><b>Speed:</b> ${e.speed} ft</div>
        <div><b>Languages:</b> ${(e.languages || ["Common"]).join(", ")}</div>
      </div>
      <h4 class="statblock-h">Traits</h4>
      <ul class="feature-list">${(e.traits || []).map((t) => `<li><b>${t.name}.</b> ${t.description}</li>`).join("")}</ul>`;
  } else if (cat === "classes") {
    summary = `${e.name} <span class="muted small">d${e.hitDie} hit die</span>`;
    const lvl1 = (e.levels && e.levels[0] && e.levels[0].features) || e.level1Features || [];
    body = `
      ${e.description ? `<p class="flavor">${e.description}</p>` : ""}
      <div class="statblock-meta">
        <div><b>Hit Die:</b> d${e.hitDie}</div>
        <div><b>Primary:</b> ${(e.primaryAbility || []).map((x) => x.toUpperCase()).join("/") || "—"}</div>
        <div><b>Saves:</b> ${(e.savingThrowProficiencies || []).map((x) => x.toUpperCase()).join(", ")}</div>
        <div><b>Spellcasting:</b> ${e.spellcasting ? `${e.spellcasting.ability.toUpperCase()} (${e.spellcasting.type})` : "None"}</div>
        <div><b>Subclasses:</b> ${(e.subclasses || []).map((s) => s.name).join(", ") || "—"}</div>
      </div>
      ${lvl1.length ? `<h4 class="statblock-h">Level 1 Features</h4><ul class="feature-list">${lvl1.map((f) => `<li><b>${f.name}.</b> ${f.description}</li>`).join("")}</ul>` : ""}`;
  }

  return `<div class="compendium-entry">
    <div class="compendium-entry-header">${summary}${hb}</div>
    <div class="compendium-entry-body" style="display:none">${body}</div>
  </div>`;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function itemTypeLabel(t) {
  return { weapon: "Weapon", armor: "Armor", gear: "Gear", magicItem: "Magic Item" }[t] || t;
}

function renderCompendiumResults() {
  const searchEl = document.getElementById("compendium-search");
  const container = document.getElementById("compendium-results");
  if (!searchEl || !container) return;
  const search = searchEl.value.trim().toLowerCase();
  const f1 = document.getElementById("compendium-filter-1").value;
  const f2 = document.getElementById("compendium-filter-2").value;

  let entries = Object.values(contentStore[compendiumCat] || {});
  if (search) entries = entries.filter((e) => e.name.toLowerCase().includes(search));

  if (compendiumCat === "spells") {
    if (f1 !== "") entries = entries.filter((e) => e.level === Number(f1));
    if (f2) entries = entries.filter((e) => (e.classes || []).includes(f2));
    entries.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  } else if (compendiumCat === "monsters") {
    if (f1) entries = entries.filter((e) => e.type === f1);
    entries.sort((a, b) => crSortValue(a.cr) - crSortValue(b.cr) || a.name.localeCompare(b.name));
  } else if (compendiumCat === "items") {
    if (f1) entries = entries.filter((e) => e.itemType === f1);
    entries.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  container.innerHTML = entries.length ? entries.map((e) => compendiumEntryHtml(compendiumCat, e)).join("") : `<p class="muted small">No matches.</p>`;
  container.querySelectorAll(".compendium-entry-header").forEach((header) => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling;
      body.style.display = body.style.display === "none" ? "block" : "none";
    });
  });
}

document.getElementById("compendium-search").addEventListener("input", renderCompendiumResults);

function refreshCompendium() {
  renderCompendiumTabs();
  renderCompendiumFilters();
  renderCompendiumResults();
}

// ============ Homebrew form builder ============
const HB_TYPES = [
  { key: "monsters", label: "Monster" },
  { key: "spells", label: "Spell" },
  { key: "items", label: "Item" },
  { key: "races", label: "Race" },
  { key: "classes", label: "Class" },
];
let hbFormType = "monsters";

function kebab(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "entry";
}

function hbField(id, label, opts = {}) {
  if (opts.type === "select") {
    return `<label>${label}<select id="hb-${id}">${opts.options.map((o) => `<option value="${o}">${o}</option>`).join("")}</select></label>`;
  }
  if (opts.type === "textarea") {
    return `<label>${label}<textarea id="hb-${id}" rows="3" placeholder="${opts.ph || ""}"></textarea></label>`;
  }
  return `<label>${label}<input id="hb-${id}" type="${opts.type || "text"}" placeholder="${opts.ph || ""}" value="${opts.value ?? ""}" /></label>`;
}
const hbVal = (id) => (document.getElementById(`hb-${id}`) ? document.getElementById(`hb-${id}`).value.trim() : "");
const hbNum = (id) => Number(hbVal(id)) || 0;

const HB_FORMS = {
  monsters: () => `
    ${hbField("m-name", "Name", { ph: "Frost Wight" })}
    <div class="field-row">
      ${hbField("m-size", "Size", { type: "select", options: ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] })}
      ${hbField("m-type", "Type", { type: "select", options: ["Humanoid", "Beast", "Undead", "Fiend", "Dragon", "Giant", "Monstrosity", "Ooze", "Plant", "Elemental", "Construct", "Celestial", "Fey", "Aberration"] })}
      ${hbField("m-cr", "CR", { ph: "3" })}
    </div>
    <div class="field-row">
      ${hbField("m-ac", "AC", { type: "number", value: 13 })}
      ${hbField("m-hd", "Hit dice", { ph: "5d8+10" })}
      ${hbField("m-speed", "Speed", { type: "number", value: 30 })}
    </div>
    <div class="ability-grid">
      ${["str", "dex", "con", "int", "wis", "cha"].map((k) => hbField(`m-${k}`, k.toUpperCase(), { type: "number", value: 10 })).join("")}
    </div>
    ${hbField("m-act-name", "Attack name", { ph: "Longsword" })}
    ${hbField("m-act-desc", "Attack description", { type: "textarea", ph: "Melee weapon attack: +5 to hit, 1d8+3 slashing damage." })}`,
  spells: () => `
    ${hbField("s-name", "Name", { ph: "Frost Lance" })}
    <div class="field-row">
      ${hbField("s-level", "Level (0=cantrip)", { type: "number", value: 1 })}
      ${hbField("s-school", "School", { type: "select", options: ["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"] })}
    </div>
    <div class="field-row">
      ${hbField("s-time", "Casting time", { ph: "1 action", value: "1 action" })}
      ${hbField("s-range", "Range", { ph: "60 feet", value: "60 feet" })}
    </div>
    ${hbField("s-classes", "Classes (comma-separated)", { ph: "wizard, sorcerer" })}
    ${hbField("s-desc", "Description", { type: "textarea" })}
    ${hbField("s-damage", "Damage (optional)", { ph: "3d8 cold" })}`,
  items: () => `
    ${hbField("i-name", "Name", { ph: "Flametongue Dagger" })}
    ${hbField("i-type", "Item type", { type: "select", options: ["weapon", "armor", "gear", "magicItem"] })}
    <div id="hb-item-extra">${hbItemExtra("weapon")}</div>`,
  races: () => `
    ${hbField("r-name", "Name", { ph: "Aarakocra" })}
    <div class="field-row">
      ${hbField("r-speed", "Speed", { type: "number", value: 30 })}
      ${hbField("r-size", "Size", { type: "select", options: ["Small", "Medium", "Large"] })}
    </div>
    <div class="field-row">
      ${hbField("r-asi-ability", "Ability bonus", { type: "select", options: ["str", "dex", "con", "int", "wis", "cha"] })}
      ${hbField("r-asi-amount", "Amount", { type: "number", value: 2 })}
    </div>
    ${hbField("r-trait-name", "Trait name", { ph: "Flight" })}
    ${hbField("r-trait-desc", "Trait description", { type: "textarea" })}`,
  classes: () => `
    ${hbField("c-name", "Name", { ph: "Gunslinger" })}
    ${hbField("c-hitdie", "Hit die (6/8/10/12)", { type: "number", value: 10 })}
    ${hbField("c-saves", "Saving throw profs (comma)", { ph: "dex, wis" })}
    ${hbField("c-feat-name", "Level 1 feature name", { ph: "Trick Shot" })}
    ${hbField("c-feat-desc", "Feature description", { type: "textarea" })}`,
};

function hbItemExtra(type) {
  if (type === "weapon")
    return `<div class="field-row">${hbField("i-category", "Category", { type: "select", options: ["simple", "martial"] })}${hbField("i-kind", "Kind", { type: "select", options: ["melee", "ranged"] })}</div>
      <div class="field-row">${hbField("i-damage", "Damage", { ph: "1d6" })}${hbField("i-dtype", "Damage type", { ph: "slashing" })}</div>
      ${hbField("i-props", "Properties (comma)", { ph: "finesse, light" })}
      <div class="field-row">${hbField("i-weight", "Weight", { type: "number", value: 2 })}${hbField("i-cost", "Cost", { ph: "10 gp" })}</div>`;
  if (type === "armor")
    return `${hbField("i-category", "Category", { type: "select", options: ["light", "medium", "heavy", "shield"] })}
      <div class="field-row">${hbField("i-baseac", "Base AC", { type: "number", value: 14 })}${hbField("i-dexbonus", "Dex bonus", { type: "select", options: ["full", "max2", "none"] })}</div>
      <div class="field-row">${hbField("i-weight", "Weight", { type: "number", value: 20 })}${hbField("i-cost", "Cost", { ph: "50 gp" })}</div>`;
  if (type === "gear")
    return `${hbField("i-desc", "Description", { type: "textarea" })}<div class="field-row">${hbField("i-weight", "Weight", { type: "number", value: 1 })}${hbField("i-cost", "Cost", { ph: "1 gp" })}</div>`;
  return `<div class="field-row">${hbField("i-rarity", "Rarity", { type: "select", options: ["common", "uncommon", "rare", "very rare", "legendary"] })}${hbField("i-mtype", "Type", { ph: "wondrous item" })}</div>
    ${hbField("i-desc", "Description", { type: "textarea" })}`;
}

function renderHbForm() {
  const tabs = document.getElementById("hb-type-tabs");
  tabs.innerHTML = HB_TYPES.map((t) => `<button type="button" class="cat-btn ${t.key === hbFormType ? "active" : ""}" data-hbtype="${t.key}">${t.label}</button>`).join("");
  tabs.querySelectorAll("[data-hbtype]").forEach((btn) =>
    btn.addEventListener("click", () => {
      hbFormType = btn.dataset.hbtype;
      renderHbForm();
    })
  );
  document.getElementById("hb-form").innerHTML = HB_FORMS[hbFormType]();
  if (hbFormType === "items") {
    const typeSel = document.getElementById("hb-i-type");
    typeSel.addEventListener("change", () => (document.getElementById("hb-item-extra").innerHTML = hbItemExtra(typeSel.value)));
  }
}

function assembleHbEntry() {
  if (hbFormType === "monsters") {
    const name = hbVal("m-name");
    return name && {
      id: kebab(name), name, size: hbVal("m-size"), type: hbVal("m-type"), cr: hbVal("m-cr") || "1",
      ac: hbNum("m-ac"), hitDice: hbVal("m-hd") || "1d8", speed: hbNum("m-speed"),
      abilities: { str: hbNum("m-str"), dex: hbNum("m-dex"), con: hbNum("m-con"), int: hbNum("m-int"), wis: hbNum("m-wis"), cha: hbNum("m-cha") },
      actions: hbVal("m-act-name") ? [{ name: hbVal("m-act-name"), description: hbVal("m-act-desc") }] : [],
    };
  }
  if (hbFormType === "spells") {
    const name = hbVal("s-name");
    const e = { id: kebab(name), name, level: hbNum("s-level"), school: hbVal("s-school"), castingTime: hbVal("s-time"), range: hbVal("s-range"), description: hbVal("s-desc"), classes: hbVal("s-classes").split(",").map((c) => c.trim()).filter(Boolean) };
    if (hbVal("s-damage")) e.damage = hbVal("s-damage");
    return name && e;
  }
  if (hbFormType === "items") {
    const name = hbVal("i-name");
    const t = hbVal("i-type");
    const e = { id: kebab(name), name, itemType: t };
    if (t === "weapon") Object.assign(e, { category: hbVal("i-category"), kind: hbVal("i-kind"), damage: hbVal("i-damage"), damageType: hbVal("i-dtype"), properties: hbVal("i-props").split(",").map((p) => p.trim()).filter(Boolean), weight: hbNum("i-weight"), cost: hbVal("i-cost") });
    else if (t === "armor") Object.assign(e, { category: hbVal("i-category"), baseAC: hbNum("i-baseac"), dexBonus: hbVal("i-dexbonus"), weight: hbNum("i-weight"), cost: hbVal("i-cost") });
    else if (t === "gear") Object.assign(e, { description: hbVal("i-desc"), weight: hbNum("i-weight"), cost: hbVal("i-cost") });
    else Object.assign(e, { rarity: hbVal("i-rarity"), type: hbVal("i-mtype"), description: hbVal("i-desc") });
    return name && e;
  }
  if (hbFormType === "races") {
    const name = hbVal("r-name");
    return name && {
      id: kebab(name), name, speed: hbNum("r-speed"), size: hbVal("r-size"),
      abilityScoreIncrease: { [hbVal("r-asi-ability")]: hbNum("r-asi-amount") },
      traits: hbVal("r-trait-name") ? [{ name: hbVal("r-trait-name"), description: hbVal("r-trait-desc") }] : [],
    };
  }
  if (hbFormType === "classes") {
    const name = hbVal("c-name");
    return name && {
      id: kebab(name), name, hitDie: hbNum("c-hitdie") || 8,
      savingThrowProficiencies: hbVal("c-saves").split(",").map((s) => s.trim()).filter(Boolean),
      spellcasting: null, subclassLevel: 3, subclasses: [], asiLevels: [4, 8, 12, 16, 19],
      levels: [{ level: 1, features: hbVal("c-feat-name") ? [{ name: hbVal("c-feat-name"), description: hbVal("c-feat-desc") }] : [] }],
      level1Features: hbVal("c-feat-name") ? [{ name: hbVal("c-feat-name"), description: hbVal("c-feat-desc") }] : [],
      startingEquipment: [],
    };
  }
}

document.getElementById("btn-hb-form-submit").addEventListener("click", async () => {
  const status = document.getElementById("hb-form-status");
  const packName = document.getElementById("hb-form-pack").value.trim() || "my-homebrew";
  const entry = assembleHbEntry();
  if (!entry) {
    status.textContent = "Please fill in at least a name.";
    return;
  }
  const pack = { packName, [hbFormType]: { [entry.id]: entry } };
  const res = await fetch("/api/homebrew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pack) });
  const data = await res.json();
  if (!data.ok) {
    status.textContent = "Error: " + data.error;
    return;
  }
  contentStore = data.content;
  status.textContent = `Added "${entry.name}" to pack "${data.packName}". It's now available in the builder and Compendium.`;
  populateBuilderOptions();
  renderContentSummary();
  populateSessionMonsterSelect();
  refreshCompendium();
});

// ============ Init ============
updateAccountUI();
loadContent();
loadCharacters();
refreshCompendium();
renderHbForm();
