import OBR from "@owlbear-rodeo/sdk";
import { SPELLS, getSpellcastingDC, getSaveMod, tokensInRadius, rollSave, parseDamageNotation, DPI_PER_FOOT } from "./spells.js";
import { CONDITIONS, getConditionPenalty, shouldAutoFailSave } from "./conditions.js";
import { playSfx } from "./sfx.js";

const METADATA_KEY = "com.dnd-hotbar/character";
const INIT_METADATA_KEY = "com.dnd-hotbar/initiative";
const COND_METADATA_KEY = "com.dnd-hotbar/conditions";
const PROXY_URL = import.meta.env.VITE_PROXY_URL || "";
const DICE_CHANNEL = "com.dnd-hotbar/dice";
const DICE_MODAL_ID = "com.dnd-hotbar/dice-modal";

// ── DOM refs ──
const hotbar = document.getElementById("hotbar");
const tokenNameEl = document.getElementById("token-name");
const statsBar = document.getElementById("stats-bar");
const conditionBar = document.getElementById("condition-bar");
const linkPanel = document.getElementById("link-panel");
const linkInput = document.getElementById("link-input");
const linkBtn = document.getElementById("link-btn");
const linkStatus = document.getElementById("link-status");
const unlinkBtn = document.getElementById("unlink-btn");
const errorBanner = document.getElementById("error-banner");
const errorTitleText = document.getElementById("error-title-text");
const errorHintText = document.getElementById("error-hint-text");
const errorDismiss = document.getElementById("error-dismiss");
const combatOverlay = document.getElementById("combat-overlay");
const combatStatus = document.getElementById("combat-status");
const combatDetail = document.getElementById("combat-detail");
const combatCancel = document.getElementById("combat-cancel");
const combatLog = document.getElementById("combat-log");

// Spell picker
const spellPicker = document.getElementById("spell-picker");
const spellGrid = document.getElementById("spell-grid");
const spellCancel = document.getElementById("spell-cancel");

// Condition picker
const conditionPicker = document.getElementById("condition-picker");
const condGrid = document.getElementById("cond-grid");
const condCancel = document.getElementById("cond-cancel");

// AoE results
const aoeResults = document.getElementById("aoe-results");
const aoeTitle = document.getElementById("aoe-title");
const aoeTargetList = document.getElementById("aoe-target-list");

// Monster importer
const monsterJson = document.getElementById("monster-json");
const monsterApplyBtn = document.getElementById("monster-apply-btn");
const monsterStatus = document.getElementById("monster-status");

// Initiative
const initiativeBar = document.getElementById("initiative-bar");
const initTrack = document.getElementById("init-track");
const initRoundEl = document.getElementById("init-round");
const initRollBtn = document.getElementById("init-roll-btn");
const initNextBtn = document.getElementById("init-next-btn");
const initEndBtn = document.getElementById("init-end-btn");

// ── State ──
let currentTokenId = null;
let currentCharData = null;
let currentConditions = [];
let diceModalOpen = false;

// Combat state machine
const COMBAT = { IDLE: "IDLE", TARGETING: "TARGETING", ROLLING_ATTACK: "ROLLING_ATTACK", ROLLING_DAMAGE: "ROLLING_DAMAGE", AOE_CASTING: "AOE_CASTING" };
let combatState = COMBAT.IDLE;
let combatAction = null;
let attackerData = null;
let attackerTokenId = null;
let targetTokenId = null;
let targetData = null;
let pendingRollId = null;
let attackRollResult = null;
let selectedSpell = null;
let floaterModalOpen = false;

const FLOATER_CHANNEL = "com.dnd-hotbar/floater";
const FLOATER_MODAL_ID = "com.dnd-hotbar/floater-modal";
const SFX_CHANNEL = "com.dnd-hotbar/sfx";

// ── Error helpers ──
function showError(title, hint) { errorTitleText.textContent = title; errorHintText.textContent = hint || ""; errorBanner.classList.add("visible"); }
function hideError() { errorBanner.classList.remove("visible"); }
errorDismiss.addEventListener("click", hideError);

// ── Combat log ──
function logCombat(html, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = html;
  combatLog.prepend(entry);
  combatLog.classList.remove("hidden");
  while (combatLog.children.length > 20) combatLog.removeChild(combatLog.lastChild);
}

// ── Combat overlay ──
function showCombatOverlay(status, detail = "") { combatStatus.textContent = status; combatDetail.textContent = detail; combatOverlay.classList.add("visible"); }
function hideCombatOverlay() { combatOverlay.classList.remove("visible"); }

combatCancel.addEventListener("click", () => { resetCombat(); OBR.notification.show("Combat cancelled.", "INFO"); });

function resetCombat() {
  combatState = COMBAT.IDLE;
  combatAction = null;
  attackerData = null;
  attackerTokenId = null;
  targetTokenId = null;
  targetData = null;
  pendingRollId = null;
  attackRollResult = null;
  selectedSpell = null;
  diceModalOpen = false;
  floaterModalOpen = false;
  hideCombatOverlay();
  hideSpellPicker();
  hideAoeResults();
  document.querySelectorAll(".hotbar-btn").forEach((b) => b.classList.remove("active-action"));
}

// ════════════════════════════════════════
// SPELL PICKER
// ════════════════════════════════════════

function buildSpellGrid() {
  spellGrid.innerHTML = "";
  for (const [key, spell] of Object.entries(SPELLS)) {
    const card = document.createElement("div");
    card.className = "spell-card";
    card.dataset.spellKey = key;
    const tags = [];
    if (spell.isAoE) tags.push(`<span class="spell-tag aoe">AoE ${spell.aoeRadius}ft</span>`);
    if (spell.save) tags.push(`<span class="spell-tag save">${spell.save} Save</span>`);
    tags.push(`<span class="spell-tag dmg">${spell.damage} ${spell.damageType}</span>`);
    card.innerHTML = `
      <div class="spell-name">${spell.name}</div>
      <div class="spell-info">Lv.${spell.level} — ${spell.description}</div>
      <div class="spell-tags">${tags.join("")}</div>
    `;
    card.addEventListener("click", () => onSpellSelected(key, spell));
    spellGrid.appendChild(card);
  }
}

