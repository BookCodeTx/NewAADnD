import OBR, { buildText } from "@owlbear-rodeo/sdk";
import DiceBox from "@3d-dice/dice-box";
import "@3d-dice/dice-box/dist/style.css";
import { SPELLS, getSpellcastingDC, getSaveMod, tokensInRadius, rollSave, parseDamageNotation, DPI_PER_FOOT } from "./spells.js";
import { CONDITIONS, getConditionPenalty, shouldAutoFailSave } from "./conditions.js";
import { playSfx } from "./sfx.js";
import { playHitEffect, playCritEffect, playMissEffect, playHealEffect, playSpellEffect, screenShake, getDiceColor } from "./effects.js";
import { parseCharacter } from "./server/parser.js";
import { startDiceRoll, stopDiceRoll, startD20Roll, stopD20Roll, parseDieType } from "./d20renderer.js";

const METADATA_KEY = "com.dnd-hotbar/character";
const INIT_METADATA_KEY = "com.dnd-hotbar/initiative";
const COND_METADATA_KEY = "com.dnd-hotbar/conditions";
const SKULL_METADATA_KEY = "com.dnd-hotbar/skull";
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

// Save picker
const savePicker = document.getElementById("save-picker");
const saveGrid = document.getElementById("save-grid");
const saveCancel = document.getElementById("save-cancel");

// Bonus action picker
const bonusPicker = document.getElementById("bonus-picker");
const bonusGrid = document.getElementById("bonus-grid");
const bonusCancel = document.getElementById("bonus-cancel");

// Condition picker
const conditionPicker = document.getElementById("condition-picker");
const condGrid = document.getElementById("cond-grid");
const condCancel = document.getElementById("cond-cancel");

// Inventory panel
const inventoryPanel = document.getElementById("inventory-panel");
const invList = document.getElementById("inv-list");
const invCurrency = document.getElementById("inv-currency");
const invFooter = document.getElementById("inv-footer");
const invClose = document.getElementById("inv-close");

// Features panel
const featuresPanel = document.getElementById("features-panel");
const featList = document.getElementById("feat-list");
const featClose = document.getElementById("feat-close");

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

// AC Editor
const acEditor = document.getElementById("ac-editor");
const acEditorCurrent = document.getElementById("ac-editor-current");
const acDisplay = document.getElementById("ac-display");
const acSetInput = document.getElementById("ac-set-input");

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
const COMBAT_LOG_CHANNEL = "com.dnd-hotbar/combat-log";
const EFFECTS_METADATA_KEY = "com.dnd-hotbar/active-effects";


// ── Error helpers ──
function showError(title, hint) { errorTitleText.textContent = title; errorHintText.textContent = hint || ""; errorBanner.classList.add("visible"); }
function hideError() { errorBanner.classList.remove("visible"); }
errorDismiss.addEventListener("click", hideError);

// ── Combat log ──
function addLogEntry(html, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = html;
  combatLog.prepend(entry);
  combatLog.classList.remove("hidden");
  while (combatLog.children.length > 30) combatLog.removeChild(combatLog.lastChild);
}

function logCombat(html, type = "info") {
  addLogEntry(html, type);
  // Broadcast to all other players
  OBR.broadcast.sendMessage(COMBAT_LOG_CHANNEL, { html, type }).catch(() => {});
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
  hideDamageRollPanel();
  hideAoeResults();
  document.querySelectorAll(".hotbar-btn").forEach((b) => b.classList.remove("active-action"));
}

// ════════════════════════════════════════
// SPELL PICKER
// ════════════════════════════════════════

let currentSpellFilter = "all"; // "all", "cantrip", "1", "2", etc.

