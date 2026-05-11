import OBR from "@owlbear-rodeo/sdk";
import DiceBox from "@3d-dice/dice-box";
import { SPELLS, getSpellcastingDC, getSaveMod, tokensInRadius, rollSave, parseDamageNotation, DPI_PER_FOOT } from "./spells.js";
import { CONDITIONS, getConditionPenalty, shouldAutoFailSave } from "./conditions.js";
import { playSfx } from "./sfx.js";
import { playHitEffect, playCritEffect, playMissEffect, playHealEffect, playSpellEffect, screenShake, getDiceColor } from "./effects.js";
import { parseCharacter } from "./server/parser.js";

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

// Action picker (weapons)
const actionPicker = document.getElementById("action-picker");
const actionGrid = document.getElementById("action-grid");
const actionCancel = document.getElementById("action-cancel");

// Skill picker
const skillPicker = document.getElementById("skill-picker");
const skillGrid = document.getElementById("skill-grid");
const skillCancel = document.getElementById("skill-cancel");

// Bonus action picker
const bonusPicker = document.getElementById("bonus-picker");
const bonusGrid = document.getElementById("bonus-grid");
const bonusCancel = document.getElementById("bonus-cancel");

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

// HP Editor
const hpEditor = document.getElementById("hp-editor");
const hpEditorCurrent = document.getElementById("hp-editor-current");
const hpAmountInput = document.getElementById("hp-amount");
const hpSetInput = document.getElementById("hp-set");
const hpMaxInput = document.getElementById("hp-max");
const hpTempInput = document.getElementById("hp-temp");

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
// 3D dice now embedded in popover (no separate modal)

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
let selectedWeapon = null;
let pendingAoeResults = null;
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

combatCancel.addEventListener("click", async () => {
  // Panic close all modals
  try { await OBR.modal.close(DICE_MODAL_ID); } catch {}
  try { await OBR.modal.close(FLOATER_MODAL_ID); } catch {}
  // diceModalOpen removed (3D dice now embedded in popover)
  floaterModalOpen = false;
  resetCombat();
  OBR.notification.show("Combat cancelled.", "INFO");
});

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
  selectedWeapon = null;
  pendingAoeResults = null;
  floaterModalOpen = false;
  hideCombatOverlay();
  hideSpellPicker();
  hideActionPicker();
  hideBonusPicker();
  hideAttackInput();
  hideDamageInput();
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
// ATTACK (simplified — manual damage input)
// ════════════════════════════════════════

function hideActionPicker() { actionPicker.classList.remove("visible"); }

const attackInputPanel = document.getElementById("attack-input-panel");
const attackInputTitle = document.getElementById("attack-input-title");
const attackInputInfo = document.getElementById("attack-input-info");

function showAttackInput(title, info) {
  attackInputTitle.textContent = title || "Attack Result";
  attackInputInfo.textContent = info || "";
  attackInputPanel.classList.add("visible");
}

function hideAttackInput() { attackInputPanel.classList.remove("visible"); }

document.getElementById("atk-btn-miss").addEventListener("click", () => {
  hideAttackInput();
  resolveAttackRoll({ finalTotal: 0, natValue: 1 });
});
document.getElementById("atk-btn-hit").addEventListener("click", () => {
  hideAttackInput();
  resolveAttackRoll({ finalTotal: 99, natValue: null });
});
document.getElementById("atk-btn-crit").addEventListener("click", () => {
  hideAttackInput();
  resolveAttackRoll({ finalTotal: 99, natValue: 20 });
});
document.getElementById("attack-cancel").addEventListener("click", () => { hideAttackInput(); resetCombat(); });

const damageInputPanel = document.getElementById("damage-input-panel");
const damageInput = document.getElementById("damage-input");
const damageInputTitle = document.getElementById("damage-input-title");

function showDamageInput(title) {
  damageInputTitle.textContent = title || "Enter Damage";
  damageInput.value = "";
  damageInputPanel.classList.add("visible");
  damageInput.focus();
}

function hideDamageInput() { damageInputPanel.classList.remove("visible"); }

document.getElementById("damage-apply-btn").addEventListener("click", () => applyManualDamage());
damageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyManualDamage(); });
document.getElementById("damage-cancel").addEventListener("click", () => { hideDamageInput(); resetCombat(); });

async function applyManualDamage() {
  const damage = parseInt(damageInput.value) || 0;
  if (damage <= 0) { damageInput.focus(); return; }
  hideDamageInput();

  if (pendingAoeResults) {
    await resolveAoeDamage(damage);
  } else {
    await resolveDamage({ finalTotal: damage });
  }
}