function showSpellPicker() {
  buildSpellGrid();
  spellPicker.classList.add("visible");
  conditionPicker.classList.remove("visible");
}

function hideSpellPicker() {
  spellPicker.classList.remove("visible");
}

spellCancel.addEventListener("click", () => {
  hideSpellPicker();
  resetCombat();
});

function onSpellSelected(key, spell) {
  selectedSpell = { key, ...spell };
  hideSpellPicker();

  if (spell.isAoE) {
    combatState = COMBAT.AOE_CASTING;
    attackerData = { ...currentCharData };
    attackerTokenId = currentTokenId;
    document.querySelector(".hotbar-btn.spell")?.classList.add("active-action");
    showCombatOverlay(`${attackerData.name}: ${spell.name}`, "Click on a target token as the AoE center...");
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong> (${spell.aoeRadius}ft radius)`, "spell");
  } else {
    combatAction = "spell-targeted";
    attackerData = { ...currentCharData };
    attackerTokenId = currentTokenId;
    combatState = COMBAT.TARGETING;
    document.querySelector(".hotbar-btn.spell")?.classList.add("active-action");
    showCombatOverlay(`${attackerData.name}: ${spell.name}`, "Click on a target token...");
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong>`, "spell");
  }
}

// ════════════════════════════════════════
// AoE SPELL FLOW
// ════════════════════════════════════════