function buildSpellGrid() {
  spellGrid.innerHTML = "";

  // Use character spells from D&D Beyond if available, else fallback to hardcoded
  const charSpells = currentCharData?.spells || [];
  const hasCharSpells = charSpells.length > 0;

  if (hasCharSpells) {
    // Build level tabs
    const levels = new Set(charSpells.map(s => s.level));
    const tabBar = document.createElement("div");
    tabBar.className = "spell-level-tabs";
    const allTab = document.createElement("span");
    allTab.className = `spell-level-tab${currentSpellFilter === "all" ? " active" : ""}`;
    allTab.textContent = "All";
    allTab.dataset.filter = "all";
    tabBar.appendChild(allTab);
    for (const lv of [...levels].sort((a, b) => a - b)) {
      const tab = document.createElement("span");
      const filterVal = lv === 0 ? "cantrip" : String(lv);
      tab.className = `spell-level-tab${currentSpellFilter === filterVal ? " active" : ""}`;
      tab.textContent = lv === 0 ? "Cantrip" : `Lv.${lv}`;
      tab.dataset.filter = filterVal;
      tabBar.appendChild(tab);
    }
    tabBar.addEventListener("click", (e) => {
      const tab = e.target.closest(".spell-level-tab");
      if (!tab) return;
      currentSpellFilter = tab.dataset.filter;
      buildSpellGrid();
    });
    spellGrid.appendChild(tabBar);

    // Filter
    let filtered = charSpells;
    if (currentSpellFilter === "cantrip") filtered = charSpells.filter(s => s.level === 0);
    else if (currentSpellFilter !== "all") filtered = charSpells.filter(s => s.level === parseInt(currentSpellFilter));

    // Only show prepared spells + cantrips (or all if filter applied)
    filtered = filtered.filter(s => s.level === 0 || s.prepared);

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:#555;font-size:10px;text-align:center;padding:16px";
      empty.textContent = "No spells at this level";
      spellGrid.appendChild(empty);
      return;
    }

    for (const spell of filtered) {
      const card = document.createElement("div");
      card.className = "spell-card";
      if (spell.isHealing) card.classList.add("healing");
      card.dataset.spellKey = spell.key;

      const tags = [];
      if (spell.isAoE) tags.push(`<span class="spell-tag aoe">AoE ${spell.aoeRadius}ft</span>`);
      if (spell.save) tags.push(`<span class="spell-tag save">${spell.save} Save</span>`);
      if (spell.isAttack) tags.push(`<span class="spell-tag atk">Attack +${spell.attackBonus}</span>`);
      if (spell.damage) tags.push(`<span class="spell-tag dmg">${spell.damage} ${spell.damageType || ""}</span>`);
      if (spell.isHealing) tags.push(`<span class="spell-tag heal">Heal</span>`);
      if (spell.concentration) tags.push(`<span class="spell-tag conc">Conc.</span>`);
      if (spell.ritual) tags.push(`<span class="spell-tag ritual">Ritual</span>`);

      const lvStr = spell.level === 0 ? "Cantrip" : `Lv.${spell.level}`;
      card.innerHTML = `
        <div class="spell-name">${spell.name}</div>
        <div class="spell-info">${lvStr} — ${spell.description}</div>
        <div class="spell-tags">${tags.join("")}</div>
      `;

      // Only allow combat spells (has damage, save, or attack)
      const isCombat = spell.damage || spell.save || spell.isAttack;
      if (!isCombat) {
        card.classList.add("non-combat");
        card.title = "Non-combat spell";
      }

      card.addEventListener("click", () => {
        if (!isCombat) {
          logCombat(`<strong>${currentCharData?.name}</strong> casts <strong>${spell.name}</strong>`, "spell");
          hideSpellPicker();
          resetCombat();
          return;
        }
        onSpellSelected(spell.key, spell);
      });
      spellGrid.appendChild(card);
    }
  } else {
    // Fallback: hardcoded spells
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

  attackerData = { ...currentCharData };
  attackerTokenId = currentTokenId;
  document.querySelector(".hotbar-btn.spell")?.classList.add("active-action");

  if (spell.isAoE) {
    combatState = COMBAT.AOE_CASTING;
    showCombatOverlay(`${attackerData.name}: ${spell.name}`, "Click on a target token as the AoE center...");
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong> (${spell.aoeRadius}ft radius)`, "spell");
  } else if (spell.isAttack) {
    // Spell attack roll (like Eldritch Blast, Fire Bolt) — use attack flow
    combatAction = "spell-attack";
    combatState = COMBAT.TARGETING;
    selectedWeapon = {
      name: spell.name,
      attackBonus: spell.attackBonus || 0,
      damage: spell.damage || "1d10",
      damageType: spell.damageType || "Force",
      damageMod: 0,
      attackType: "ranged",
      properties: [],
      mastery: [],
    };
    showCombatOverlay(`${attackerData.name}: ${spell.name}`, "Click on a target token...");
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong>`, "spell");
  } else {
    combatAction = "spell-targeted";
    combatState = COMBAT.TARGETING;
    showCombatOverlay(`${attackerData.name}: ${spell.name}`, "Click on a target token...");
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong>`, "spell");
  }
}

// ════════════════════════════════════════
// ATTACK — Weapon Picker + Auto d20 Roll
// ════════════════════════════════════════

function hideActionPicker() { actionPicker.classList.remove("visible"); }

function buildWeaponGrid() {
  actionGrid.innerHTML = "";
  const char = currentCharData;
  if (!char || !char.weapons) return;
  const equipped = char.weapons.filter((w) => w.equipped);
  const list = equipped.length > 0 ? equipped : char.weapons;

  for (const weapon of list) {
    const card = document.createElement("div");
    card.className = "action-card";
    const atkSign = weapon.attackBonus >= 0 ? "+" : "";
    const dmgSign = weapon.damageMod >= 0 ? "+" : "";
    const props = (weapon.properties || []).join(", ");
    const masteryTags = (weapon.mastery || []).map(m => `<span class="mastery-tag">${m}</span>`).join("");
    card.innerHTML = `
      <div class="action-card-left">
        <div class="action-name">${weapon.name} ${masteryTags}</div>
        <div class="action-type">${weapon.type}${props ? " · " + props : ""}</div>
      </div>
      <div class="action-card-right">
        <span class="action-hit">${atkSign}${weapon.attackBonus}</span>
        <span class="action-dmg">${weapon.damage}${dmgSign}${weapon.damageMod} ${weapon.damageType || ""}</span>
      </div>
    `;
    card.addEventListener("click", () => onWeaponSelected(weapon));
    actionGrid.appendChild(card);
  }
}

function showWeaponPicker() {
  buildWeaponGrid();
  hideOtherPickers("action");
  actionPicker.classList.add("visible");
}

function onWeaponSelected(weapon) {
  selectedWeapon = weapon;
  hideActionPicker();
  combatState = COMBAT.TARGETING;
  combatAction = "attack";
  attackerData = { ...currentCharData };
  attackerTokenId = currentTokenId;
  document.querySelector(".hotbar-btn.attack")?.classList.add("active-action");
  showCombatOverlay(`${attackerData.name}: ${weapon.name}`, "Click on an enemy token...");
  logCombat(`<strong>${attackerData.name}</strong> readies <strong>${weapon.name}</strong> (${weapon.attackBonus >= 0 ? "+" : ""}${weapon.attackBonus} to hit)`, "info");
}

actionCancel.addEventListener("click", () => { hideActionPicker(); resetCombat(); });

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
    // Add skull if token dropped to 0 HP
    if (r.char) {
      const meta = r.token.metadata?.[METADATA_KEY];
      if (meta?.character?.hp?.current === 0) {
        addSkullToToken(r.token.id);
      }
    }
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
// SAVING THROW PICKER
// ════════════════════════════════════════

function buildSaveGrid() {
  saveGrid.innerHTML = "";
  const saves = currentCharData?.savingThrows || [];
  if (saves.length === 0) {
    // Fallback: build from stats if savingThrows not parsed
    const stats = currentCharData?.stats || [];
    for (const s of stats) {
      const card = document.createElement("div");
      card.className = "save-card";
      card.innerHTML = `<div class="save-name">${s.name}</div><div class="save-mod">${s.modifier >= 0 ? "+" : ""}${s.modifier}</div>`;
      card.addEventListener("click", () => onSaveSelected({ name: s.name, modifier: s.modifier }));
      saveGrid.appendChild(card);
    }
    return;
  }

  for (const save of saves) {
    const card = document.createElement("div");
    card.className = `save-card${save.proficient ? " proficient" : ""}`;
    card.innerHTML = `
      <div class="save-name">${save.name}</div>
      <div class="save-mod">${save.modifier >= 0 ? "+" : ""}${save.modifier}</div>
    `;
    card.addEventListener("click", () => onSaveSelected(save));
    saveGrid.appendChild(card);
  }
}

function showSavePicker() {
  buildSaveGrid();
  savePicker.classList.add("visible");
  hideOtherPickers("save");
}

function hideSavePicker() { savePicker.classList.remove("visible"); }

async function onSaveSelected(save) {
  hideSavePicker();
  await rollDice("1d20", `${currentCharData.name} ${save.name} Save`, save.modifier);
}

saveCancel.addEventListener("click", hideSavePicker);

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

// ════════════════════════════════════════
// INVENTORY PANEL
// ════════════════════════════════════════

const ITEM_ICONS = {
  Weapon: "⚔️", Armor: "🛡️", Potion: "🧪", Scroll: "📜",
  Wondrous: "✨", Ring: "💍", Rod: "🔮", Staff: "🪄",
  Wand: "🪄", Ammunition: "🏹", Gear: "⚙️", Tool: "🔧",
  Pack: "🎒", Other: "📦",
};

function getItemIcon(item) {
  if (item.type === "Weapon") return "⚔️";
  if (item.type === "Armor") return "🛡️";
  if (item.subType?.includes("Potion")) return "🧪";
  if (item.subType?.includes("Scroll")) return "📜";
  if (item.isMagic) return "✨";
  const key = Object.keys(ITEM_ICONS).find(k => item.type?.includes(k) || item.subType?.includes(k));
  return ITEM_ICONS[key] || "📦";
}

let currentInvFilter = "all";

function showInventoryPanel() {
  buildInventoryList();
  inventoryPanel.classList.add("visible");
  hideOtherPickers("inventory");
}

function buildInventoryList() {
  const char = currentCharData;
  if (!char) return;

  const items = char.inventory || [];
  const currency = char.currency || {};

  // Currency display
  const coins = [];
  if (currency.pp) coins.push(`<span class="pp">${currency.pp} pp</span>`);
  if (currency.gp) coins.push(`<span class="gp">${currency.gp} gp</span>`);
  if (currency.ep) coins.push(`<span class="ep">${currency.ep} ep</span>`);
  if (currency.sp) coins.push(`<span class="sp">${currency.sp} sp</span>`);
  if (currency.cp) coins.push(`<span class="cp">${currency.cp} cp</span>`);
  invCurrency.innerHTML = coins.join("") || '<span style="color:#555">No coins</span>';

  // Filter items
  let filtered = items;
  if (currentInvFilter === "equipped") {
    filtered = items.filter(i => i.equipped);
  } else if (currentInvFilter === "gear") {
    filtered = items.filter(i => i.type !== "Weapon" && i.type !== "Armor");
  } else if (currentInvFilter !== "all") {
    filtered = items.filter(i => i.type === currentInvFilter);
  }

  // Sort: equipped first, then magic, then alphabetical
  filtered.sort((a, b) => {
    if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
    if (a.isMagic !== b.isMagic) return a.isMagic ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  invList.innerHTML = "";

  if (filtered.length === 0) {
    invList.innerHTML = '<div style="color:#555;font-size:10px;text-align:center;padding:16px">No items found</div>';
  }

  for (const item of filtered) {
    const el = document.createElement("div");
    const classes = ["inv-item"];
    if (item.equipped) classes.push("equipped");
    if (item.isMagic) classes.push("magic");
    el.className = classes.join(" ");

    const icon = getItemIcon(item);
    const detail = item.notes || item.type || "";
    const qtyStr = item.quantity > 1 ? `<span class="inv-item-qty">x${item.quantity}</span>` : "";
    const weightStr = item.weight ? `<span class="inv-item-weight">${item.weight * (item.quantity || 1)} lb</span>` : "";
    const equippedTag = item.equipped ? '<span class="inv-item-equipped-tag">E</span>' : "";

    el.innerHTML = `
      <span class="inv-item-icon">${icon}</span>
      <div class="inv-item-info">
        <div class="inv-item-name">${item.name}${item.isMagic ? " ✦" : ""}</div>
        <div class="inv-item-detail">${detail}</div>
      </div>
      ${qtyStr}${weightStr}${equippedTag}
    `;

    invList.appendChild(el);
  }

  // Footer: total weight
  const totalWeight = items.reduce((sum, i) => sum + (i.weight || 0) * (i.quantity || 1), 0);
  invFooter.textContent = `${items.length} items — ${totalWeight.toFixed(1)} lb total`;

  // Tab highlight
  document.querySelectorAll(".inv-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.filter === currentInvFilter);
  });
}

// Tab click handlers
document.getElementById("inv-tabs")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".inv-tab");
  if (!tab) return;
  currentInvFilter = tab.dataset.filter;
  buildInventoryList();
});

invClose?.addEventListener("click", hideInventoryPanel);

// ════════════════════════════════════════
// FEATURES & TRAITS PANEL
// ════════════════════════════════════════

let currentFeatFilter = "all";

function showFeaturesPanel() {
  buildFeaturesList();
  featuresPanel.classList.add("visible");
  hideOtherPickers("features");
}

function hideFeaturesPanel() { featuresPanel.classList.remove("visible"); }

function buildFeaturesList() {
  const char = currentCharData;
  if (!char) return;

  const features = char.features || [];
  featList.innerHTML = "";

  // Filter
  let filtered = features;
  if (currentFeatFilter !== "all") {
    filtered = features.filter(f => f.source === currentFeatFilter);
  }

  if (filtered.length === 0) {
    featList.innerHTML = '<div style="color:#555;font-size:10px;text-align:center;padding:16px">No features found</div>';
    return;
  }

  for (const feat of filtered) {
    const el = document.createElement("div");
    const classes = ["feat-item"];
    if (feat.maxUses !== null) classes.push("has-uses");
    if (feat.maxUses !== null && feat.remaining === 0) classes.push("depleted");
    el.className = classes.join(" ");

    // Tags
    const tags = [];
    if (feat.activationType) {
      const tagClass = feat.activationType === "Bonus Action" ? "bonus" : feat.activationType === "Reaction" ? "reaction" : "action";
      tags.push(`<span class="feat-tag ${tagClass}">${feat.activationType}</span>`);
    }
    if (feat.resetType) tags.push(`<span class="feat-tag rest">${feat.resetType}</span>`);
    if (feat.saveStat) tags.push(`<span class="feat-tag save">${feat.saveStat} Save</span>`);
    if (feat.dice) tags.push(`<span class="feat-tag dice">${feat.dice}</span>`);

    // Uses pips
    let usesHTML = "";
    if (feat.maxUses !== null) {
      const pips = [];
      for (let i = 0; i < feat.maxUses; i++) {
        pips.push(`<span class="feat-use-pip ${i < feat.remaining ? "filled" : "empty"}"></span>`);
      }
      // Show pips if <= 10, otherwise show number
      if (feat.maxUses <= 10) {
        usesHTML = `<div class="feat-uses">${pips.join("")}</div>`;
      } else {
        usesHTML = `<div class="feat-uses" style="font-size:10px;color:#e97045;font-weight:700">${feat.remaining}/${feat.maxUses}</div>`;
      }
    }

    // Use button for activatable features
    let btnHTML = "";
    if (feat.maxUses !== null && feat.activationType) {
      btnHTML = `<button class="feat-use-btn" data-feat-key="${feat.key}" ${feat.remaining <= 0 ? "disabled" : ""}>Use</button>`;
    } else if (!feat.maxUses && feat.activationType) {
      btnHTML = `<button class="feat-use-btn" data-feat-key="${feat.key}">Use</button>`;
    }

    el.innerHTML = `
      <div class="feat-item-top">
        <span class="feat-item-name">${feat.name}</span>
        <span class="feat-item-source">${feat.sourceType || feat.source}</span>
      </div>
      <div class="feat-item-desc">${feat.description}</div>
      <div class="feat-item-bottom">
        <div class="feat-item-tags">${tags.join("")}</div>
        <div style="display:flex;align-items:center;gap:4px">
          ${usesHTML}
          ${btnHTML}
        </div>
      </div>
    `;

    featList.appendChild(el);
  }

  // Tab highlights
  document.querySelectorAll(".feat-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.filter === currentFeatFilter);
  });
}

// Tab click handlers
document.getElementById("feat-tabs")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".feat-tab");
  if (!tab) return;
  currentFeatFilter = tab.dataset.filter;
  buildFeaturesList();
});

// Use button clicks — delegate from feat-list
featList?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".feat-use-btn");
  if (!btn || btn.disabled) return;

  const key = btn.dataset.featKey;
  const char = currentCharData;
  if (!char || !char.features) return;

  const feat = char.features.find(f => f.key === key);
  if (!feat) return;

  // Decrement uses if has limited uses
  if (feat.maxUses !== null) {
    if (feat.remaining <= 0) {
      await OBR.notification.show(`${feat.name}: No uses remaining!`, "WARNING");
      return;
    }
    feat.remaining = Math.max(0, feat.remaining - 1);
    feat.usedCount = (feat.usedCount || 0) + 1;

    // Save updated uses to OBR metadata
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        const meta = item.metadata[METADATA_KEY];
        if (!meta?.character?.features) return;
        const f = meta.character.features.find(ff => ff.key === key);
        if (f) {
          f.remaining = feat.remaining;
          f.usedCount = feat.usedCount;
        }
        meta.lastUpdated = Date.now();
      }
    });
    currentCharData._lastUpdated = Date.now();
  }

  // Log it
  const usesStr = feat.maxUses !== null ? ` (${feat.remaining}/${feat.maxUses} remaining)` : "";
  logCombat(`📜 <strong>${char.name}</strong> uses <strong>${feat.name}</strong>${usesStr}`, "info");
  await OBR.notification.show(`${char.name} uses ${feat.name}!`, "SUCCESS");

  // Start turn-based tracking for duration effects
  const durationMap = { rage: 10 };
  const duration = durationMap[key];
  if (duration) {
    await addActiveEffect(currentTokenId, char.name, feat.name, key, duration);
    logCombat(`🔥 <strong>${char.name}</strong> enters <strong>${feat.name}</strong>! (${duration} turns)`, "spell");
  }

  // Rebuild the list to update pips
  buildFeaturesList();
});

featClose?.addEventListener("click", hideFeaturesPanel);

// ════════════════════════════════════════
// ACTIVE EFFECTS — Turn-based duration tracking
// ════════════════════════════════════════

async function getActiveEffects() {
  const roomMeta = await OBR.room.getMetadata();
  return roomMeta[EFFECTS_METADATA_KEY] || [];
}

async function setActiveEffects(effects) {
  await OBR.room.setMetadata({ [EFFECTS_METADATA_KEY]: effects });
}

async function addActiveEffect(tokenId, charName, effectName, effectKey, totalTurns) {
  const effects = await getActiveEffects();
  // Remove existing same effect on same token
  const filtered = effects.filter(e => !(e.tokenId === tokenId && e.key === effectKey));
  filtered.push({
    tokenId,
    charName,
    effectName,
    key: effectKey,
    turnsRemaining: totalTurns,
    totalTurns,
  });
  await setActiveEffects(filtered);
}

async function removeActiveEffect(tokenId, effectKey) {
  const effects = await getActiveEffects();
  const filtered = effects.filter(e => !(e.tokenId === tokenId && e.key === effectKey));
  await setActiveEffects(filtered);
}

async function tickActiveEffects(activeTokenId) {
  const effects = await getActiveEffects();
  if (effects.length === 0) return;

  const updated = [];
  for (const effect of effects) {
    // Only tick effects belonging to the token whose turn just started
    if (effect.tokenId === activeTokenId) {
      effect.turnsRemaining--;

      if (effect.turnsRemaining <= 0) {
        // Effect expired
        logCombat(`⏰ <strong>${effect.charName}</strong>'s <strong>${effect.effectName}</strong> has ended!`, "info");
        // Don't add to updated — it's removed
        continue;
      } else {
        logCombat(`🔥 <strong>${effect.charName}</strong> — <strong>${effect.effectName}</strong>: <strong>${effect.turnsRemaining}</strong>/${effect.totalTurns} turns remaining`, "spell");
      }
    }
    updated.push(effect);
  }

  await setActiveEffects(updated);
}