async function resolveAoeDamage(fullDamage) {
  const results = pendingAoeResults;
  if (!results) { resetCombat(); return; }
  const halfDamage = Math.floor(fullDamage / 2);

  const tokenIdsToUpdate = results.filter((r) => r.char).map((r) => r.token.id);
  await OBR.scene.items.updateItems(tokenIdsToUpdate, (items) => {
    for (const item of items) {
      const r = results.find((r) => r.token.id === item.id);
      if (!r || !r.char) continue;
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) continue;
      const dmg = r.saved ? halfDamage : fullDamage;
      let remaining = dmg;
      let temp = meta.character.hp.temp || 0;
      if (temp > 0) { const absorbed = Math.min(temp, remaining); temp -= absorbed; remaining -= absorbed; }
      meta.character.hp.current = Math.max(0, meta.character.hp.current - remaining);
      meta.character.hp.temp = temp;
      meta.lastUpdated = Date.now();
      logCombat(`<strong class="damage">${dmg}</strong> → <strong>${r.name}</strong>${r.saved ? " (half)" : ""}`, "damage");
    }
  });

  await syncInitiativeHP();
  await broadcastSfx("damage");
  for (const r of results) {
    const dmg = r.saved ? halfDamage : fullDamage;
    if (dmg > 0) await showFloatingDamage(r.token.id, dmg, "Force", { isSpell: true });
  }

  showCombatOverlay("Damage Applied!", `${fullDamage} to failed, ${halfDamage} to saved`);
  await OBR.notification.show(`AoE: ${fullDamage} damage applied`, "SUCCESS");
  setTimeout(() => resetCombat(), 3000);
}

// ════════════════════════════════════════
// SKILL PICKER
// ════════════════════════════════════════

function buildSkillGrid() {
  skillGrid.innerHTML = "";
  const skills = currentCharData?.skills || [];
  if (skills.length === 0) { skillGrid.innerHTML = '<div style="color:#8899aa;font-size:10px;text-align:center;padding:8px;grid-column:span 2">No skills available</div>'; return; }

  // Sort: expertise first, proficient next, rest by name
  const sorted = [...skills].sort((a, b) => {
    if (a.expertise !== b.expertise) return b.expertise - a.expertise;
    if (a.proficient !== b.proficient) return b.proficient - a.proficient;
    return a.name.localeCompare(b.name);
  });

  for (const s of sorted) {
    const card = document.createElement("div");
    card.className = "skill-card" + (s.expertise ? " expertise" : s.proficient ? " proficient" : "");
    card.innerHTML = `
      <div>
        <div class="skill-name">${s.name}</div>
        <div class="skill-ability">${s.ability}${s.expertise ? " • EXP" : s.proficient ? " • PROF" : ""}</div>
      </div>
      <div class="skill-mod">${s.modifier >= 0 ? "+" : ""}${s.modifier}</div>`;
    card.addEventListener("click", () => onSkillSelected(s));
    skillGrid.appendChild(card);
  }
}

function showSkillPicker() {
  buildSkillGrid();
  skillPicker.classList.add("visible");
  hideOtherPickers("skill");
}

function hideSkillPicker() { skillPicker.classList.remove("visible"); }

async function onSkillSelected(skill) {
  hideSkillPicker();
  await rollDice("1d20", `${currentCharData.name} ${skill.name}`, skill.modifier);
}

skillCancel.addEventListener("click", hideSkillPicker);

// ════════════════════════════════════════
// BONUS ACTION PICKER
// ════════════════════════════════════════

function buildBonusGrid() {
  bonusGrid.innerHTML = "";
  const actions = currentCharData?.bonusActions || [];
  if (actions.length === 0) { bonusGrid.innerHTML = '<div style="color:#8899aa;font-size:10px;text-align:center;padding:8px">No bonus actions available for this class</div>'; return; }

  for (const a of actions) {
    const card = document.createElement("div");
    card.className = "bonus-card";
    card.innerHTML = `<div class="bonus-name">${a.name}</div><div class="bonus-desc">${a.description}</div>`;
    card.addEventListener("click", () => onBonusSelected(a));
    bonusGrid.appendChild(card);
  }
}

function showBonusPicker() {
  buildBonusGrid();
  bonusPicker.classList.add("visible");
  hideOtherPickers("bonus");
}

function hideBonusPicker() { bonusPicker.classList.remove("visible"); }

async function onBonusSelected(action) {
  hideBonusPicker();
  logCombat(`⚡ <strong>${currentCharData.name}</strong> uses bonus action: <strong>${action.name}</strong>`, "info");

  if (action.type === "attack") {
    combatState = COMBAT.TARGETING;
    combatAction = "attack";
    attackerData = { ...currentCharData };
    attackerTokenId = currentTokenId;
    document.querySelector(".hotbar-btn.bonus")?.classList.add("active-action");
    showCombatOverlay(`${attackerData.name}: ${action.name}`, "Click target token...");
  } else if (action.type === "skill" && action.skill) {
    const skill = currentCharData.skills?.find((s) => s.key === action.skill);
    if (skill) await rollDice("1d20", `${currentCharData.name} ${action.name}`, skill.modifier);
  } else if (action.type === "heal" && action.healDice) {
    const lvl = currentCharData.level || 1;
    await rollDice(action.healDice, `${currentCharData.name} ${action.name}`, lvl);
  } else {
    await OBR.notification.show(`${currentCharData.name}: ${action.name} declared`, "INFO");
  }
}

bonusCancel.addEventListener("click", hideBonusPicker);