async function castAoeSpell(centerToken) {
  const spell = selectedSpell;
  const caster = attackerData;
  const dc = getSpellcastingDC(caster);

  showCombatOverlay(`${spell.name} — DC ${dc}`, "Finding targets in radius...");

  const allItems = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER");
  const centerPos = centerToken.position;
  const inRadius = tokensInRadius(centerPos, spell.aoeRadius, allItems.filter((i) => i.id !== attackerTokenId));

  if (inRadius.length === 0) {
    logCombat(`<strong>${spell.name}</strong>: No targets in ${spell.aoeRadius}ft radius`, "spell");
    await OBR.notification.show(`${spell.name}: No targets in range.`, "WARNING");
    resetCombat();
    return;
  }

  const totalDamage = parseDamageNotation(spell.damage);
  const halfDamage = Math.floor(totalDamage / 2);

  logCombat(`<strong>${spell.name}</strong> deals <strong>${totalDamage}</strong> ${spell.damageType} damage (DC ${dc} ${spell.save})`, "spell");

  const results = [];

  for (const token of inRadius) {
    const meta = token.metadata?.[METADATA_KEY];
    const char = meta?.character;
    const name = char?.name || token.name || "Unknown";
    const conditions = token.metadata?.[COND_METADATA_KEY] || [];

    if (shouldAutoFailSave(conditions, spell.save)) {
      results.push({ token, char, name, saved: false, roll: 0, total: 0, autoFail: true, damage: totalDamage });
      logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition) — <strong class="damage">${totalDamage} ${spell.damageType}</strong>`, "spell");
      continue;
    }

    const saveMod = getSaveMod(char, spell.save);
    const { roll, total } = rollSave(saveMod);
    const saved = total >= dc;
    const dmg = saved ? halfDamage : totalDamage;

    results.push({ token, char, name, saved, roll, total, damage: dmg });

    const saveStr = saved
      ? `<strong class="hit">SAVE</strong> (${roll}+${saveMod}=${total})`
      : `<strong class="miss">FAIL</strong> (${roll}+${saveMod}=${total})`;
    const dmgStr = saved
      ? `<strong class="damage">${dmg}</strong> (half)`
      : `<strong class="damage">${dmg}</strong> (full)`;
    logCombat(`<strong>${name}</strong>: ${spell.save} ${saveStr} — ${dmgStr} ${spell.damageType}`, "spell");
  }

  // Apply damage to all targets
  const tokenIdsToUpdate = results.map((r) => r.token.id);
  await OBR.scene.items.updateItems(tokenIdsToUpdate, (items) => {
    for (const item of items) {
      const r = results.find((r) => r.token.id === item.id);
      if (!r || !r.char) continue;
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) continue;

      let remaining = r.damage;
      let temp = meta.character.hp.temp || 0;
      if (temp > 0) {
        const absorbed = Math.min(temp, remaining);
        temp -= absorbed;
        remaining -= absorbed;
      }
      meta.character.hp.current = Math.max(0, meta.character.hp.current - remaining);
      meta.character.hp.temp = temp;
      meta.lastUpdated = Date.now();
    }
  });

  await syncInitiativeHP();
  showAoeResults(spell, dc, results);

  // SFX + floating damage for all targets
  await broadcastSfx("spell");
  setTimeout(async () => {
    await broadcastSfx("damage");
    for (const r of results) {
      await showFloatingDamage(r.token.id, r.damage, spell.damageType, { isSpell: true });
      await new Promise((w) => setTimeout(w, 150));
    }
  }, 300);

  const hitCount = results.filter((r) => !r.saved).length;
  const saveCount = results.filter((r) => r.saved).length;
  await OBR.notification.show(
    `${spell.name}: ${totalDamage} ${spell.damageType} — ${hitCount} failed, ${saveCount} saved`,
    "SUCCESS"
  );

  showCombatOverlay(`${spell.name} Complete!`, `${results.length} targets hit`);
  setTimeout(() => resetCombat(), 4500);
}

function showAoeResults(spell, dc, results) {
  aoeTitle.textContent = `${spell.name} — DC ${dc} ${spell.save} Save`;
  aoeTargetList.innerHTML = results.map((r) => {
    const saveClass = r.saved ? "saved" : "failed";
    const dmgClass = r.saved ? "half" : "full";
    const saveText = r.autoFail ? "AUTO-FAIL" : `${r.roll}+${getSaveMod(r.char, spell.save)}=${r.total} ${r.saved ? "✓" : "✗"}`;
    return `
      <div class="aoe-target ${saveClass}">
        <span class="aoe-name">${r.name}</span>
        <span class="aoe-save-result">${saveText}</span>
        <span class="aoe-dmg ${dmgClass}">${r.damage} ${spell.damageType}</span>
      </div>
    `;
  }).join("");
  aoeResults.classList.add("visible");
}

function hideAoeResults() {
  aoeResults.classList.remove("visible");
}

// ════════════════════════════════════════
// FLOATING DAMAGE & SFX
// ════════════════════════════════════════

async function ensureFloaterModal() {
  if (floaterModalOpen) return;
  await OBR.modal.open({
    id: FLOATER_MODAL_ID,
    url: "/floater.html",
    fullScreen: true,
    hidePaper: true,
    hideBackdrop: true,
  });
  floaterModalOpen = true;
  await new Promise((r) => setTimeout(r, 500));
}

async function showFloatingDamage(tokenId, damage, damageType, options = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const pos = items[0].position;

    await ensureFloaterModal();
    await OBR.broadcast.sendMessage(FLOATER_CHANNEL, {
      damage,
      damageType,
      worldX: pos.x,
      worldY: pos.y,
      isCrit: options.isCrit || false,
      isSpell: options.isSpell || false,
      isHeal: options.isHeal || false,
    });
  } catch (err) {
    console.warn("Floater error:", err);
  }
}

function closeFloaterModal() {
  floaterModalOpen = false;
}

async function broadcastSfx(sound) {
  playSfx(sound);
  await OBR.broadcast.sendMessage(SFX_CHANNEL, { sound });
}

// ════════════════════════════════════════
// CONDITION SYSTEM
// ════════════════════════════════════════

function buildCondGrid() {
  condGrid.innerHTML = "";
  for (const [key, cond] of Object.entries(CONDITIONS)) {
    const card = document.createElement("div");
    card.className = "cond-card";
    card.dataset.condKey = key;
    if (currentConditions.includes(key)) card.classList.add("active-cond");
    card.innerHTML = `
      <span class="cond-icon">${cond.icon}</span>
      <div class="cond-info">
        <div class="cond-name">${cond.name}</div>
        <div class="cond-desc">${cond.effect}</div>
      </div>
    `;
    card.addEventListener("click", () => toggleCondition(key));
    condGrid.appendChild(card);
  }
}

function showConditionPicker() {
  buildCondGrid();
  conditionPicker.classList.add("visible");
  spellPicker.classList.remove("visible");
}

function hideConditionPicker() {
  conditionPicker.classList.remove("visible");
}

condCancel.addEventListener("click", hideConditionPicker);

async function toggleCondition(key) {
  if (!currentTokenId) return;
  const idx = currentConditions.indexOf(key);
  if (idx >= 0) currentConditions.splice(idx, 1);
  else currentConditions.push(key);

  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      item.metadata[COND_METADATA_KEY] = [...currentConditions];
    }
  });

  const cond = CONDITIONS[key];
  const action = idx >= 0 ? "removed" : "applied";
  logCombat(`${cond.icon} <strong>${cond.name}</strong> ${action} to <strong>${currentCharData?.name || "token"}</strong>`, "condition");

  buildCondGrid();
  renderConditionBadges();
}

function renderConditionBadges() {
  if (!currentConditions.length) {
    conditionBar.classList.add("hidden");
    return;
  }
  conditionBar.classList.remove("hidden");
  conditionBar.innerHTML = currentConditions.map((key) => {
    const c = CONDITIONS[key];
    if (!c) return "";
    return `<span class="cond-badge" data-cond="${key}" style="background:${c.color}22;color:${c.color};border-color:${c.color}">${c.icon} ${c.name}<span class="cond-x">✕</span></span>`;
  }).join("");

  conditionBar.querySelectorAll(".cond-badge").forEach((badge) => {
    badge.querySelector(".cond-x").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCondition(badge.dataset.cond);
    });
  });
}

// ════════════════════════════════════════
// LINK PANEL TABS
// ════════════════════════════════════════

document.querySelectorAll(".link-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".link-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".link-content").forEach((c) => c.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
  });
});

// ════════════════════════════════════════
// MONSTER JSON IMPORTER
// ════════════════════════════════════════

monsterApplyBtn.addEventListener("click", async () => {
  if (!currentTokenId) { setMonsterStatus("No token selected.", true); return; }

  const raw = monsterJson.value.trim();
  if (!raw) { setMonsterStatus("Paste monster JSON first.", true); return; }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    setMonsterStatus("Invalid JSON format.", true);
    return;
  }

  if (!parsed.name) { setMonsterStatus("JSON must have a 'name' field.", true); return; }

  const character = normalizeMonster(parsed);

  monsterApplyBtn.disabled = true;
  setMonsterStatus("Applying...", false);

  try {
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = {
          character,
          isMonster: true,
          lastUpdated: Date.now(),
        };
      }
    });

    currentCharData = character;
    showHotbar(character);
    linkPanel.classList.add("hidden");
    setMonsterStatus(`"${character.name}" applied!`, false, true);
    await OBR.notification.show(`Monster "${character.name}" linked!`, "SUCCESS");
  } catch (err) {
    setMonsterStatus("Failed to apply.", true);
  } finally {
    monsterApplyBtn.disabled = false;
  }
});

function setMonsterStatus(msg, isError = false, isSuccess = false) {
  monsterStatus.textContent = msg;
  monsterStatus.className = isError ? "error" : isSuccess ? "success" : "";
}

function normalizeMonster(m) {
  const rawStats = m.stats || {};
  const statNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const statKeys = ["str", "dex", "con", "int", "wis", "cha"];

  const stats = statNames.map((name, i) => {
    const val = rawStats[statKeys[i]] ?? 10;
    return { name, value: val, modifier: Math.floor((val - 10) / 2) };
  });

  const dexMod = stats[1].modifier;
  const conMod = stats[2].modifier;
  const hp = m.hp ?? 10;

  const weapons = (m.actions || []).map((a) => ({
    name: a.name || "Attack",
    equipped: true,
    type: a.type || "Simple Melee",
    damage: a.damage || "1d4",
    damageType: a.damageType || "Slashing",
    range: a.range || "5",
    properties: a.properties || [],
  }));

  const totalLevel = m.cr ? Math.max(1, Math.round(m.cr)) : 1;

  return {
    id: null,
    name: m.name,
    avatarUrl: null,
    race: m.type || "Monster",
    classes: [{ name: m.type || "Monster", level: totalLevel, subclass: null }],
    level: totalLevel,
    hp: { current: hp, max: hp, temp: 0 },
    stats,
    ac: m.ac ?? 10 + dexMod,
    proficiencyBonus: Math.ceil(totalLevel / 4) + 1,
    speed: m.speed ?? 30,
    weapons,
  };
}

// ════════════════════════════════════════
// INITIATIVE TRACKER
// ════════════════════════════════════════

async function getInitiativeState() {
  const roomMeta = await OBR.room.getMetadata();
  return roomMeta[INIT_METADATA_KEY] || null;
}

async function setInitiativeState(state) {
  await OBR.room.setMetadata({ [INIT_METADATA_KEY]: state });
}

function renderInitiative(state) {
  if (!state || !state.order || state.order.length === 0) {
    initiativeBar.classList.remove("visible");
    return;
  }

  initiativeBar.classList.add("visible");
  initRoundEl.textContent = `Round ${state.round || 1}`;

  initTrack.innerHTML = state.order.map((entry, i) => {
    const isActive = i === state.currentIndex;
    const hpPct = entry.hpMax > 0 ? (entry.hpCurrent / entry.hpMax) * 100 : 100;
    const isDown = entry.hpCurrent <= 0;
    let hpClass = "";
    if (isDown) hpClass = "down";
    else if (hpPct <= 25) hpClass = "critical";
    else if (hpPct <= 50) hpClass = "hurt";

    return `
      <div class="init-token ${isActive ? "active" : ""} ${isDown ? "dead" : ""}"
           data-token-id="${entry.tokenId}" title="${entry.name}">
        <span class="init-roll">${entry.initiative}</span>
        <span class="init-name">${entry.name}</span>
        <span class="init-hp ${hpClass}">${entry.hpCurrent}/${entry.hpMax}</span>
        ${entry.isMonster ? '<span class="init-badge monster">MON</span>' : ""}
      </div>
    `;
  }).join("");

  // Click to select token on the board
  initTrack.querySelectorAll(".init-token").forEach((el) => {
    el.addEventListener("click", () => {
      const tokenId = el.dataset.tokenId;
      if (tokenId) OBR.player.select([tokenId]);
    });
  });
}

// Roll Initiative: gather all CHARACTER tokens, roll 1d20 + DEX mod
initRollBtn.addEventListener("click", async () => {
  initRollBtn.disabled = true;
  initRollBtn.textContent = "Rolling...";

  try {
    const allItems = await OBR.scene.items.getItems((item) =>
      item.layer === "CHARACTER"
    );

    const entries = [];

    for (const item of allItems) {
      const meta = item.metadata?.[METADATA_KEY];
      const char = meta?.character;

      const dexMod = char?.stats?.find((s) => s.name === "DEX")?.modifier ?? 0;
      const roll = Math.floor(Math.random() * 20) + 1;
      const initiative = roll + dexMod;

      entries.push({
        tokenId: item.id,
        name: char?.name || item.name || "Unknown",
        initiative,
        roll,
        dexMod,
        hpCurrent: char?.hp?.current ?? 0,
        hpMax: char?.hp?.max ?? 0,
        ac: char?.ac ?? 10,
        isMonster: meta?.isMonster || false,
      });
    }

    entries.sort((a, b) => b.initiative - a.initiative);

    const state = {
      order: entries,
      currentIndex: 0,
      round: 1,
    };

    await setInitiativeState(state);

    const logLines = entries.map(
      (e) => `<strong>${e.name}</strong>: ${e.roll} + ${e.dexMod} = <strong>${e.initiative}</strong>`
    ).join(" | ");
    logCombat(`Initiative rolled! ${logLines}`, "init");

    await OBR.notification.show(`Initiative rolled for ${entries.length} combatants!`, "SUCCESS");

    // Select the first token
    if (entries.length > 0) {
      await OBR.player.select([entries[0].tokenId]);
    }
  } catch (err) {
    console.error("Initiative roll failed:", err);
    await OBR.notification.show("Initiative roll failed.", "ERROR");
  } finally {
    initRollBtn.disabled = false;
    initRollBtn.textContent = "Roll Initiative";
  }
});

// Next Turn
initNextBtn.addEventListener("click", async () => {
  const state = await getInitiativeState();
  if (!state || !state.order.length) return;

  // Refresh HP from token metadata before advancing
  const tokenIds = state.order.map((e) => e.tokenId);
  const items = await OBR.scene.items.getItems(tokenIds);

  for (const entry of state.order) {
    const item = items.find((i) => i.id === entry.tokenId);
    const char = item?.metadata?.[METADATA_KEY]?.character;
    if (char) {
      entry.hpCurrent = char.hp.current;
      entry.hpMax = char.hp.max;
    }
  }

  let nextIndex = state.currentIndex + 1;
  let nextRound = state.round;

  if (nextIndex >= state.order.length) {
    nextIndex = 0;
    nextRound++;
  }

  state.currentIndex = nextIndex;
  state.round = nextRound;

  await setInitiativeState(state);

  const current = state.order[nextIndex];
  await OBR.notification.show(`${current.name}'s turn! (Round ${nextRound})`, "INFO");
  await OBR.player.select([current.tokenId]);
});