async function onBonusSelected(action) {
  hideBonusPicker();
  logCombat(`⚡ <strong>${currentCharData.name}</strong> uses bonus action: <strong>${action.name}</strong>`, "info");

  if (action.type === "attack") {
    selectedWeapon = action.weapon || null;
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
  if (except !== "save") savePicker.classList.remove("visible");
  if (except !== "bonus") bonusPicker.classList.remove("visible");
  if (except !== "condition") conditionPicker.classList.remove("visible");
  if (except !== "inventory") inventoryPanel.classList.remove("visible");
  if (except !== "features") featuresPanel.classList.remove("visible");
}

// ════════════════════════════════════════
// AoE SPELL FLOW
// ════════════════════════════════════════

async function castAoeSpell(centerToken) {
  const spell = selectedSpell;
  const caster = attackerData;
  const dc = spell.spellDC || getSpellcastingDC(caster);

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

// ════════════════════════════════════════
// TOKEN EFFECTS — animate tokens on the OBR board
// ════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shakeToken(tokenId, { intensity = 10, steps = 8, duration = 400 } = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const orig = { x: items[0].position.x, y: items[0].position.y };
    const stepDur = duration / steps;

    for (let i = 0; i < steps; i++) {
      const factor = 1 - i / steps; // decay over time
      const dx = (Math.random() - 0.5) * intensity * 2 * factor;
      const dy = (Math.random() - 0.5) * intensity * 2 * factor;
      await OBR.scene.items.updateItems([tokenId], (items) => {
        items[0].position = { x: orig.x + dx, y: orig.y + dy };
      });
      await sleep(stepDur);
    }

    // Restore original position
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].position = orig;
    });
  } catch (err) {
    console.warn("shakeToken error:", err);
  }
}