function hideOtherPickers(except) {
  if (except !== "spell") spellPicker.classList.remove("visible");
  if (except !== "action") actionPicker.classList.remove("visible");
  if (except !== "skill") skillPicker.classList.remove("visible");
  if (except !== "bonus") bonusPicker.classList.remove("visible");
  if (except !== "condition") conditionPicker.classList.remove("visible");
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

  logCombat(`<strong>${spell.name}</strong> — DC ${dc} ${spell.save} Save`, "spell");

  const saveResults = [];

  for (const token of inRadius) {
    const meta = token.metadata?.[METADATA_KEY];
    const char = meta?.character;
    const name = char?.name || token.name || "Unknown";
    const conditions = token.metadata?.[COND_METADATA_KEY] || [];

    if (shouldAutoFailSave(conditions, spell.save)) {
      saveResults.push({ token, char, name, saved: false, roll: 0, total: 0, autoFail: true });
      logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "spell");
      continue;
    }

    const saveMod = getSaveMod(char, spell.save);
    const { roll, total } = rollSave(saveMod);
    const saved = total >= dc;
    saveResults.push({ token, char, name, saved, roll, total });

    const saveStr = saved
      ? `<strong class="hit">SAVE</strong> (${roll}+${saveMod}=${total})`
      : `<strong class="miss">FAIL</strong> (${roll}+${saveMod}=${total})`;
    logCombat(`<strong>${name}</strong>: ${spell.save} ${saveStr}`, "spell");
  }

  await broadcastSfx("spell");
  playSpellEffect(spell.damageType);

  const failCount = saveResults.filter((r) => !r.saved).length;
  const saveCount = saveResults.filter((r) => r.saved).length;
  showAoeResults(spell, dc, saveResults);
  showCombatOverlay(`${spell.name}`, `${failCount} failed, ${saveCount} saved — enter damage`);

  pendingAoeResults = saveResults;
  combatState = COMBAT.ROLLING_DAMAGE;
  showDamageInput(`${spell.name} — Enter full damage`);
}