// End Combat
initEndBtn.addEventListener("click", async () => {
  await setInitiativeState(null);
  logCombat("Combat ended.", "info");
  await OBR.notification.show("Combat ended.", "INFO");
});

// ── Init ──
hotbar.classList.add("hidden");
statsBar.classList.add("hidden");
linkPanel.classList.add("hidden");

OBR.onReady(async () => {
  const isReady = await OBR.scene.isReady();
  if (isReady) setupListeners();

  OBR.scene.onReadyChange((ready) => {
    if (ready) setupListeners();
    else { hideAll(); resetCombat(); }
  });

  // Listen for dice results
  OBR.broadcast.onMessage(`${DICE_CHANNEL}/result`, (event) => {
    diceModalOpen = false;
    const result = event.data;
    if (result.rollId !== pendingRollId) return;
    handleDiceResult(result);
  });

  // Listen for initiative state changes from other players
  OBR.room.onMetadataChange((metadata) => {
    const initState = metadata[INIT_METADATA_KEY] || null;
    renderInitiative(initState);
  });

  // Listen for SFX broadcasts from other players
  OBR.broadcast.onMessage(SFX_CHANNEL, (event) => {
    playSfx(event.data.sound);
  });

  // Track floater modal close
  OBR.broadcast.onMessage(FLOATER_CHANNEL, () => {
    // Reset floater state after a delay (modal auto-closes)
    setTimeout(() => { floaterModalOpen = false; }, 2500);
  });

  // Render initial initiative state
  const initState = await getInitiativeState();
  renderInitiative(initState);
});

