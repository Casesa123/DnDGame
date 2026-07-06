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
  const res = await fetch("/api/characters");
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
      await fetch(`/api/characters/${btn.dataset.deleteCharacter}`, { method: "DELETE" });
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

  const res = await fetch("/api/characters/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, raceId, classLevels, baseAbilityScores, spellChoices, equippedArmorId, equippedShieldId }),
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
    headers: { "Content-Type": "application/json" },
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
    Object.values(state.tokens || {}).forEach(renderToken);
    Object.assign(knownMembers, state.members || {});
    (state.chatLog || [])
      .concat(state.diceLog || [])
      .concat((state.combatLog || []).map((e) => ({ combat: true, ...e })))
      .sort((a, b) => a.at - b.at)
      .forEach(appendLogEntry);
    if (myRole === "dm") {
      document.getElementById("dm-note-log").innerHTML = "";
      (state.dmNotes || []).forEach(appendDmNote);
      renderDmTools();
    }
  });

  socket.on("dm-note", appendDmNote);

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
  });
  socket.on("token-remove", ({ id }) => {
    const el = document.getElementById(`token-${id}`);
    if (el) el.remove();
    delete latestTokens[id];
    if (myRole === "dm") renderDmTools();
  });

  socket.on("initiative-update", (order) => {
    initiativeOrder = order;
    renderInitiative();
  });

  socket.on("dice-roll", appendLogEntry);
  socket.on("chat-message", appendLogEntry);
  socket.on("attack-result", (entry) => appendLogEntry({ combat: true, ...entry }));

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
const mapGrid = document.getElementById("map-grid");
let tokenCounter = 0;
const latestTokens = {}; // id -> most recent known token data (for drag + attack lookups)