async function pulseToken(tokenId, { scaleFactor = 1.25, duration = 300 } = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const origScale = { x: items[0].scale.x, y: items[0].scale.y };

    // Scale up
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].scale = { x: origScale.x * scaleFactor, y: origScale.y * scaleFactor };
    });
    await sleep(duration / 2);

    // Scale back
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].scale = origScale;
    });
  } catch (err) {
    console.warn("pulseToken error:", err);
  }
}

async function dodgeToken(tokenId, { distance = 25, duration = 250 } = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const orig = { x: items[0].position.x, y: items[0].position.y };

    // Pick a random dodge direction
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    // Dodge out
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].position = { x: orig.x + dx, y: orig.y + dy };
    });
    await sleep(duration * 0.6);

    // Return to original
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].position = orig;
    });
  } catch (err) {
    console.warn("dodgeToken error:", err);
  }
}

async function spinToken(tokenId, { degrees = 15, duration = 300 } = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const origRot = items[0].rotation;

    // Spin one way
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].rotation = origRot + degrees;
    });
    await sleep(duration * 0.25);

    // Spin other way
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].rotation = origRot - degrees;
    });
    await sleep(duration * 0.25);

    // Back to center
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items[0].rotation = origRot;
    });
  } catch (err) {
    console.warn("spinToken error:", err);
  }
}

// Combined effect sequences
async function flashRedToken(tokenId, { flashes = 3, duration = 600 } = {}) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const origTint = items[0].style?.tintColor || null;
    const origOpacity = items[0].style?.tintOpacity ?? 0;
    const flashDur = duration / (flashes * 2);

    for (let i = 0; i < flashes; i++) {
      // Flash red
      await OBR.scene.items.updateItems([tokenId], (items) => {
        if (!items[0].style) items[0].style = {};
        items[0].style.tintColor = "#ff0000";
        items[0].style.tintOpacity = 0.7;
      });
      await sleep(flashDur);
      // Flash back
      await OBR.scene.items.updateItems([tokenId], (items) => {
        if (!items[0].style) items[0].style = {};
        items[0].style.tintColor = origTint;
        items[0].style.tintOpacity = origOpacity;
      });
      if (i < flashes - 1) await sleep(flashDur);
    }

    // Ensure restored to original
    await OBR.scene.items.updateItems([tokenId], (items) => {
      if (!items[0].style) items[0].style = {};
      items[0].style.tintColor = origTint;
      items[0].style.tintOpacity = origOpacity;
    });
  } catch (err) {
    console.warn("flashRedToken error:", err);
  }
}

async function tokenHitEffect(tokenId) {
  // Shake + pulse + red flash simultaneously
  await Promise.all([
    shakeToken(tokenId, { intensity: 12, steps: 6, duration: 350 }),
    pulseToken(tokenId, { scaleFactor: 1.15, duration: 300 }),
    flashRedToken(tokenId, { flashes: 2, duration: 400 }),
  ]);
}

async function tokenCritEffect(tokenId) {
  // Big shake + big pulse + spin + intense red flash — dramatic!
  await Promise.all([
    shakeToken(tokenId, { intensity: 20, steps: 10, duration: 600 }),
    pulseToken(tokenId, { scaleFactor: 1.35, duration: 400 }),
    spinToken(tokenId, { degrees: 20, duration: 500 }),
    flashRedToken(tokenId, { flashes: 4, duration: 700 }),
  ]);
}

async function tokenMissEffect(tokenId) {
  // Quick dodge to the side and back
  await dodgeToken(tokenId, { distance: 30, duration: 300 });
}

async function tokenDownEffect(tokenId) {
  // Token "collapses" — shrink + red flash + drop down
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;
    const origScale = { x: items[0].scale.x, y: items[0].scale.y };

    // Red flash + shrink simultaneously
    await Promise.all([
      flashRedToken(tokenId, { flashes: 5, duration: 800 }),
      (async () => {
        await OBR.scene.items.updateItems([tokenId], (items) => {
          items[0].scale = { x: origScale.x * 0.6, y: origScale.y * 0.6 };
        });
        await sleep(400);
        await OBR.scene.items.updateItems([tokenId], (items) => {
          items[0].scale = origScale;
        });
      })(),
    ]);
  } catch (err) {
    console.warn("tokenDownEffect error:", err);
  }
}

async function addSkullToToken(tokenId) {
  try {
    // Remove existing skull first (avoid duplicates)
    await removeSkullFromToken(tokenId);

    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items[0]) return;

    const skull = buildText()
      .plainText("💀")
      .fontSize(48)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .width(100)
      .height(100)
      .fillColor("#00000000")
      .fillOpacity(0)
      .strokeWidth(0)
      .position({ x: items[0].position.x, y: items[0].position.y })
      .attachedTo(tokenId)
      .locked(true)
      .disableHit(true)
      .layer("ATTACHMENT")
      .metadata({ [SKULL_METADATA_KEY]: { tokenId } })
      .build();

    await OBR.scene.items.addItems([skull]);
  } catch (err) {
    console.warn("addSkullToToken error:", err);
  }
}

async function removeSkullFromToken(tokenId) {
  try {
    const allItems = await OBR.scene.items.getItems((item) =>
      item.metadata?.[SKULL_METADATA_KEY]?.tokenId === tokenId
    );
    if (allItems.length > 0) {
      await OBR.scene.items.deleteItems(allItems.map((i) => i.id));
    }
  } catch (err) {
    console.warn("removeSkullFromToken error:", err);
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
  currentCharData._lastUpdated = Date.now();

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

    // Skull management: add on down, remove on heal
    if (finalCurrent === 0 && oldCurrent > 0) {
      addSkullToToken(currentTokenId);
    } else if (finalCurrent > 0 && oldCurrent === 0) {
      removeSkullFromToken(currentTokenId);
    }
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
// AC EDITOR (manual GM control)
// ════════════════════════════════════════

let acOriginal = null; // Store original AC from character data for reset

function openAcEditor() {
  if (!currentCharData) return;
  acOriginal = currentCharData.ac;
  refreshAcEditor();
  acEditor.classList.add("visible");
  hpEditor.classList.remove("visible"); // Close HP editor if open
}

function refreshAcEditor() {
  if (!currentCharData) return;
  acDisplay.textContent = currentCharData.ac;
  acEditorCurrent.innerHTML = `AC: <strong>${currentCharData.ac}</strong>${acOriginal !== null && acOriginal !== currentCharData.ac ? ` <span class="ac-base">(base: ${acOriginal})</span>` : ""}`;
}

async function applyAcChange(newAc) {
  if (!currentTokenId || !currentCharData) return;
  const oldAc = currentCharData.ac;
  const finalAc = Math.max(0, newAc);

  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) return;
      meta.character.ac = finalAc;
      meta.lastUpdated = Date.now();
    }
  });

  currentCharData.ac = finalAc;
  currentCharData._lastUpdated = Date.now();
  showHotbar(currentCharData);
  refreshAcEditor();
  await syncInitiativeAC();

  if (oldAc !== finalAc) {
    logCombat(`🛡️ <strong>${currentCharData.name}</strong> AC: <strong>${oldAc}</strong> → <strong>${finalAc}</strong>`, "info");
    await OBR.notification.show(`${currentCharData.name}: AC ${oldAc} → ${finalAc}`, "INFO");
  }
}