// ── Selection listener ──
function setupListeners() {
  OBR.player.onChange(handleSelectionChange);
  handleSelectionChange();
}

async function handleSelectionChange() {
  const selection = await OBR.player.getSelection();

  if (combatState === COMBAT.AOE_CASTING && selection?.length > 0) {
    const items = await OBR.scene.items.getItems(selection);
    const center = items.find((i) => i.layer === "CHARACTER");
    if (center) await castAoeSpell(center);
    return;
  }

  if (combatState === COMBAT.TARGETING && selection?.length > 0) {
    const items = await OBR.scene.items.getItems(selection);
    const target = items.find((i) => i.layer === "CHARACTER" && i.id !== attackerTokenId);
    if (target) await pickTarget(target);
    return;
  }

  if (!selection || selection.length === 0) { hideAll(); return; }

  const items = await OBR.scene.items.getItems(selection);
  const token = items.find((i) => i.layer === "CHARACTER");

  if (!token) { hideAll(); return; }

  currentTokenId = token.id;
  const meta = token.metadata?.[METADATA_KEY];
  currentConditions = token.metadata?.[COND_METADATA_KEY] || [];

  if (meta?.character) {
    currentCharData = meta.character;
    showHotbar(currentCharData);
    renderConditionBadges();
    linkPanel.classList.add("hidden");
  } else {
    hideHotbar();
    showLinkPanel(token.name || "Token");
  }
}

// ════════════════════════════════════════
// COMBAT FLOW
// ════════════════════════════════════════

function enterTargeting(action) {
  if (!currentCharData || !currentTokenId) return;

  if (action === "spell") {
    showSpellPicker();
    return;
  }

  combatState = COMBAT.TARGETING;
  combatAction = action;
  attackerData = { ...currentCharData };
  attackerTokenId = currentTokenId;
  document.querySelector(`.hotbar-btn.${action}`)?.classList.add("active-action");
  showCombatOverlay(`${attackerData.name}: Attack`, "Click on an enemy token to select target...");
}

async function pickTarget(targetToken) {
  targetTokenId = targetToken.id;
  const meta = targetToken.metadata?.[METADATA_KEY];
  targetData = meta?.character || null;
  const targetName = targetData?.name || targetToken.name || "Target";
  const targetAC = targetData?.ac ?? "?";

  // Single-target save spell (Sacred Flame, Toll the Dead, Poison Spray)
  if (combatAction === "spell-targeted" && selectedSpell && selectedSpell.save) {
    await castSingleTargetSaveSpell(targetToken);
    return;
  }

  showCombatOverlay(`${attackerData.name} → ${targetName}`, `Rolling attack vs AC ${targetAC}...`);
  logCombat(`<strong>${attackerData.name}</strong> targets <strong>${targetName}</strong> (AC ${targetAC})`);

  combatState = COMBAT.ROLLING_ATTACK;
  const weapon = attackerData.weapons?.find((w) => w.equipped) || attackerData.weapons?.[0];
  let modifier, label;

  // Apply condition penalties to attack rolls
  const attackerConds = await getTokenConditions(attackerTokenId);
  const { penalty, bonus } = getConditionPenalty(attackerConds);

  if (combatAction === "spell") {
    const intMod = attackerData.stats.find((s) => s.name === "INT")?.modifier || 0;
    const wisMod = attackerData.stats.find((s) => s.name === "WIS")?.modifier || 0;
    const chaMod = attackerData.stats.find((s) => s.name === "CHA")?.modifier || 0;
    modifier = Math.max(intMod, wisMod, chaMod) + attackerData.proficiencyBonus;
    label = `${attackerData.name} Spell Attack → ${targetName}`;
  } else {
    modifier = getAttackMod(attackerData);
    const weaponName = weapon?.name || "Unarmed";
    label = `${attackerData.name} attacks ${targetName} with ${weaponName}`;
  }

  modifier += penalty + bonus;
  if (penalty) logCombat(`Condition penalty: ${penalty} to attack`, "condition");

  pendingRollId = crypto.randomUUID();
  await rollDice("1d20", label, modifier, pendingRollId);
}

async function getTokenConditions(tokenId) {
  if (!tokenId) return [];
  const items = await OBR.scene.items.getItems([tokenId]);
  return items[0]?.metadata?.[COND_METADATA_KEY] || [];
}