function showAoeResults(spell, dc, results) {
  aoeTitle.textContent = `${spell.name} — DC ${dc} ${spell.save} Save`;
  aoeTargetList.innerHTML = results.map((r) => {
    const saveClass = r.saved ? "saved" : "failed";
    const saveText = r.autoFail ? "AUTO-FAIL" : `${r.roll}+${getSaveMod(r.char, spell.save)}=${r.total} ${r.saved ? "SAVE" : "FAIL"}`;
    return `
      <div class="aoe-target ${saveClass}">
        <span class="aoe-name">${r.name}</span>
        <span class="aoe-save-result">${saveText}</span>
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

let floaterForceCloseTimer = null;

async function ensureFloaterModal() {
  // Always reset the force-close timer (extends if more damage events come in)
  if (floaterForceCloseTimer) clearTimeout(floaterForceCloseTimer);
  floaterForceCloseTimer = setTimeout(async () => {
    try { await OBR.modal.close(FLOATER_MODAL_ID); } catch {}
    floaterModalOpen = false;
    floaterForceCloseTimer = null;
  }, 4000);

  if (floaterModalOpen) return;
  try {
    await OBR.modal.open({
      id: FLOATER_MODAL_ID,
      url: "/floater.html",
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
    });
    floaterModalOpen = true;
    await new Promise((r) => setTimeout(r, 400));
  } catch {
    floaterModalOpen = false;
  }
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
// HP EDITOR (manual GM control)
// ════════════════════════════════════════

function openHpEditor() {
  if (!currentCharData) return;
  refreshHpEditor();
  hpEditor.classList.add("visible");
}

function refreshHpEditor() {
  if (!currentCharData) return;
  const hp = currentCharData.hp;
  hpEditorCurrent.innerHTML = `Current: <strong>${hp.current}</strong>/<span class="max-val">${hp.max}</span>${hp.temp ? ` <span style="color:#45a0e9">+${hp.temp} temp</span>` : ""}`;
  hpSetInput.placeholder = String(hp.current);
  hpMaxInput.placeholder = String(hp.max);
  hpTempInput.placeholder = String(hp.temp || 0);
}

async function applyHpChange(newCurrent, newMax = null, newTemp = null, label = "HP changed") {
  if (!currentTokenId || !currentCharData) return;

  const oldCurrent = currentCharData.hp.current;
  const oldMax = currentCharData.hp.max;

  const finalMax = newMax !== null ? Math.max(1, newMax) : oldMax;
  const finalCurrent = Math.max(0, Math.min(newCurrent, finalMax));
  const finalTemp = newTemp !== null ? Math.max(0, newTemp) : (currentCharData.hp.temp || 0);

  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) return;
      meta.character.hp.current = finalCurrent;
      meta.character.hp.max = finalMax;
      meta.character.hp.temp = finalTemp;
      meta.lastUpdated = Date.now();
    }
  });

  // Update local state
  currentCharData.hp.current = finalCurrent;
  currentCharData.hp.max = finalMax;
  currentCharData.hp.temp = finalTemp;

  // Refresh UI
  showHotbar(currentCharData);
  refreshHpEditor();
  await syncInitiativeHP();

  // Show floating damage/heal if HP changed + visual effects
  const delta = finalCurrent - oldCurrent;
  if (delta !== 0) {
    const isHeal = delta > 0;
    await broadcastSfx(isHeal ? "heal" : "damage");
    if (isHeal) playHealEffect();
    else { playHitEffect("bludgeoning"); screenShake("light"); }
    await showFloatingDamage(currentTokenId, Math.abs(delta), null, { isHeal });
  }

  logCombat(`<strong>${currentCharData.name}</strong> ${label}: <strong>${oldCurrent}</strong>→<strong>${finalCurrent}</strong>/${finalMax} HP`, isHealLog(delta));
  await OBR.notification.show(`${currentCharData.name}: ${label} (${finalCurrent}/${finalMax})`, "INFO");
}

function isHealLog(delta) {
  if (delta > 0) return "info";
  if (delta < 0) return "damage";
  return "info";
}

document.getElementById("hp-btn-damage").addEventListener("click", async () => {
  const amt = parseInt(hpAmountInput.value) || 0;
  if (amt <= 0) return;
  let remaining = amt;
  let temp = currentCharData.hp.temp || 0;
  if (temp > 0) {
    const absorbed = Math.min(temp, remaining);
    temp -= absorbed;
    remaining -= absorbed;
  }
  await applyHpChange(currentCharData.hp.current - remaining, null, temp, `−${amt} damage`);
});

document.getElementById("hp-btn-heal").addEventListener("click", async () => {
  const amt = parseInt(hpAmountInput.value) || 0;
  if (amt <= 0) return;
  await applyHpChange(currentCharData.hp.current + amt, null, null, `+${amt} healed`);
});

document.getElementById("hp-btn-set").addEventListener("click", async () => {
  const val = parseInt(hpSetInput.value);
  if (isNaN(val)) return;
  await applyHpChange(val, null, null, `set HP to ${val}`);
  hpSetInput.value = "";
});

document.getElementById("hp-btn-full").addEventListener("click", async () => {
  await applyHpChange(currentCharData.hp.max, null, null, "fully healed");
});

document.getElementById("hp-btn-max").addEventListener("click", async () => {
  const val = parseInt(hpMaxInput.value);
  if (isNaN(val) || val < 1) return;
  // When raising max, keep current. When lowering max below current, clamp current.
  const newCurrent = Math.min(currentCharData.hp.current, val);
  await applyHpChange(newCurrent, val, null, `max HP set to ${val}`);
  hpMaxInput.value = "";
});

document.getElementById("hp-btn-temp").addEventListener("click", async () => {
  const val = parseInt(hpTempInput.value);
  if (isNaN(val) || val < 0) return;
  await applyHpChange(currentCharData.hp.current, null, val, `temp HP set to ${val}`);
  hpTempInput.value = "";
});

document.getElementById("hp-btn-close").addEventListener("click", () => {
  hpEditor.classList.remove("visible");
});

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
  tab.addEventListener("click", () => switchToTab(tab.dataset.tab));
});

function switchToTab(tabName) {
  document.querySelectorAll(".link-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".link-content").forEach((c) => c.classList.add("hidden"));
  const targetTab = document.querySelector(`.link-tab[data-tab="${tabName}"]`);
  if (targetTab) targetTab.classList.add("active");
  const targetContent = document.getElementById(`tab-${tabName}`);
  if (targetContent) targetContent.classList.remove("hidden");
}

// ════════════════════════════════════════
// PASTE JSON IMPORTER (manual D&D Beyond import)
// ════════════════════════════════════════

document.getElementById("paste-open-btn").addEventListener("click", () => {
  const input = document.getElementById("paste-id-input");
  const raw = input.value.trim();
  const charId = extractCharacterId(raw);
  if (!charId) {
    document.getElementById("paste-status").textContent = "ใส่ Character ID ก่อน";
    document.getElementById("paste-status").className = "error";
    return;
  }
  const url = `https://character-service.dndbeyond.com/character/v5/character/${charId}`;
  window.open(url, "_blank");
  document.getElementById("paste-status").textContent = "เปิดหน้า JSON แล้ว — Copy ทั้งหมดแล้ว Paste กลับมาที่นี่";
  document.getElementById("paste-status").className = "";
});

document.getElementById("paste-apply-btn").addEventListener("click", async () => {
  if (!currentTokenId) {
    document.getElementById("paste-status").textContent = "เลือก token ก่อน";
    document.getElementById("paste-status").className = "error";
    return;
  }

  const jsonText = document.getElementById("paste-json").value.trim();
  if (!jsonText) {
    document.getElementById("paste-status").textContent = "วาง JSON ก่อน";
    document.getElementById("paste-status").className = "error";
    return;
  }

  try {
    const raw = JSON.parse(jsonText);
    const char = parseCharacter(raw);

    if (!char.name) throw new Error("ไม่พบชื่อตัวละครใน JSON");

    // Extract character ID from the JSON if possible
    const charId = raw.data?.id || raw.id || "";

    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = { characterId: String(charId), character: char, lastUpdated: Date.now() };
      }
    });

    currentCharData = char;
    showHotbar(char);
    linkPanel.classList.add("hidden");
    document.getElementById("paste-status").textContent = "";
    await OBR.notification.show(`เชื่อมต่อ "${char.name}" สำเร็จ!`, "SUCCESS");
    hideError();
  } catch (err) {
    document.getElementById("paste-status").textContent = `JSON ไม่ถูกต้อง: ${err.message}`;
    document.getElementById("paste-status").className = "error";
  }
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

  const profBonus = Math.ceil(totalLevel / 4) + 1;
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
    proficiencyBonus: profBonus,
    speed: m.speed ?? 30,
    weapons,
    skills: defaultSkills(stats, profBonus, m.skills || []),
    bonusActions: m.bonusActions || [],
  };
}