async function syncInitiativeAC() {
  const state = await getInitiativeState();
  if (!state || !state.order.length) return;

  const tokenIds = state.order.map((e) => e.tokenId);
  const items = await OBR.scene.items.getItems(tokenIds);

  let changed = false;
  for (const entry of state.order) {
    const item = items.find((i) => i.id === entry.tokenId);
    const char = item?.metadata?.[METADATA_KEY]?.character;
    if (char && entry.ac !== char.ac) {
      entry.ac = char.ac;
      changed = true;
    }
  }

  if (changed) await setInitiativeState(state);
}

document.getElementById("ac-btn-plus").addEventListener("click", async () => {
  if (!currentCharData) return;
  await applyAcChange(currentCharData.ac + 1);
});

document.getElementById("ac-btn-minus").addEventListener("click", async () => {
  if (!currentCharData) return;
  await applyAcChange(currentCharData.ac - 1);
});

document.getElementById("ac-btn-set").addEventListener("click", async () => {
  const val = parseInt(acSetInput.value);
  if (isNaN(val)) return;
  await applyAcChange(val);
  acSetInput.value = "";
});

document.getElementById("ac-btn-reset").addEventListener("click", async () => {
  if (acOriginal !== null) {
    await applyAcChange(acOriginal);
  }
});

document.getElementById("ac-btn-close").addEventListener("click", () => {
  acEditor.classList.remove("visible");
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

    char._lastUpdated = Date.now();
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

    character._lastUpdated = Date.now();
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

// Initiative: manual add mode — select token, enter value, add to list
let pendingInitTokens = [];
let initAddMode = false;
let initPendingToken = null;

const initInputPanel = document.getElementById("init-input-panel");
const initInputList = document.getElementById("init-input-list");
const initAddLabel = document.getElementById("init-add-label");
const initAddValue = document.getElementById("init-add-value");
const initAddBtn = document.getElementById("init-add-btn");
const initConfirmBtn = document.getElementById("init-input-confirm");

initRollBtn.addEventListener("click", () => {
  pendingInitTokens = [];
  initAddMode = true;
  initPendingToken = null;
  initTrack.innerHTML = "";
  initInputList.innerHTML = "";
  initInputPanel.classList.add("visible");
  initRollBtn.classList.add("hidden");
  initAddLabel.textContent = "Select a token on the board...";
  initAddValue.classList.add("hidden");
  initAddBtn.classList.add("hidden");
  initConfirmBtn.classList.add("hidden");
});

function onInitTokenSelected(item) {
  if (!initAddMode) return;
  const meta = item.metadata?.[METADATA_KEY];
  const char = meta?.character;
  initPendingToken = {
    tokenId: item.id,
    name: char?.name || item.name || "Unknown",
    hpCurrent: char?.hp?.current ?? 0,
    hpMax: char?.hp?.max ?? 0,
    ac: char?.ac ?? 10,
    isMonster: meta?.isMonster || false,
  };
  initAddLabel.textContent = initPendingToken.name;
  initAddValue.classList.remove("hidden");
  initAddBtn.classList.remove("hidden");
  document.getElementById("init-roll-d20").classList.remove("hidden");
  initAddValue.value = "";
  initAddValue.focus();
}

initAddBtn.addEventListener("click", addInitToken);
initAddValue.addEventListener("keydown", (e) => { if (e.key === "Enter") addInitToken(); });

// Roll d20 + DEX for initiative
document.getElementById("init-roll-d20").addEventListener("click", () => {
  if (!initPendingToken) return;
  // Get DEX modifier from the token's character data
  const tokenId = initPendingToken.tokenId;
  OBR.scene.items.getItems([tokenId]).then(items => {
    const token = items[0];
    const char = token?.metadata?.[METADATA_KEY]?.character;
    const dexMod = char?.stats?.find(s => s.name === "DEX")?.modifier || 0;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + dexMod;
    initAddValue.value = total;
    const modStr = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;
    logCombat(`🎲 <strong>${initPendingToken.name}</strong> rolls initiative: <strong>${roll}</strong> ${modStr} = <strong>${total}</strong>`);
    // Flash the input
    initAddValue.style.borderColor = "#e9a045";
    initAddValue.style.background = "#e9a04533";
    setTimeout(() => { initAddValue.style.borderColor = ""; initAddValue.style.background = ""; }, 600);
  });
});

function addInitToken() {
  if (!initPendingToken) return;
  const val = parseInt(initAddValue.value) || 0;
  if (pendingInitTokens.some((t) => t.tokenId === initPendingToken.tokenId)) {
    const existing = pendingInitTokens.find((t) => t.tokenId === initPendingToken.tokenId);
    existing.initiative = val;
  } else {
    pendingInitTokens.push({ ...initPendingToken, initiative: val });
  }
  initPendingToken = null;
  renderInitInputList();
  initAddLabel.textContent = "Select next token...";
  initAddValue.classList.add("hidden");
  initAddBtn.classList.add("hidden");
  document.getElementById("init-roll-d20").classList.add("hidden");
  initConfirmBtn.classList.remove("hidden");
}

function renderInitInputList() {
  initInputList.innerHTML = pendingInitTokens.map((t, i) => `
    <div class="init-added-row">
      <span class="init-added-val">${t.initiative}</span>
      <span class="init-added-name">${t.name}</span>
      <button class="init-remove-btn" data-idx="${i}">✕</button>
    </div>
  `).join("");
  initInputList.querySelectorAll(".init-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingInitTokens.splice(parseInt(btn.dataset.idx), 1);
      renderInitInputList();
      if (pendingInitTokens.length === 0) initConfirmBtn.classList.add("hidden");
    });
  });
}

document.getElementById("init-input-cancel").addEventListener("click", () => {
  initAddMode = false;
  initPendingToken = null;
  pendingInitTokens = [];
  initInputPanel.classList.remove("visible");
  initRollBtn.classList.remove("hidden");
});

initConfirmBtn.addEventListener("click", async () => {
  if (pendingInitTokens.length === 0) return;
  initAddMode = false;

  const entries = [...pendingInitTokens].sort((a, b) => b.initiative - a.initiative);
  const state = { order: entries, currentIndex: 0, round: 1 };
  await setInitiativeState(state);

  const logLines = entries.map(
    (e) => `<strong>${e.name}</strong>: <strong>${e.initiative}</strong>`
  ).join(" | ");
  logCombat(`Initiative set! ${logLines}`, "init");

  await OBR.notification.show(`Initiative set for ${entries.length} combatants!`, "SUCCESS");
  if (entries.length > 0) await OBR.player.select([entries[0].tokenId]);
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

  // Tick active effects for the character whose turn just started
  await tickActiveEffects(current.tokenId);

  await OBR.notification.show(`${current.name}'s turn! (Round ${nextRound})`, "INFO");
  await OBR.player.select([current.tokenId]);
});