async function castSingleTargetSaveSpell(targetToken) {
  const spell = selectedSpell;
  const caster = attackerData;
  const dc = getSpellcastingDC(caster);
  const meta = targetToken.metadata?.[METADATA_KEY];
  const char = meta?.character;
  const name = char?.name || targetToken.name || "Target";
  const conditions = targetToken.metadata?.[COND_METADATA_KEY] || [];

  showCombatOverlay(`${spell.name} → ${name}`, `DC ${dc} ${spell.save} Save...`);
  logCombat(`<strong>${caster.name}</strong> casts <strong>${spell.name}</strong> at <strong>${name}</strong> (DC ${dc} ${spell.save})`, "spell");

  let saved, roll, total;
  if (shouldAutoFailSave(conditions, spell.save)) {
    saved = false; roll = 0; total = 0;
    logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "spell");
  } else {
    const saveMod = getSaveMod(char, spell.save);
    const result = rollSave(saveMod);
    roll = result.roll; total = result.total;
    saved = total >= dc;
    const saveStr = saved ? `<strong class="hit">SAVE</strong>` : `<strong class="miss">FAIL</strong>`;
    logCombat(`<strong>${name}</strong>: ${spell.save} Save ${roll}+${getSaveMod(char, spell.save)}=${total} ${saveStr}`, "spell");
  }

  const totalDamage = parseDamageNotation(spell.damage);
  const dmg = saved ? Math.floor(totalDamage / 2) : totalDamage;

  if (dmg > 0 && char) {
    await OBR.scene.items.updateItems([targetToken.id], (items) => {
      for (const item of items) {
        const m = item.metadata[METADATA_KEY];
        if (!m?.character) return;
        let remaining = dmg;
        let temp = m.character.hp.temp || 0;
        if (temp > 0) { const absorbed = Math.min(temp, remaining); temp -= absorbed; remaining -= absorbed; }
        m.character.hp.current = Math.max(0, m.character.hp.current - remaining);
        m.character.hp.temp = temp;
        m.lastUpdated = Date.now();
      }
    });
    await syncInitiativeHP();
  }

  const dmgLabel = saved ? `${dmg} (half)` : `${dmg} (full)`;
  logCombat(`<strong class="damage">${dmgLabel} ${spell.damageType}</strong> to <strong>${name}</strong>`, "spell");

  // SFX + floating damage
  await broadcastSfx("spell");
  if (dmg > 0) {
    setTimeout(async () => {
      await broadcastSfx("damage");
      await showFloatingDamage(targetToken.id, dmg, spell.damageType, { isSpell: true });
    }, 300);
  }

  await OBR.notification.show(`${spell.name}: ${name} ${saved ? "saves" : "fails"} — ${dmg} ${spell.damageType}`, saved ? "WARNING" : "SUCCESS");

  showCombatOverlay(`${spell.name}: ${saved ? "Saved!" : "Failed!"}`, `${dmg} ${spell.damageType} damage to ${name}`);
  setTimeout(() => resetCombat(), 3500);
}

async function handleDiceResult(result) {
  if (combatState === COMBAT.ROLLING_ATTACK) { attackRollResult = result; await resolveAttackRoll(result); }
  else if (combatState === COMBAT.ROLLING_DAMAGE) { await resolveDamage(result); }
}

async function resolveAttackRoll(result) {
  const { finalTotal, natValue } = result;
  const targetName = targetData?.name || "Target";
  const targetAC = targetData?.ac ?? 10;
  const isCrit = natValue === 20;
  const isNat1 = natValue === 1;
  const isHit = isCrit || (!isNat1 && finalTotal >= targetAC);

  if (isCrit) {
    logCombat(`Attack Roll: <strong class="crit">${finalTotal}</strong> vs AC ${targetAC} — <strong class="crit">CRITICAL HIT!</strong>`, "crit");
    showCombatOverlay(`CRITICAL HIT!`, `Rolling damage (double dice)...`);
  } else if (isNat1) {
    logCombat(`Attack Roll: <strong class="miss">${finalTotal}</strong> — <strong class="miss">CRITICAL MISS!</strong>`, "miss");
    showCombatOverlay(`CRITICAL MISS!`, `${attackerData.name} whiffs completely.`);
    await broadcastSfx("miss");
    await OBR.notification.show(`${attackerData.name} critically missed ${targetName}!`, "ERROR");
    setTimeout(() => resetCombat(), 2000);
    return;
  } else if (isHit) {
    logCombat(`Attack Roll: <strong class="hit">${finalTotal}</strong> vs AC ${targetAC} — <strong class="hit">HIT!</strong>`, "hit");
    showCombatOverlay(`HIT! (${finalTotal} vs AC ${targetAC})`, `Rolling damage...`);
  } else {
    logCombat(`Attack Roll: <strong class="miss">${finalTotal}</strong> vs AC ${targetAC} — <strong class="miss">MISS</strong>`, "miss");
    showCombatOverlay(`MISS! (${finalTotal} vs AC ${targetAC})`, `${attackerData.name}'s attack fails to connect.`);
    await broadcastSfx("miss");
    await OBR.notification.show(`${attackerData.name} missed ${targetName} (${finalTotal} vs AC ${targetAC})`, "WARNING");
    setTimeout(() => resetCombat(), 2000);
    return;
  }

  combatState = COMBAT.ROLLING_DAMAGE;
  pendingRollId = crypto.randomUUID();

  let damageNotation, damageMod, damageLabel;
  if (combatAction === "spell") {
    damageNotation = isCrit ? "2d10" : "1d10";
    damageMod = 0;
    damageLabel = `${attackerData.name} Spell Damage`;
  } else {
    const weapon = attackerData.weapons?.find((w) => w.equipped) || attackerData.weapons?.[0];
    const baseDamage = weapon?.damage || "1d4";
    if (isCrit) {
      const match = baseDamage.match(/^(\d+)d(\d+)$/);
      damageNotation = match ? `${parseInt(match[1]) * 2}d${match[2]}` : baseDamage;
    } else {
      damageNotation = baseDamage;
    }
    const isFinesse = weapon?.properties?.includes("Finesse");
    const isRanged = weapon?.type?.includes("Ranged");
    const str = attackerData.stats.find((s) => s.name === "STR")?.modifier || 0;
    const dex = attackerData.stats.find((s) => s.name === "DEX")?.modifier || 0;
    damageMod = isRanged ? dex : isFinesse ? Math.max(str, dex) : str;
    damageLabel = `${attackerData.name} Damage (${weapon?.name || "Unarmed"})`;
  }

  await new Promise((r) => setTimeout(r, 1500));
  await rollDice(damageNotation, damageLabel, damageMod, pendingRollId);
}