const SKILL_DEFS = [
  { key: "acrobatics", name: "Acrobatics", ability: "DEX" },
  { key: "animal-handling", name: "Animal Handling", ability: "WIS" },
  { key: "arcana", name: "Arcana", ability: "INT" },
  { key: "athletics", name: "Athletics", ability: "STR" },
  { key: "deception", name: "Deception", ability: "CHA" },
  { key: "history", name: "History", ability: "INT" },
  { key: "insight", name: "Insight", ability: "WIS" },
  { key: "intimidation", name: "Intimidation", ability: "CHA" },
  { key: "investigation", name: "Investigation", ability: "INT" },
  { key: "medicine", name: "Medicine", ability: "WIS" },
  { key: "nature", name: "Nature", ability: "INT" },
  { key: "perception", name: "Perception", ability: "WIS" },
  { key: "performance", name: "Performance", ability: "CHA" },
  { key: "persuasion", name: "Persuasion", ability: "CHA" },
  { key: "religion", name: "Religion", ability: "INT" },
  { key: "sleight-of-hand", name: "Sleight of Hand", ability: "DEX" },
  { key: "stealth", name: "Stealth", ability: "DEX" },
  { key: "survival", name: "Survival", ability: "WIS" },
];

function defaultSkills(stats, profBonus, profKeys = []) {
  const profSet = new Set(profKeys);
  return SKILL_DEFS.map((s) => {
    const abilityMod = stats.find((st) => st.name === s.ability)?.modifier || 0;
    const isProf = profSet.has(s.key);
    return {
      key: s.key,
      name: s.name,
      ability: s.ability,
      modifier: abilityMod + (isProf ? profBonus : 0),
      proficient: isProf,
      expertise: false,
    };
  });
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
    initTrack.innerHTML = "";
    initRoundEl.textContent = "";
    initNextBtn.classList.add("hidden");
    initEndBtn.classList.add("hidden");
    initRollBtn.classList.remove("hidden");
    document.getElementById("init-input-panel").classList.remove("visible");
    return;
  }

  initRollBtn.classList.add("hidden");
  initNextBtn.classList.remove("hidden");
  initEndBtn.classList.remove("hidden");
  initRoundEl.textContent = `Round ${state.round || 1}`;
  document.getElementById("init-input-panel").classList.remove("visible");

  initTrack.innerHTML = state.order.map((entry, i) => {
    const isActive = i === state.currentIndex;
    const hpPct = entry.hpMax > 0 ? (entry.hpCurrent / entry.hpMax) * 100 : 100;
    const isDown = entry.hpCurrent <= 0;
    let hpClass = "";
    if (isDown) hpClass = "down";
    else if (hpPct <= 25) hpClass = "critical";
    else if (hpPct <= 50) hpClass = "hurt";

    return `
      <div class="init-row ${isActive ? "active" : ""} ${isDown ? "dead" : ""}"
           data-token-id="${entry.tokenId}">
        <span class="init-roll-val">${entry.initiative}</span>
        <span class="init-name">${entry.name}</span>
        <div class="init-hp-cell ${hpClass}">
          <span class="init-hp-cur">${entry.hpCurrent}</span>
          <span class="init-hp-sep">/</span>
          <span class="init-hp-max">${entry.hpMax}</span>
        </div>
        <span class="init-ac">${entry.ac ?? "?"}</span>
        <div class="init-actions">
          <button class="init-action-btn" data-action="select" title="Select">&#9654;</button>
        </div>
      </div>
    `;
  }).join("");

  initTrack.querySelectorAll(".init-row").forEach((el) => {
    el.addEventListener("click", () => {
      const tokenId = el.dataset.tokenId;
      if (tokenId) OBR.player.select([tokenId]);
    });
  });
}

// Start Initiative: gather all CHARACTER tokens, show input form for manual entry
let pendingInitTokens = [];

initRollBtn.addEventListener("click", async () => {
  initRollBtn.disabled = true;
  initRollBtn.textContent = "Loading...";

  try {
    const allItems = await OBR.scene.items.getItems((item) =>
      item.layer === "CHARACTER"
    );

    pendingInitTokens = allItems.map((item) => {
      const meta = item.metadata?.[METADATA_KEY];
      const char = meta?.character;
      return {
        tokenId: item.id,
        name: char?.name || item.name || "Unknown",
        hpCurrent: char?.hp?.current ?? 0,
        hpMax: char?.hp?.max ?? 0,
        ac: char?.ac ?? 10,
        isMonster: meta?.isMonster || false,
      };
    });

    const inputList = document.getElementById("init-input-list");
    inputList.innerHTML = pendingInitTokens.map((t, i) => `
      <div class="init-input-row">
        <input type="number" id="init-val-${i}" placeholder="--" />
        <span class="init-input-name">${t.name}</span>
      </div>
    `).join("");

    initiativeBar.classList.add("visible");
    initTrack.innerHTML = "";
    document.getElementById("init-input-panel").classList.add("visible");

    const firstInput = document.getElementById("init-val-0");
    if (firstInput) firstInput.focus();
  } catch (err) {
    console.error("Initiative setup failed:", err);
    await OBR.notification.show("Initiative setup failed.", "ERROR");
  } finally {
    initRollBtn.disabled = false;
    initRollBtn.textContent = "Start Initiative";
  }
});