// End Combat
initEndBtn.addEventListener("click", async () => {
  await setInitiativeState(null);
  // Clear all active effects
  const effects = await getActiveEffects();
  if (effects.length > 0) {
    for (const e of effects) logCombat(`⏰ <strong>${e.charName}</strong>'s <strong>${e.effectName}</strong> ends (combat over)`, "info");
    await setActiveEffects([]);
  }
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

  // Listen for combat log broadcasts from other players
  OBR.broadcast.onMessage(COMBAT_LOG_CHANNEL, (event) => {
    // Only add locally — don't re-broadcast (addLogEntry doesn't broadcast)
    addLogEntry(event.data.html, event.data.type);
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

  // Watch for token metadata changes (e.g. another player syncing character data)
  OBR.scene.items.onChange((items) => {
    if (!currentTokenId) return;
    const token = items.find(i => i.id === currentTokenId);
    if (!token) return;
    const meta = token.metadata?.[METADATA_KEY];
    if (!meta?.character) return;

    // Check if the data actually changed
    const newUpdated = meta.lastUpdated || 0;
    const oldUpdated = currentCharData?._lastUpdated || 0;
    if (newUpdated <= oldUpdated) return;

    // Update local data
    const char = meta.character;
    char._lastUpdated = newUpdated;
    currentCharData = char;
    showHotbar(char);

    // Refresh open panels
    if (inventoryPanel.classList.contains("visible")) {
      buildInventoryList();
    }
    if (featuresPanel.classList.contains("visible")) {
      buildFeaturesList();
    }

    // Refresh condition badges
    currentConditions = token.metadata?.[COND_METADATA_KEY] || [];
    renderConditionBadges();
  });
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

  if (initAddMode && selection?.length > 0) {
    const items = await OBR.scene.items.getItems(selection);
    const token = items.find((i) => i.layer === "CHARACTER");
    if (token) onInitTokenSelected(token);
  }

  if (!selection || selection.length === 0) { hideAll(); return; }

  const items = await OBR.scene.items.getItems(selection);
  const token = items.find((i) => i.layer === "CHARACTER");

  if (!token) { hideAll(); return; }

  currentTokenId = token.id;
  const meta = token.metadata?.[METADATA_KEY];
  currentConditions = token.metadata?.[COND_METADATA_KEY] || [];

  if (meta?.character) {
    meta.character._lastUpdated = meta.lastUpdated || 0;
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

  // Show weapon picker — weapon selection will enter targeting
  if (action === "attack") { showWeaponPicker(); return; }

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

  // Auto-roll d20 attack with weapon bonus
  const atkBonus = selectedWeapon?.attackBonus || 0;
  const weaponName = selectedWeapon?.name || "Attack";
  showCombatOverlay(`${attackerData.name}: ${weaponName} → ${targetName}`, `Rolling to hit... (AC ${targetAC})`);

  const rollLabel = `${attackerData.name} ${weaponName}`;
  await rollAttackD20(rollLabel, atkBonus, targetAC, targetName);
}


async function castSingleTargetSaveSpell(targetToken) {
  const spell = selectedSpell;
  const caster = attackerData;
  const dc = spell.spellDC || getSpellcastingDC(caster);
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


async function rollAttackD20(label, atkBonus, targetAC, targetName) {
  // Roll raw d20
  let diceTotal;
  let used3D = false;

  // Try 3D dice-box first
  if (diceReady && diceBox) {
    try {
      show3DOverlay(label);

      const results = await Promise.race([
        diceBox.roll("1d20"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D attack roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  // Fallback to canvas
  if (!used3D) {
    diceTotal = rollDiceValues("1d20").diceTotal;
  }

  const natValue = diceTotal;
  const finalTotal = diceTotal + atkBonus;

  const result = {
    notation: "1d20", diceTotal, modifier: atkBonus, finalTotal, natValue,
    charName: attackerData?.name || "", label, rollId: crypto.randomUUID(),
  };

  // SFX
  if (natValue === 20) setTimeout(() => playSfx("crit"), 150);
  else if (natValue === 1) setTimeout(() => playSfx("miss"), 150);

  if (used3D) {
    show3DResult(label, result);
    // Hold 3D result for 5 seconds
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    showDiceResultDisplay(label, result, "d20");
    // Wait for dice animation (2.8s) + result hold (5s)
    await new Promise((r) => setTimeout(r, 8000));
  }

  // Broadcast
  const modStr = atkBonus >= 0 ? `+${atkBonus}` : `${atkBonus}`;
  const notifText = `${attackerData?.name || ""} attacks ${targetName}: ${diceTotal}${modStr} = ${finalTotal} vs AC ${targetAC}`;
  OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO").catch(() => {});
  OBR.broadcast.sendMessage(SFX_CHANNEL, { sound: natValue === 20 ? "crit" : natValue === 1 ? "miss" : "dice-hit" }).catch(() => {});

  // Log attack roll
  const hitStr = natValue === 20 ? "NAT 20!" : natValue === 1 ? "NAT 1" : `${finalTotal} vs AC ${targetAC}`;
  logCombat(`<strong>${attackerData.name}</strong> rolls to hit: ${diceTotal}${modStr} = <strong>${finalTotal}</strong> (${hitStr})`, "info");

  // Hide dice display
  if (used3D) hide3DOverlay();

  // Determine outcome
  const isCrit = natValue === 20;
  const isNat1 = natValue === 1;
  const isHit = isCrit || (!isNat1 && finalTotal >= targetAC);

  if (isHit) {
    resolveAttackRoll({ finalTotal, natValue });
  } else {
    resolveAttackRoll({ finalTotal, natValue: isNat1 ? 1 : 0 });
  }
}

async function resolveAttackRoll(result) {
  const { natValue, finalTotal } = result;
  const targetName = targetData?.name || "Target";
  const isCrit = natValue === 20;
  const isMiss = natValue === 1 || (!isCrit && natValue === 0);

  if (isMiss) {
    // ── Graze mastery: on miss (not nat 1), deal ability mod damage ──
    const hasGraze = selectedWeapon?.mastery?.includes("Graze");
    if (hasGraze && natValue !== 1) {
      const grazeDmg = Math.max(0, selectedWeapon.abilityMod || selectedWeapon.damageMod || 0);
      const dmgType = selectedWeapon.damageType || "damage";
      logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="miss">MISS!</strong> but <strong class="hit">Graze</strong> deals <strong class="damage">${grazeDmg}</strong> ${dmgType}`, "hit");
      showCombatOverlay(`MISS — Graze!`, `${grazeDmg} ${dmgType} damage`);
      playMissEffect();
      await broadcastSfx("miss");
      if (targetTokenId) tokenMissEffect(targetTokenId);

      // Apply graze damage
      if (targetData && targetTokenId && grazeDmg > 0) {
        let remaining = grazeDmg;
        let newTemp = targetData.hp.temp || 0;
        if (newTemp > 0) { const absorbed = Math.min(newTemp, remaining); newTemp -= absorbed; remaining -= absorbed; }
        const newCurrent = Math.max(0, targetData.hp.current - remaining);
        await OBR.scene.items.updateItems([targetTokenId], (items) => {
          for (const item of items) {
            const meta = item.metadata[METADATA_KEY];
            if (!meta?.character) return;
            meta.character.hp.current = newCurrent;
            meta.character.hp.temp = newTemp;
            meta.lastUpdated = Date.now();
          }
        });
        await syncInitiativeHP();
        logCombat(`${targetName}: ${targetData.hp.current} → <strong>${newCurrent}</strong>/${targetData.hp.max} HP`, "damage");
        await OBR.notification.show(`${attackerData.name} grazes ${targetName} for ${grazeDmg} damage!`, "WARNING");
        if (newCurrent === 0) addSkullToToken(targetTokenId);
      }
      setTimeout(() => resetCombat(), 2500);
      return;
    }

    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="miss">MISS!</strong>`, "miss");
    showCombatOverlay(`MISS!`, `${attackerData.name}'s attack misses.`);
    playMissEffect();
    await broadcastSfx("miss");
    if (targetTokenId) tokenMissEffect(targetTokenId);
    await OBR.notification.show(`${attackerData.name} missed ${targetName}!`, "WARNING");
    setTimeout(() => resetCombat(), 2000);
    return;
  }

  if (isCrit) {
    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="crit">CRITICAL HIT!</strong>`, "crit");
    showCombatOverlay(`CRITICAL HIT!`, `Rolling damage...`);
  } else {
    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="hit">HIT!</strong>`, "hit");
    showCombatOverlay(`HIT!`, `Rolling damage...`);
  }

  attackRollResult = { natValue };
  combatState = COMBAT.ROLLING_DAMAGE;

  // Show damage roll panel for player to roll
  const hitLabel = isCrit ? `CRIT! → ${targetName}` : `HIT! → ${targetName}`;
  showDamageRollPanel(hitLabel, isCrit);
}

// ── Damage Roll Panel (player clicks to roll) ──
const damageRollPanel = document.getElementById("damage-roll-panel");
const damageRollTitle = document.getElementById("damage-roll-title");
const damageRollInfo = document.getElementById("damage-roll-info");
const damageRollBtn = document.getElementById("damage-roll-btn");
let pendingDamageCrit = false;

function showDamageRollPanel(title, isCrit) {
  pendingDamageCrit = isCrit;
  damageRollTitle.textContent = title || "Roll Damage";

  if (selectedWeapon && selectedWeapon.damage) {
    const baseDice = selectedWeapon.damage;
    const mod = selectedWeapon.damageMod || 0;
    const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : "";
    const dmgType = selectedWeapon.damageType || "";
    let notation = baseDice;
    if (isCrit) {
      notation = baseDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
    }
    damageRollInfo.textContent = `${selectedWeapon.name}: ${notation}${modStr} ${dmgType}${isCrit ? " (CRIT x2 dice)" : ""}`;
    damageRollBtn.textContent = `🎲 Roll ${notation}${modStr}`;
  } else {
    damageRollInfo.textContent = "";
    damageRollBtn.textContent = "🎲 Roll Damage";
  }

  damageRollPanel.classList.add("visible");
}

function hideDamageRollPanel() { damageRollPanel.classList.remove("visible"); }

damageRollBtn.addEventListener("click", async () => {
  if (!selectedWeapon || !selectedWeapon.damage) {
    // Fallback to manual if no weapon data
    hideDamageRollPanel();
    showDamageInput("Enter Damage");
    return;
  }
  hideDamageRollPanel();
  const targetName = targetData?.name || "Target";
  await rollDamageDice(pendingDamageCrit, targetName);
});

document.getElementById("damage-roll-cancel").addEventListener("click", () => {
  hideDamageRollPanel();
  resetCombat();
});

async function rollDamageDice(isCrit, targetName) {
  const weapon = selectedWeapon;
  const baseDice = weapon.damage || "1d4";
  const damageMod = weapon.damageMod || 0;
  const damageType = weapon.damageType || "damage";

  // Determine die type from weapon damage (e.g., "1d8" → "d8")
  const dieType = parseDieType(baseDice) || "d6";

  // For crit: double the dice (e.g., 1d8 → 2d8, 2d6 → 4d6)
  let notation = baseDice;
  if (isCrit) {
    notation = baseDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
  }

  let diceTotal, individualResults;
  let used3D = false;

  // Try 3D dice-box first
  if (diceReady && diceBox) {
    try {
      show3DOverlay(`${attackerData.name} ${weapon.name} ${isCrit ? "CRIT " : ""}Damage`);

      const results = await Promise.race([
        diceBox.roll(notation),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D damage roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  // Fallback to canvas
  if (!used3D) {
    const rolled = rollDiceValues(notation);
    diceTotal = rolled.diceTotal;
    individualResults = rolled.individualResults;
  }

  const totalDamage = Math.max(0, diceTotal + damageMod);
  const label = `${attackerData.name} ${weapon.name} ${isCrit ? "CRIT " : ""}Damage`;
  const modStr = damageMod > 0 ? `+${damageMod}` : damageMod < 0 ? `${damageMod}` : "";

  const result = {
    notation, diceTotal, modifier: damageMod, finalTotal: totalDamage,
    natValue: null, charName: attackerData?.name || "", label,
    rollId: crypto.randomUUID(), individualResults,
  };

  if (used3D) {
    show3DResult(label, result);
    // Hold 3D result for 5 seconds
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    showDiceResultDisplay(label, result, dieType);
    // Wait for dice animation (2.8s) + result hold (5s)
    await new Promise((r) => setTimeout(r, 8000));
  }

  // Log damage roll with individual dice
  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  logCombat(
    `<strong>${attackerData.name}</strong> ${weapon.name} damage: ${notation} → ${diceStr}${modStr} = <strong class="damage">${totalDamage}</strong> ${damageType}${isCrit ? " (CRIT!)" : ""}`,
    isCrit ? "crit" : "damage"
  );

  // Broadcast
  OBR.broadcast.sendMessage(SFX_CHANNEL, { sound: "dice-hit" }).catch(() => {});

  // Hide dice
  if (used3D) hide3DOverlay();

  // Apply damage
  await resolveDamage({ finalTotal: totalDamage });
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

  // Token effects on the board!
  if (targetTokenId) {
    if (isCrit) {
      tokenCritEffect(targetTokenId);
    } else {
      tokenHitEffect(targetTokenId);
    }
  }

  setTimeout(async () => {
    await broadcastSfx("damage");
    await showFloatingDamage(targetTokenId, damage, selectedWeapon?.damageType || "Slashing", { isCrit });
    // If target is down, play collapse effect
    if (isDown && targetTokenId) {
      tokenDownEffect(targetTokenId);
      addSkullToToken(targetTokenId);
    }
  }, 400);

  // ── Weapon Mastery effects on hit ──
  applyMasteryOnHit(targetName, isDown);

  setTimeout(() => resetCombat(), 3200);
}

function applyMasteryOnHit(targetName, isDown) {
  const mastery = selectedWeapon?.mastery;
  if (!mastery || mastery.length === 0 || isDown) return;

  for (const m of mastery) {
    switch (m) {
      case "Sap":
        logCombat(`⚔️ <strong>Sap</strong>: ${targetName} has <strong>disadvantage</strong> on next attack roll`, "info");
        break;
      case "Slow":
        logCombat(`⚔️ <strong>Slow</strong>: ${targetName}'s speed reduced by <strong>10 ft</strong> until start of ${attackerData.name}'s next turn`, "info");
        break;
      case "Topple": {
        const dc = 8 + (selectedWeapon.abilityMod || 0) + (attackerData.proficiencyBonus || 2);
        const conMod = getSaveMod(targetData, "CON");
        const saveResult = rollSave(conMod);
        const saved = saveResult.total >= dc;
        if (saved) {
          logCombat(`⚔️ <strong>Topple</strong>: ${targetName} CON Save ${saveResult.roll}+${conMod}=${saveResult.total} vs DC ${dc} — <strong class="hit">SAVED</strong>`, "info");
        } else {
          logCombat(`⚔️ <strong>Topple</strong>: ${targetName} CON Save ${saveResult.roll}+${conMod}=${saveResult.total} vs DC ${dc} — <strong class="miss">PRONE!</strong>`, "hit");
        }
        break;
      }
      case "Push":
        logCombat(`⚔️ <strong>Push</strong>: ${targetName} pushed <strong>10 ft</strong> away`, "info");
        break;
      case "Vex":
        logCombat(`⚔️ <strong>Vex</strong>: ${attackerData.name} has <strong>advantage</strong> on next attack vs ${targetName}`, "info");
        break;
      case "Nick":
        logCombat(`⚔️ <strong>Nick</strong>: ${attackerData.name} can make an extra attack as part of the Attack action`, "info");
        break;
      case "Cleave":
        logCombat(`⚔️ <strong>Cleave</strong>: ${attackerData.name} can hit another creature within 5ft of ${targetName} (${selectedWeapon.abilityMod || 0} ${selectedWeapon.damageType} damage)`, "info");
        break;
    }
  }
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
    // Check WebGL support first
    const testCanvas = document.createElement("canvas");
    const gl = testCanvas.getContext("webgl") || testCanvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL not supported");

    // Resolve asset paths: origin = page origin, assetPath = relative path to assets
    const base = import.meta.env.BASE_URL || "/";
    const origin = window.location.origin + base;
    const assetPath = "dice-assets/assets/";

    console.log("[dice] Initializing dice-box with:", { origin, assetPath });

    // Make container visible so dice-box can create WebGL canvas with proper dimensions
    const overlay = document.getElementById("dice-overlay");
    overlay.style.cssText = "display:block;position:absolute;left:-9999px;width:500px;height:320px;";

    // v1.1+ new API: single config object
    diceBox = new DiceBox({
      container: "#dice-box",
      assetPath,
      origin,
      scale: 6,
      theme: "default",
      themeColor: "#e94560",
      offscreen: false,       // Force onscreen mode (no Web Worker — works in iframes)
      enableShadows: true,
      shadowTransparency: 0.7,
      lightIntensity: 1.2,
      gravity: 3,
      delay: 10,
      settleTimeout: 5000,
      suspendSimulation: false,
    });
    await diceBox.init();

    // Hide again — CSS class will control visibility
    overlay.style.cssText = "";
    overlay.className = "";

    diceReady = true;
    console.log("[dice] ✅ 3D dice-box initialized successfully");
  } catch (err) {
    console.warn("[dice] 3D dice init failed, will use canvas fallback:", err.message, err);
    // Restore overlay styles
    const overlay = document.getElementById("dice-overlay");
    if (overlay) overlay.style.cssText = "";
    diceReady = false;
  }
  diceInitializing = false;
}

function show3DOverlay(label) {
  diceOverlay.className = "visible";
  dice3dLabel.textContent = label || "";
  dice3dResult.classList.remove("visible");
  dice3dResult.innerHTML = "";
  try { diceBox?.clear(); } catch {}
  // Trigger resize so canvas matches container size
  if (diceBox) {
    requestAnimationFrame(() => {
      try { window.dispatchEvent(new Event("resize")); } catch {}
    });
  }
}

function hide3DOverlay() {
  diceOverlay.className = "";
  dice3dResult.classList.remove("visible");
  try { diceBox?.clear(); } catch {}
}

function rollDiceValues(notation) {
  let diceTotal = 0;
  let sides = 20;
  let diceCount = 0;
  const individualResults = [];
  const parts = notation.replace(/\s/g, "").split("+");
  for (const part of parts) {
    const match = part.match(/^(\d+)d(\d+)$/);
    if (match) {
      const count = parseInt(match[1]);
      sides = parseInt(match[2]);
      for (let i = 0; i < count; i++) {
        const val = Math.floor(Math.random() * sides) + 1;
        diceTotal += val;
        individualResults.push(val);
        diceCount++;
      }
    } else {
      diceTotal += parseInt(part) || 0;
    }
  }
  const isSingleD20 = notation.trim() === "1d20";
  return { diceTotal, sides, diceCount, isSingleD20, individualResults };
}

function showDiceResultDisplay(label, result, dieType) {
  const { diceTotal, modifier, finalTotal, natValue, individualResults } = result;
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const detail = modifier !== 0 ? `${diceTotal}${modStr} = ${finalTotal}` : `${diceTotal}`;

  const resolvedDie = dieType || parseDieType(result.notation) || "d20";

  // Use individual results for multi-dice, or single total
  const diceResults = (individualResults && individualResults.length > 1) ? individualResults : diceTotal;

  // Phase 1: Show rolling dice
  diceResultLabel.textContent = label || "";
  diceResultValue.textContent = "";
  diceResultDetail.textContent = "";
  diceResultEl.className = "visible rolling";

  const canvas = document.getElementById("d20-canvas");
  stopDiceRoll();
  startDiceRoll(canvas, 2800, resolvedDie, diceResults, () => {
    // Roll done — show result
    playSfx("dice-hit");

    setTimeout(() => {
      diceResultEl.classList.remove("rolling");
      diceResultEl.classList.add("show-result");
      if (natValue === 20) diceResultEl.classList.add("nat-crit");
      else if (natValue === 1) diceResultEl.classList.add("nat-fail");

      let extraText = "";
      if (natValue === 20) extraText = " NAT 20!";
      else if (natValue === 1) extraText = " NAT 1";

      diceResultValue.textContent = finalTotal;
      diceResultDetail.textContent = detail + extraText;

      clearTimeout(diceResultEl._hideTimer);
      diceResultEl._hideTimer = setTimeout(() => {
        diceResultEl.className = "";
      }, 5000);
    }, 300);
  });
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

  const { diceTotal: fallbackTotal, isSingleD20, individualResults: fallbackIndividual } = rollDiceValues(notation);
  let diceTotal = fallbackTotal;
  let individualResults = fallbackIndividual;
  let used3D = false;

  const charName = attackerData?.name || currentCharData?.name || "";

  // Try embedded 3D dice-box first
  if (diceReady && diceBox) {
    try {
      show3DOverlay(label || notation);

      const results = await Promise.race([
        diceBox.roll(notation),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      // Let dice settle visually
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D roll failed, using canvas fallback:", err.message);
      hide3DOverlay();
    }
  }

  const finalTotal = diceTotal + modifier;
  const natValue = isSingleD20 ? diceTotal : null;

  const result = {
    notation, diceTotal, modifier, finalTotal, natValue,
    charName, label, rollId: rid, individualResults,
  };

  // SFX for nat 20/1
  if (natValue === 20) setTimeout(() => playSfx("crit"), 150);
  else if (natValue === 1) setTimeout(() => playSfx("miss"), 150);

  // Show result
  const dieType = parseDieType(notation) || "d20";
  if (used3D) {
    show3DResult(label, result);
    // Hold 3D result for 5 seconds
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    showDiceResultDisplay(label, result, dieType);
    // Wait for dice animation (2.8s) + result display (5s)
    await new Promise((r) => setTimeout(r, 3200));
  }

  // Broadcast SFX + notification AFTER display
  const sfxName = natValue === 20 ? "crit" : natValue === 1 ? "miss" : "dice-hit";
  OBR.broadcast.sendMessage(SFX_CHANNEL, { sound: sfxName }).catch(() => {});

  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "";
  const notifText = charName
    ? `${charName} rolled ${notation}${modStr}: ${finalTotal}${natValue === 20 ? " (NAT 20!)" : natValue === 1 ? " (NAT 1)" : ""}`
    : `Rolled ${notation}${modStr}: ${finalTotal}`;
  OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO").catch(() => {});

  // Log to combat log for all players
  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  const logModStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const logTotal = modifier !== 0 ? ` = <strong>${finalTotal}</strong>` : "";
  let natTag = "";
  if (natValue === 20) natTag = ' <strong class="crit">NAT 20!</strong>';
  else if (natValue === 1) natTag = ' <strong class="miss">NAT 1</strong>';
  const who = charName ? `<strong>${charName}</strong>` : "🎲";
  const logLabel = label ? ` ${label}:` : "";
  logCombat(`${who}${logLabel} ${notation} → ${diceStr}${logModStr}${logTotal}${natTag}`, natValue === 20 ? "crit" : natValue === 1 ? "miss" : "info");

  // Wait for result to be visible for 5 seconds total
  await new Promise((r) => setTimeout(r, !used3D ? 5000 : 0));

  // Auto-hide 3D overlay
  if (used3D) {
    setTimeout(() => hide3DOverlay(), 500);
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

  // Hide Spell button if character has no spells
  const spellBtn = document.querySelector('.hotbar-btn.spell');
  if (spellBtn) {
    const hasSpells = char.spells && char.spells.length > 0;
    spellBtn.style.display = hasSpells ? "" : "none";
  }

  // Hide Features button if character has no features
  const featBtn = document.querySelector('.hotbar-btn.features-btn');
  if (featBtn) {
    const hasFeatures = char.features && char.features.length > 0;
    featBtn.style.display = hasFeatures ? "" : "none";
  }

  // Make HP chip clickable to open editor
  const hpChip = statsBar.querySelector(".stat-chip.hp");
  if (hpChip) {
    hpChip.addEventListener("click", openHpEditor);
    hpChip.title = "Click to edit HP";
  }

  // Make AC chip clickable to open editor
  const acChip = statsBar.querySelector(".stat-chip.ac");
  if (acChip) {
    acChip.addEventListener("click", openAcEditor);
    acChip.title = "Click to edit AC";
  }
}

function hideHotbar() { hotbar.classList.add("hidden"); statsBar.classList.add("hidden"); conditionBar.classList.add("hidden"); hpEditor.classList.remove("visible"); acEditor.classList.remove("visible"); tokenNameEl.textContent = ""; currentCharData = null; currentConditions = []; }

function hideInventoryPanel() { inventoryPanel.classList.remove("visible"); }
function hideAll() { hideHotbar(); hideError(); linkPanel.classList.add("hidden"); hideSpellPicker(); hideConditionPicker(); hideActionPicker(); hideSkillPicker(); hideSavePicker(); hideBonusPicker(); hideAoeResults(); hideDamageRollPanel(); hideInventoryPanel(); hideFeaturesPanel(); currentTokenId = null; }

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

    if (action === "defend") {
      if (savePicker.classList.contains("visible")) hideSavePicker();
      else showSavePicker();
      return;
    }

    if (action === "bonus") {
      if (bonusPicker.classList.contains("visible")) hideBonusPicker();
      else showBonusPicker();
      return;
    }

    if (action === "inventory") {
      if (inventoryPanel.classList.contains("visible")) hideInventoryPanel();
      else showInventoryPanel();
      return;
    }

    if (action === "features") {
      if (featuresPanel.classList.contains("visible")) hideFeaturesPanel();
      else showFeaturesPanel();
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
    char._lastUpdated = Date.now();
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
    result.character._lastUpdated = Date.now();
    currentCharData = result.character;
    showHotbar(result.character);
    // Refresh inventory if open
    if (inventoryPanel.classList.contains("visible")) buildInventoryList();
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