async function resolveDamage(result) {
  const { finalTotal } = result;
  const damage = Math.max(0, finalTotal);
  const targetName = targetData?.name || "Target";

  if (!targetData || !targetTokenId) {
    logCombat(`Dealt <strong>${damage}</strong> damage to ${targetName} (no linked data to update)`, "damage");
    await OBR.notification.show(`${attackerData.name} deals ${damage} damage to ${targetName}!`, "SUCCESS");
    resetCombat();
    return;
  }

  let remaining = damage;
  let newTemp = targetData.hp.temp || 0;
  if (newTemp > 0) {
    const absorbed = Math.min(newTemp, remaining);
    newTemp -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) logCombat(`Temp HP absorbs ${absorbed} damage`, "info");
  }

  const newCurrent = Math.max(0, targetData.hp.current - remaining);
  const isDown = newCurrent === 0;

  logCombat(
    `<strong class="damage">${damage} damage</strong> → ${targetName}: ` +
    `<strong>${targetData.hp.current}</strong> → <strong class="${isDown ? "miss" : ""}">${newCurrent}</strong>/${targetData.hp.max} HP` +
    (isDown ? ` — <strong class="miss">DOWN!</strong>` : ""),
    "damage"
  );

  await OBR.scene.items.updateItems([targetTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) return;
      meta.character.hp.current = newCurrent;
      meta.character.hp.temp = newTemp;
      meta.lastUpdated = Date.now();
    }
  });

  // Sync initiative tracker HP
  await syncInitiativeHP();

  const notifMsg = isDown
    ? `${attackerData.name} deals ${damage} damage — ${targetName} is DOWN!`
    : `${attackerData.name} deals ${damage} damage to ${targetName} (${newCurrent}/${targetData.hp.max} HP)`;
  await OBR.notification.show(notifMsg, isDown ? "ERROR" : "SUCCESS");

  showCombatOverlay(
    `${damage} Damage!`,
    isDown ? `${targetName} falls to 0 HP!` : `${targetName}: ${newCurrent}/${targetData.hp.max} HP remaining`
  );

  // SFX + floating damage
  const isCrit = attackRollResult?.natValue === 20;
  await broadcastSfx(isCrit ? "crit" : "attack-hit");
  setTimeout(async () => {
    await broadcastSfx("damage");
    await showFloatingDamage(targetTokenId, damage, null, { isCrit });
  }, 400);

  setTimeout(() => resetCombat(), 3200);
}

async function syncInitiativeHP() {
  const state = await getInitiativeState();
  if (!state || !state.order.length) return;

  const tokenIds = state.order.map((e) => e.tokenId);
  const items = await OBR.scene.items.getItems(tokenIds);

  let changed = false;
  for (const entry of state.order) {
    const item = items.find((i) => i.id === entry.tokenId);
    const char = item?.metadata?.[METADATA_KEY]?.character;
    if (char && (entry.hpCurrent !== char.hp.current || entry.hpMax !== char.hp.max)) {
      entry.hpCurrent = char.hp.current;
      entry.hpMax = char.hp.max;
      changed = true;
    }
  }

  if (changed) await setInitiativeState(state);
}

// ════════════════════════════════════════
// DICE HELPERS
// ════════════════════════════════════════

async function ensureDiceModal() {
  if (diceModalOpen) return;
  await OBR.modal.open({ id: DICE_MODAL_ID, url: "/dice.html", fullScreen: true, hidePaper: true, hideBackdrop: true });
  diceModalOpen = true;
  await new Promise((r) => setTimeout(r, 800));
}

async function rollDice(notation, label, modifier = 0, rollId = null) {
  await ensureDiceModal();
  await OBR.broadcast.sendMessage(DICE_CHANNEL, {
    notation, label, modifier,
    charName: attackerData?.name || currentCharData?.name || "",
    rollId: rollId || crypto.randomUUID(),
  });
}

function getAttackMod(char) {
  if (!char) return 0;
  const weapon = char.weapons?.find((w) => w.equipped) || char.weapons?.[0];
  if (!weapon) return 0;
  const isFinesse = weapon.properties?.includes("Finesse");
  const isRanged = weapon.type?.includes("Ranged");
  const str = char.stats.find((s) => s.name === "STR")?.modifier || 0;
  const dex = char.stats.find((s) => s.name === "DEX")?.modifier || 0;
  const abilityMod = isRanged ? dex : isFinesse ? Math.max(str, dex) : str;
  return abilityMod + char.proficiencyBonus;
}

// ════════════════════════════════════════
// HOTBAR DISPLAY
// ════════════════════════════════════════