mapGrid.addEventListener("click", (e) => {
  if (e.target !== mapGrid) return;
  const rect = mapGrid.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const label = prompt("Token label (e.g. initials):", "T" + ++tokenCounter);
  if (label === null) return;
  const token = {
    id: `${socket ? socket.id : "local"}-${Date.now()}`,
    kind: "marker",
    x,
    y,
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
  socket.emit("add-pc-token", {
    clientId: myClientId,
    character,
    x: 60 + Math.random() * 60,
    y: 60 + Math.random() * 60,
  });
});

document.getElementById("btn-add-monster-token").addEventListener("click", () => {
  const monsterId = document.getElementById("session-monster-select").value;
  if (!monsterId || !socket) return;
  socket.emit("add-monster-token", { monsterId, x: 220 + Math.random() * 60, y: 60 + Math.random() * 60 });
});

// ---- Attack mode: click your token, then a target token, to roll an attack ----
let attackMode = false;
let selectedAttackerId = null;

document.getElementById("btn-attack-mode").addEventListener("click", (e) => {
  attackMode = !attackMode;
  selectedAttackerId = null;
  e.target.textContent = `Attack mode: ${attackMode ? "on" : "off"}`;
  updateAttackStatus();
  refreshTokenSelectionStyles();
});

function updateAttackStatus() {
  const status = document.getElementById("attack-status");
  if (!attackMode) {
    status.textContent = "";
    return;
  }
  status.textContent = selectedAttackerId ? "Now click a target token." : "Click your attacker's token.";
}

function refreshTokenSelectionStyles() {
  document.querySelectorAll(".token").forEach((el) => el.classList.remove("token-selected"));
  if (selectedAttackerId) {
    const el = document.getElementById(`token-${selectedAttackerId}`);
    if (el) el.classList.add("token-selected");
  }
}

function handleTokenClick(tokenId) {
  if (!attackMode) return;
  if (!selectedAttackerId) {
    selectedAttackerId = tokenId;
  } else if (selectedAttackerId === tokenId) {
    selectedAttackerId = null;
  } else {
    socket && socket.emit("attack-roll", { attackerTokenId: selectedAttackerId, targetTokenId: tokenId });
    selectedAttackerId = null;
  }
  updateAttackStatus();
  refreshTokenSelectionStyles();
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
      const rect = mapGrid.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const updated = { ...latestTokens[id], x, y };
      socket && socket.emit("token-upsert", updated);
      renderToken(updated);
    });
    el.addEventListener("click", () => handleTokenClick(id));
  }

  const current = latestTokens[id];
  el.className = `token token-${current.kind || "marker"}${selectedAttackerId === id ? " token-selected" : ""}`;
  el.style.left = `${current.x - 17}px`;
  el.style.top = `${current.y - 17}px`;
  el.style.background = current.color;
  el.title = current.name ? `${current.name}${typeof current.ac === "number" ? ` (AC ${current.ac})` : ""}` : current.label;

  const hasHp = typeof current.hp === "number" && typeof current.maxHp === "number" && current.maxHp > 0;
  const hpPct = hasHp ? Math.max(0, Math.min(100, (current.hp / current.maxHp) * 100)) : 0;
  const hpBit = hasHp
    ? `<div class="token-hp"><div class="token-hp-fill" style="width:${hpPct}%"></div></div>`
    : current.hpStatus
    ? `<div class="token-hp-status">${current.hpStatus}</div>`
    : "";
  el.innerHTML = `<span class="token-label">${current.label}</span>${hpBit}`;
}

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
    const outcome = entry.isFumble ? "fumbles!" : entry.hit ? (entry.isCrit ? "CRITS!" : "hits") : "misses";
    const dmg = entry.hit && entry.damage ? ` for <b>${entry.damage.total}</b> damage` : "";
    div.innerHTML = `<span class="who">${entry.attackerName}</span>${entry.attackName || "Attack"} vs ${
      entry.targetName
    }: ${entry.d20}${fmtMod(entry.bonus)} = ${entry.toHitTotal} vs AC ${entry.targetAc} &mdash; <b>${outcome}</b>${dmg}`;
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

  if (initiator) {
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc-signal", { to: peerId, signal: pc.localDescription });
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

function compendiumEntryHtml(cat, e) {
  const hb = e.source && e.source !== "core" ? ` <span class="src-hb">homebrew</span>` : "";
  let summary = e.name;
  let body = "";

  if (cat === "spells") {
    summary = `${e.name} <span class="muted small">${e.level === 0 ? "Cantrip" : "Lv" + e.level} &middot; ${e.school}</span>`;
    body = `
      <div class="muted small">${e.castingTime} &middot; ${e.range} &middot; ${(e.components || []).join(", ")} &middot; ${e.duration}${e.ritual ? " &middot; ritual" : ""}</div>
      <p>${e.description}</p>
      ${e.damage ? `<div class="muted small">Damage: ${e.damage}</div>` : ""}
      ${e.healing ? `<div class="muted small">Healing: ${e.healing}</div>` : ""}
      ${e.higherLevels ? `<div class="muted small">At higher levels: ${e.higherLevels}</div>` : ""}
      <div class="muted small">Classes: ${(e.classes || []).join(", ")}</div>`;
  } else if (cat === "monsters") {
    summary = `${e.name} <span class="muted small">CR ${e.cr} &middot; ${e.type}</span>`;
    const a = e.abilities || {};
    body = `
      <div class="muted small">AC ${e.ac} &middot; HP ${e.hitDice} &middot; Speed ${e.speed} ft${e.flySpeed ? `, fly ${e.flySpeed} ft` : ""}${e.swimSpeed ? `, swim ${e.swimSpeed} ft` : ""}</div>
      <div class="muted small">STR ${a.str} DEX ${a.dex} CON ${a.con} INT ${a.int} WIS ${a.wis} CHA ${a.cha}</div>
      <ul class="feature-list">${(e.actions || []).map((act) => `<li><b>${act.name}.</b> ${act.description}</li>`).join("")}</ul>`;
  } else if (cat === "items") {
    summary = `${e.name} <span class="muted small">${e.itemType}</span>`;
    if (e.itemType === "weapon") {
      body = `<div class="muted small">${e.category} &middot; ${e.kind} &middot; ${e.damage} ${e.damageType} &middot; ${(e.properties || []).join(", ")} &middot; ${e.weight} lb &middot; ${e.cost}</div>`;
    } else if (e.itemType === "armor") {
      body = `<div class="muted small">${e.category} &middot; AC ${e.baseAC} (${e.dexBonus}) &middot; Str req ${e.strengthRequirement || "none"}${e.stealthDisadvantage ? " &middot; stealth disadvantage" : ""} &middot; ${e.weight} lb &middot; ${e.cost}</div>`;
    } else if (e.itemType === "gear") {
      body = `<p>${e.description}</p><div class="muted small">${e.weight} lb &middot; ${e.cost}</div>`;
    } else {
      body = `<div class="muted small">${e.rarity} ${e.type}${e.attunement ? ", requires attunement" : ""}</div><p>${e.description}</p>`;
    }
  } else if (cat === "races") {
    summary = `${e.name} <span class="muted small">Speed ${e.speed} ft &middot; ${e.size}</span>`;
    body = `<ul class="feature-list">${(e.traits || []).map((t) => `<li><b>${t.name}.</b> ${t.description}</li>`).join("")}</ul>`;
  } else if (cat === "classes") {
    summary = `${e.name} <span class="muted small">d${e.hitDie} hit die</span>`;
    body = `
      <div class="muted small">Saving throws: ${(e.savingThrowProficiencies || []).join(", ")}</div>
      <div class="muted small">Subclasses: ${(e.subclasses || []).map((s) => s.name).join(", ") || "none"}</div>
      <div class="muted small">${e.spellcasting ? `Spellcasting: ${e.spellcasting.ability.toUpperCase()} (${e.spellcasting.type})` : "No spellcasting"}</div>`;
  }

  return `<div class="compendium-entry">
    <div class="compendium-entry-header">${summary}${hb}</div>
    <div class="compendium-entry-body" style="display:none">${body}</div>
  </div>`;
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

// ============ Init ============
loadContent();
loadCharacters();
refreshCompendium();