document.getElementById("init-input-confirm").addEventListener("click", async () => {
  const entries = pendingInitTokens.map((t, i) => {
    const input = document.getElementById(`init-val-${i}`);
    const val = parseInt(input?.value) || 0;
    return { ...t, initiative: val };
  });

  entries.sort((a, b) => b.initiative - a.initiative);

  const state = { order: entries, currentIndex: 0, round: 1 };
  await setInitiativeState(state);

  const logLines = entries.map(
    (e) => `<strong>${e.name}</strong>: <strong>${e.initiative}</strong>`
  ).join(" | ");
  logCombat(`Initiative set! ${logLines}`, "init");

  await OBR.notification.show(`Initiative set for ${entries.length} combatants!`, "SUCCESS");

  if (entries.length > 0) {
    await OBR.player.select([entries[0].tokenId]);
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

  // Initialize 3D dice (non-blocking)
  initDiceBox();

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

  if (action === "spell") { showSpellPicker(); return; }

  combatState = COMBAT.TARGETING;
  combatAction = action;
  attackerData = { ...currentCharData };
  attackerTokenId = currentTokenId;
  document.querySelector(`.hotbar-btn.${action}`)?.classList.add("active-action");
  showCombatOverlay(`${attackerData.name}: Attack`, "Click on an enemy token...");
  logCombat(`<strong>${attackerData.name}</strong> readies an attack`);
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

  logCombat(`<strong>${attackerData.name}</strong> targets <strong>${targetName}</strong> (AC ${targetAC})`);

  combatState = COMBAT.ROLLING_ATTACK;
  showCombatOverlay(`${attackerData.name} → ${targetName}`, `AC ${targetAC} — Hit or Miss?`);
  showAttackInput(`${attackerData.name} → ${targetName}`, `Target AC: ${targetAC}`);
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
    logCombat(`<strong>${name}</strong>: ${spell.save} Save ${roll}+${saveMod}=${total} ${saveStr}`, "spell");
  }

  await broadcastSfx("spell");
  playSpellEffect(spell.damageType);

  const saveLabel = saved ? "SAVED" : "FAILED";
  showCombatOverlay(`${spell.name}: ${saveLabel}!`, `Enter damage below`);
  await OBR.notification.show(`${spell.name}: ${name} ${saveLabel}`, saved ? "WARNING" : "SUCCESS");

  targetTokenId = targetToken.id;
  targetData = char || null;
  combatState = COMBAT.ROLLING_DAMAGE;
  showDamageInput(`${spell.name} → ${name} (${saveLabel})`);
}


async function resolveAttackRoll(result) {
  const { natValue } = result;
  const targetName = targetData?.name || "Target";
  const isCrit = natValue === 20;
  const isMiss = natValue === 1;

  if (isMiss) {
    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="miss">MISS!</strong>`, "miss");
    showCombatOverlay(`MISS!`, `${attackerData.name}'s attack misses.`);
    playMissEffect();
    await broadcastSfx("miss");
    await OBR.notification.show(`${attackerData.name} missed ${targetName}!`, "WARNING");
    setTimeout(() => resetCombat(), 2000);
    return;
  }

  if (isCrit) {
    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="crit">CRITICAL HIT!</strong>`, "crit");
    showCombatOverlay(`CRITICAL HIT!`, `Enter damage below`);
  } else {
    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="hit">HIT!</strong>`, "hit");
    showCombatOverlay(`HIT!`, `Enter damage below`);
  }

  attackRollResult = { natValue };
  combatState = COMBAT.ROLLING_DAMAGE;
  const hitLabel = isCrit ? `CRIT! Enter damage → ${targetName}` : `HIT! Enter damage → ${targetName}`;
  showDamageInput(hitLabel);
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

  const isCrit = attackRollResult?.natValue === 20;
  await broadcastSfx(isCrit ? "crit" : "attack-hit");
  if (isCrit) playCritEffect("Slashing");
  else playHitEffect("Slashing");
  setTimeout(async () => {
    await broadcastSfx("damage");
    await showFloatingDamage(targetTokenId, damage, "Slashing", { isCrit });
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
// DICE SYSTEM (self-contained, no modal dependency)
// ════════════════════════════════════════

// ── 3D Dice (embedded in popover) ──
const diceOverlay = document.getElementById("dice-overlay");
const dice3dLabel = document.getElementById("dice-3d-label");
const dice3dResult = document.getElementById("dice-3d-result");
const diceResultEl = document.getElementById("dice-result");
const diceResultLabel = document.getElementById("dice-result-label");
const diceResultValue = document.getElementById("dice-result-value");
const diceResultDetail = document.getElementById("dice-result-detail");

let diceBox = null;
let diceReady = false;
let diceInitializing = false;

async function initDiceBox() {
  if (diceReady || diceInitializing) return;
  diceInitializing = true;
  try {
    // Determine base URL for assets (works in both dev and production/iframe)
    const base = import.meta.env.BASE_URL || "/";
    const assetPath = `${base}dice-assets/assets/`;
    const origin = `${base}dice-assets/`;

    console.log("[dice] Initializing dice-box with:", { assetPath, origin });

    diceBox = new DiceBox("#dice-box", {
      assetPath,
      origin,
      scale: 5,
      theme: "default",
      offscreen: false,       // Force onscreen mode (no Web Worker — works in iframes)
      gravity: 2,
      mass: 1,
      friction: 0.8,
      restitution: 0.5,
      linearDamping: 0.5,
      angularDamping: 0.4,
      settleTimeout: 4000,
    });
    await diceBox.init();
    diceReady = true;
    console.log("[dice] 3D dice-box initialized successfully");
  } catch (err) {
    console.warn("[dice] 3D dice init failed, will use text fallback:", err.message);
    diceReady = false;
  }
  diceInitializing = false;
}

function rollDiceValues(notation) {
  let diceTotal = 0;
  let sides = 20;
  let diceCount = 0;
  const parts = notation.replace(/\s/g, "").split("+");
  for (const part of parts) {
    const match = part.match(/^(\d+)d(\d+)$/);
    if (match) {
      const count = parseInt(match[1]);
      sides = parseInt(match[2]);
      for (let i = 0; i < count; i++) {
        diceTotal += Math.floor(Math.random() * sides) + 1;
        diceCount++;
      }
    } else {
      diceTotal += parseInt(part) || 0;
    }
  }
  const isSingleD20 = notation.trim() === "1d20";
  return { diceTotal, sides, diceCount, isSingleD20 };
}

function showDiceResultDisplay(label, result) {
  const { diceTotal, modifier, finalTotal, natValue } = result;
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const detail = modifier !== 0 ? `${diceTotal}${modStr} = ${finalTotal}` : `${diceTotal}`;

  diceResultLabel.textContent = label || "";
  let extraText = "";
  diceResultEl.className = "";
  if (natValue === 20) { diceResultEl.classList.add("nat-crit"); extraText = " NAT 20!"; }
  else if (natValue === 1) { diceResultEl.classList.add("nat-fail"); extraText = " NAT 1"; }

  diceResultValue.textContent = finalTotal;
  diceResultDetail.textContent = detail + extraText;
  diceResultEl.classList.add("visible");

  clearTimeout(diceResultEl._hideTimer);
  diceResultEl._hideTimer = setTimeout(() => {
    diceResultEl.classList.remove("visible", "nat-crit", "nat-fail");
  }, 2500);
}

function show3DResult(label, result) {
  const { diceTotal, modifier, finalTotal, natValue } = result;
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const detail = modifier !== 0 ? `${diceTotal}${modStr} = ${finalTotal}` : "";

  let extraHtml = "";
  diceOverlay.className = "visible";
  if (natValue === 20) { diceOverlay.classList.add("nat-crit"); extraHtml = '<div class="dice-extra">NATURAL 20!</div>'; }
  else if (natValue === 1) { diceOverlay.classList.add("nat-fail"); extraHtml = '<div class="dice-extra">NATURAL 1...</div>'; }

  dice3dResult.innerHTML = `
    ${extraHtml}
    <div class="dice-total">${finalTotal}</div>
    ${detail ? `<div class="dice-detail">${detail}</div>` : ""}
  `;
  dice3dResult.classList.add("visible");
}

async function rollDice(notation, label, modifier = 0, rollId = null) {
  const rid = rollId || crypto.randomUUID();
  pendingRollId = rid;

  // Generate result immediately (fallback values)
  const { diceTotal: fallbackTotal, isSingleD20 } = rollDiceValues(notation);
  let diceTotal = fallbackTotal;
  let used3D = false;

  const charName = attackerData?.name || currentCharData?.name || "";

  // Try 3D dice
  if (diceReady && diceBox) {
    try {
      // Show overlay with label
      diceOverlay.className = "visible";
      dice3dLabel.textContent = label || notation;
      dice3dResult.classList.remove("visible");
      dice3dResult.innerHTML = "";

      // Clear previous dice
      try { diceBox.clear(); } catch {}

      // Roll 3D dice with timeout
      const results = await Promise.race([
        diceBox.roll(notation),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);

      // Use 3D dice result instead of fallback
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      used3D = true;
      playSfx("dice-hit");

      // Short pause to appreciate the dice
      await new Promise((r) => setTimeout(r, 600));

    } catch (err) {
      console.warn("[dice] 3D roll failed, using fallback:", err.message);
      diceOverlay.className = "";
      playSfx("dice-hit");
    }
  } else {
    playSfx("dice-hit");
  }

  const finalTotal = diceTotal + modifier;
  const natValue = isSingleD20 ? diceTotal : null;

  const result = {
    notation, diceTotal, modifier, finalTotal, natValue,
    charName, label, rollId: rid,
  };

  // SFX for nat 20/1
  if (natValue === 20) setTimeout(() => playSfx("crit"), 150);
  else if (natValue === 1) setTimeout(() => playSfx("miss"), 150);

  // Show result
  if (used3D) {
    show3DResult(label, result);
  } else {
    showDiceResultDisplay(label, result);
  }

  // Broadcast SFX + notification to all players
  const sfxName = natValue === 20 ? "crit" : natValue === 1 ? "miss" : "dice-hit";
  OBR.broadcast.sendMessage(SFX_CHANNEL, { sound: sfxName }).catch(() => {});

  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "";
  const notifText = charName
    ? `${charName} rolled ${notation}${modStr}: ${finalTotal}${natValue === 20 ? " (NAT 20!)" : natValue === 1 ? " (NAT 1)" : ""}`
    : `Rolled ${notation}${modStr}: ${finalTotal}`;
  OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO").catch(() => {});

  // Dramatic pause
  await new Promise((r) => setTimeout(r, used3D ? 1500 : 1000));


  // Auto-hide 3D overlay
  if (used3D) {
    setTimeout(() => {
      diceOverlay.className = "";
      dice3dResult.classList.remove("visible");
      try { diceBox?.clear(); } catch {}
    }, 2000);
  }
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

  // Make HP chip clickable to open editor
  const hpChip = statsBar.querySelector(".stat-chip.hp");
  if (hpChip) {
    hpChip.addEventListener("click", openHpEditor);
    hpChip.title = "Click to edit HP";
  }
}

function hideHotbar() { hotbar.classList.add("hidden"); statsBar.classList.add("hidden"); conditionBar.classList.add("hidden"); hpEditor.classList.remove("visible"); tokenNameEl.textContent = ""; currentCharData = null; currentConditions = []; }

function hideAll() { hideHotbar(); hideError(); linkPanel.classList.add("hidden"); hideSpellPicker(); hideConditionPicker(); hideActionPicker(); hideSkillPicker(); hideBonusPicker(); hideAoeResults(); currentTokenId = null; }

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
  defend: (char) => ({ notation: "1d20", label: `${char.name} Saving Throw`, modifier: 0 }),
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

    if (action === "skill") {
      if (skillPicker.classList.contains("visible")) hideSkillPicker();
      else showSkillPicker();
      return;
    }

    if (action === "bonus") {
      if (bonusPicker.classList.contains("visible")) hideBonusPicker();
      else showBonusPicker();
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
// CHARACTER FETCHER
// ════════════════════════════════════════
// D&D Beyond บล็อก cloud IPs → ใช้ Paste JSON เป็นหลัก
// ถ้า PROXY_URL ตั้งไว้จะลองดึงอัตโนมัติก่อน

async function fetchCharacter(charId) {
  const strategies = [];
  if (PROXY_URL) strategies.push({ name: "Proxy", url: PROXY_URL });
  strategies.push({ name: "Same-origin", url: "" });

  for (const s of strategies) {
    try {
      const res = await fetch(`${s.url}/api/character/${charId}`);
      const data = await res.json();
      if (res.ok && data.character) return { success: true, character: data.character };
      if (res.status === 404) return { success: false, error: "ไม่พบตัวละคร", hint: "ตรวจสอบ Character ID อีกครั้ง" };
    } catch {}
  }

  return {
    success: false,
    error: "ดึงข้อมูลอัตโนมัติไม่ได้",
    hint: 'ใช้แท็บ "Paste JSON" เพื่อ import ตัวละคร',
  };
}

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
    const result = await fetchCharacter(charId);
    if (!result.success) {
      linkStatus.innerHTML = `${result.error}<br><span style="font-size:9px;color:#e9a045">💡 ใช้แท็บ Paste JSON เพื่อ import</span>`;
      linkStatus.classList.add("error");
      showError(
        result.error,
        result.hint
      );
      // Auto-switch to paste tab and pre-fill the ID
      switchToTab("paste");
      const pasteIdInput = document.getElementById("paste-id-input");
      if (pasteIdInput) pasteIdInput.value = charId;
      return;
    }
    const char = result.character;
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = { characterId: charId, character: char, lastUpdated: Date.now() };
      }
    });
    currentCharData = char;
    showHotbar(char);
    linkPanel.classList.add("hidden");
    await OBR.notification.show(`เชื่อมต่อ "${char.name}" สำเร็จ!`, "SUCCESS");
  } catch (err) {
    const msg = "เกิดข้อผิดพลาดในการดึงข้อมูล";
    linkStatus.textContent = msg;
    linkStatus.classList.add("error");
    showError(msg, err.message);
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
    const result = await fetchCharacter(meta.characterId);
    if (!result.success) { showError(result.error, result.hint); await OBR.notification.show(result.error, "ERROR"); return; }
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = { characterId: meta.characterId, character: result.character, lastUpdated: Date.now() };
      }
    });
    currentCharData = result.character;
    showHotbar(result.character);
    await OBR.notification.show("อัปเดตข้อมูลตัวละครสำเร็จ!", "SUCCESS");
  } catch (err) {
    showError("เกิดข้อผิดพลาด", err.message);
    await OBR.notification.show("อัปเดตข้อมูลล้มเหลว", "ERROR");
  }
});

function extractCharacterId(input) {
  const urlMatch = input.match(/dndbeyond\.com\/characters\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}