function showHotbar(char) {
  const classInfo = char.classes?.map((c) => c.name).join("/") || char.race || "";
  tokenNameEl.textContent = `${char.name} — Lv.${char.level} ${classInfo}`;

  const hpPct = Math.max(0, (char.hp.current / char.hp.max) * 100);
  let hpColor = "#45e9a0";
  if (hpPct <= 25) hpColor = "#e94560";
  else if (hpPct <= 50) hpColor = "#e9a045";

  statsBar.innerHTML = `
    <div class="stat-chip hp" style="--hp-pct: ${hpPct}%; --hp-color: ${hpColor}">
      <span class="stat-icon">❤️</span>
      <span>${char.hp.current}/${char.hp.max}</span>
      ${char.hp.temp ? `<span class="temp">+${char.hp.temp}</span>` : ""}
    </div>
    <div class="stat-chip ac"><span class="stat-icon">🛡️</span><span>AC ${char.ac}</span></div>
    <div class="stat-chip speed"><span class="stat-icon">👟</span><span>${char.speed}ft</span></div>
    <div class="stat-divider"></div>
    ${char.stats.map((s) =>
      `<div class="stat-chip ability">
        <span class="ability-name">${s.name}</span>
        <span class="ability-val">${s.value}</span>
        <span class="ability-mod">${s.modifier >= 0 ? "+" : ""}${s.modifier}</span>
      </div>`
    ).join("")}
  `;

  hotbar.classList.remove("hidden");
  statsBar.classList.remove("hidden");
}

function hideHotbar() { hotbar.classList.add("hidden"); statsBar.classList.add("hidden"); conditionBar.classList.add("hidden"); tokenNameEl.textContent = ""; currentCharData = null; currentConditions = []; }

function hideAll() { hideHotbar(); hideError(); linkPanel.classList.add("hidden"); hideSpellPicker(); hideConditionPicker(); hideAoeResults(); currentTokenId = null; }

function showLinkPanel(name) {
  linkStatus.textContent = `"${name}" has no character linked.`;
  linkPanel.classList.remove("hidden");
  unlinkBtn.classList.add("hidden");
}

// ════════════════════════════════════════
// HOTBAR BUTTON HANDLERS
// ════════════════════════════════════════

const COMBAT_ACTIONS = ["attack", "spell"];
const NON_COMBAT_ROLLS = {
  skill: (char) => ({ notation: "1d20", label: `${char.name} Skill Check`, modifier: 0 }),
  defend: (char) => ({ notation: "1d20", label: `${char.name} Saving Throw`, modifier: 0 }),
  item: (char) => ({ notation: "1d20", label: `${char.name} Item Use`, modifier: 0 }),
  rest: (char) => {
    const conMod = char.stats.find((s) => s.name === "CON")?.modifier || 0;
    return { notation: "1d10", label: `${char.name} Hit Die (Rest)`, modifier: conMod };
  },
};

document.querySelectorAll(".hotbar-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    if (!action || !currentCharData) return;

    if (action === "conditions") {
      if (conditionPicker.classList.contains("visible")) hideConditionPicker();
      else showConditionPicker();
      return;
    }

    if (combatState !== COMBAT.IDLE) return;
    if (COMBAT_ACTIONS.includes(action)) { enterTargeting(action); return; }
    const rollFn = NON_COMBAT_ROLLS[action];
    if (!rollFn) return;
    const { notation, label, modifier } = rollFn(currentCharData);
    await rollDice(notation, label, modifier);
  });
});

// ════════════════════════════════════════
// LINK / UNLINK / REFRESH
// ════════════════════════════════════════

linkBtn.addEventListener("click", async () => {
  const raw = linkInput.value.trim();
  const charId = extractCharacterId(raw);
  if (!charId) { linkStatus.textContent = "Invalid ID or URL."; return; }
  if (!currentTokenId) return;

  linkBtn.disabled = true;
  linkStatus.textContent = "กำลังดึงข้อมูลตัวละคร...";
  linkStatus.classList.remove("error");
  hideError();

  try {
    const res = await fetch(`${PROXY_URL}/api/character/${charId}`);
    const data = await res.json();
    if (!res.ok) {
      linkStatus.textContent = data.error || "Fetch failed.";
      linkStatus.classList.add("error");
      showError(data.error, data.hint);
      await OBR.notification.show(data.error, "ERROR");
      return;
    }
    const char = data.character;
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = { characterId: charId, character: char, lastUpdated: Date.now() };
      }
    });
    currentCharData = char;
    showHotbar(char);
    linkPanel.classList.add("hidden");
    await OBR.notification.show(`เชื่อมต่อ "${char.name}" สำเร็จ!`, "SUCCESS");
  } catch {
    const msg = "เชื่อมต่อ Proxy Server ไม่ได้";
    linkStatus.textContent = msg;
    linkStatus.classList.add("error");
    showError(msg, "ตรวจสอบว่า Proxy Server กำลังทำงานอยู่ (cd server && npm run dev)");
  } finally {
    linkBtn.disabled = false;
  }
});

unlinkBtn.addEventListener("click", async () => {
  if (!currentTokenId) return;
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) { delete item.metadata[METADATA_KEY]; }
  });
  hideHotbar();
  showLinkPanel("Token");
  await OBR.notification.show("Character unlinked.", "INFO");
});

document.getElementById("refresh-btn").addEventListener("click", async () => {
  if (!currentTokenId) return;
  const items = await OBR.scene.items.getItems([currentTokenId]);
  const token = items[0];
  const meta = token?.metadata?.[METADATA_KEY];
  if (!meta?.characterId) return;
  hideError();
  try {
    const res = await fetch(`${PROXY_URL}/api/character/${meta.characterId}`);
    const data = await res.json();
    if (!res.ok) { showError(data.error, data.hint); await OBR.notification.show(data.error, "ERROR"); return; }
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = { characterId: meta.characterId, character: data.character, lastUpdated: Date.now() };
      }
    });
    currentCharData = data.character;
    showHotbar(data.character);
    await OBR.notification.show("อัปเดตข้อมูลตัวละครสำเร็จ!", "SUCCESS");
  } catch {
    const msg = "เชื่อมต่อ Proxy Server ไม่ได้";
    showError(msg, "ตรวจสอบว่า Proxy Server กำลังทำงานอยู่ (cd server && npm run dev)");
    await OBR.notification.show(msg, "ERROR");
  }
});

function extractCharacterId(input) {
  const urlMatch = input.match(/dndbeyond\.com\/characters\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}
