import OBR, { buildText } from "@owlbear-rodeo/sdk";
import DiceBox from "@3d-dice/dice-box";
import "@3d-dice/dice-box/dist/style.css";
import { SPELLS, getSpellcastingDC, getSaveMod, tokensInRadius, rollSave, parseDamageNotation, DPI_PER_FOOT } from "./spells.js";
import { CONDITIONS, getConditionPenalty, shouldAutoFailSave, getAttackerConditionEffects, getTargetConditionEffects, getSaveConditionEffects, getCheckConditionEffects, isIncapacitated, getMeleeDamageBonus, getTagColor } from "./conditions.js";
import { playSfx } from "./sfx.js";
import { playHitEffect, playCritEffect, playMissEffect, playHealEffect, playSpellEffect, screenShake, getDiceColor } from "./effects.js";
import { parseCharacter } from "./server/parser.js";
import { MONSTER_TEMPLATES, getMonsterGroups } from "./monsters.js";
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

// Token save panel
const tokenSavePanel = document.getElementById("token-save-panel");

// Monster importer
const monsterJson = document.getElementById("monster-json");
const monsterApplyBtn = document.getElementById("monster-apply-btn");
const monsterStatus = document.getElementById("monster-status");

// Monster template selector
const monsterTemplateSelect = document.getElementById("monster-template-select");
const monsterTemplateBtn = document.getElementById("monster-template-btn");

// Populate template dropdown
{
  const groups = getMonsterGroups();
  for (const [label, monsters] of Object.entries(groups)) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const m of monsters) {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.name;
      optgroup.appendChild(opt);
    }
    monsterTemplateSelect.appendChild(optgroup);
  }
}

monsterTemplateBtn.addEventListener("click", () => {
  const key = monsterTemplateSelect.value;
  if (!key || !MONSTER_TEMPLATES[key]) return;
  monsterJson.value = JSON.stringify(MONSTER_TEMPLATES[key], null, 2);
  setMonsterStatus(`Loaded: ${MONSTER_TEMPLATES[key].name}`, false, true);
});

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


// ── Format helpers ──
/** Format a signed modifier: fmtMod(3)→"+3", fmtMod(-1)→"−1", fmtMod(0)→"+0" */
function fmtMod(v) { return v >= 0 ? `+${v}` : `−${Math.abs(v)}`; }

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

    // Spell Slots display
    const spellSlots = currentCharData?.spellSlots || [];
    if (spellSlots.length > 0) {
      const slotsRow = document.createElement("div");
      slotsRow.className = "spell-slots-row";
      for (const slot of spellSlots) {
        const pips = [];
        for (let i = 0; i < slot.max; i++) {
          const filled = i < slot.remaining;
          pips.push(`<span class="slot-pip ${filled ? "filled" : "empty"}" data-slot-level="${slot.level}" data-pip-index="${i}"></span>`);
        }
        const pactLabel = slot.isPact ? " (Pact)" : "";
        const depletedClass = slot.remaining === 0 ? " depleted" : "";
        slotsRow.innerHTML += `
          <div class="spell-slot-group${depletedClass}" data-slot-level="${slot.level}">
            <span class="slot-label">Lv.${slot.level}${pactLabel}</span>
            <span class="slot-pips">${pips.join("")}</span>
            <span class="slot-count">${slot.remaining}/${slot.max}</span>
          </div>
        `;
      }
      // Click on pips to toggle slot usage
      slotsRow.addEventListener("click", async (e) => {
        const pip = e.target.closest(".slot-pip");
        if (!pip || !currentCharData?.spellSlots) return;
        const level = parseInt(pip.dataset.slotLevel);
        const slot = currentCharData.spellSlots.find(s => s.level === level);
        if (!slot) return;

        const pipIndex = parseInt(pip.dataset.pipIndex);
        const isFilled = pip.classList.contains("filled");

        if (isFilled) {
          // Use a slot (click filled pip → empty it)
          slot.remaining = Math.max(0, slot.remaining - 1);
          slot.used = slot.max - slot.remaining;
        } else {
          // Restore a slot (click empty pip → fill it)
          slot.remaining = Math.min(slot.max, slot.remaining + 1);
          slot.used = slot.max - slot.remaining;
        }

        // Save to OBR
        await OBR.scene.items.updateItems([currentTokenId], (items) => {
          for (const item of items) {
            const meta = item.metadata[METADATA_KEY];
            if (!meta?.character?.spellSlots) return;
            const s = meta.character.spellSlots.find(sl => sl.level === level);
            if (s) { s.remaining = slot.remaining; s.used = slot.used; }
            meta.lastUpdated = Date.now();
          }
        });
        currentCharData._lastUpdated = Date.now();

        // Rebuild spell grid to reflect changes
        buildSpellGrid();
      });
      spellGrid.appendChild(slotsRow);
    }

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
      if (spell.aoeDamage) tags.push(`<span class="spell-tag dmg">${spell.aoeDamage} ${spell.aoeDamageType || ""}</span>`);
      if (spell.healing) {
        const healMod = spell.healingMod ? `+${spell.healingMod}` : "";
        tags.push(`<span class="spell-tag heal">${spell.healing}${healMod} ❤️</span>`);
      } else if (spell.isHealing) tags.push(`<span class="spell-tag heal">Heal</span>`);
      if (spell.concentration) tags.push(`<span class="spell-tag conc">Conc.</span>`);
      if (spell.ritual) tags.push(`<span class="spell-tag ritual">Ritual</span>`);

      const lvStr = spell.level === 0 ? "Cantrip" : `Lv.${spell.level}`;
      // Show slot info for leveled spells
      let slotInfo = "";
      if (spell.level > 0 && currentCharData?.spellSlots) {
        const slot = currentCharData.spellSlots.find(s => s.level === spell.level);
        if (slot) {
          const noSlots = slot.remaining <= 0;
          slotInfo = `<span class="spell-slot-info${noSlots ? " no-slots" : ""}">${slot.remaining}/${slot.max}</span>`;
        }
      }
      card.innerHTML = `
        <div class="spell-name">${spell.name}${slotInfo}</div>
        <div class="spell-info">${lvStr} — ${spell.description}</div>
        <div class="spell-tags">${tags.join("")}</div>
      `;

      // Only allow combat spells (has damage, save, or attack)
      const isCombat = spell.damage || spell.save || spell.isAttack;
      if (!isCombat) {
        card.classList.add("non-combat");
        card.title = "Non-combat spell";
      }

      card.addEventListener("click", async () => {
        if (!isCombat) {
          // Expend slot for non-cantrip non-combat spells
          if (spell.level > 0 && currentCharData?.spellSlots) {
            const slot = currentCharData.spellSlots.find(s => s.level === spell.level && s.remaining > 0);
            if (slot) {
              slot.remaining--;
              slot.used++;
              await OBR.scene.items.updateItems([currentTokenId], (items) => {
                for (const item of items) {
                  const meta = item.metadata[METADATA_KEY];
                  if (!meta?.character?.spellSlots) return;
                  const s = meta.character.spellSlots.find(sl => sl.level === spell.level);
                  if (s) { s.remaining = slot.remaining; s.used = slot.used; }
                  meta.lastUpdated = Date.now();
                }
              });
              currentCharData._lastUpdated = Date.now();
              logCombat(`🔮 Lv.${spell.level} spell slot expended (${slot.remaining}/${slot.max} remaining)`, "spell");
            }
          }
          logCombat(`<strong>${currentCharData?.name}</strong> casts <strong>${spell.name}</strong>`, "spell");
          // Roll healing/damage dice if available
          if (spell.damage && currentCharData) {
            await rollDice(spell.damage, `${currentCharData.name} ${spell.name} (${spell.damageType || "damage"})`, 0);
          } else if (spell.healing && currentCharData) {
            await rollDice(spell.healing, `${currentCharData.name} ${spell.name} (Healing)`, spell.healingMod || 0);
          }
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

async function onSpellSelected(key, spell) {
  selectedSpell = { key, ...spell };
  hideSpellPicker();

  // Expend spell slot if not a cantrip
  if (spell.level > 0 && currentCharData?.spellSlots) {
    const slot = currentCharData.spellSlots.find(s => s.level === spell.level && s.remaining > 0);
    if (slot) {
      slot.remaining--;
      slot.used++;
      // Save to OBR
      await OBR.scene.items.updateItems([currentTokenId], (items) => {
        for (const item of items) {
          const meta = item.metadata[METADATA_KEY];
          if (!meta?.character?.spellSlots) return;
          const s = meta.character.spellSlots.find(sl => sl.level === spell.level);
          if (s) { s.remaining = slot.remaining; s.used = slot.used; }
          meta.lastUpdated = Date.now();
        }
      });
      currentCharData._lastUpdated = Date.now();
      logCombat(`🔮 Lv.${spell.level} spell slot expended (${slot.remaining}/${slot.max} remaining)`, "spell");
    } else {
      logCombat(`⚠️ No Lv.${spell.level} spell slots remaining!`, "info");
    }
  }

  attackerData = { ...currentCharData };
  attackerTokenId = currentTokenId;
  document.querySelector(".hotbar-btn.spell")?.classList.add("active-action");

  if (spell.isAttack && spell.aoeDamage && spell.save) {
    // Combo spell (e.g. Ice Knife): attack roll + AoE save damage
    combatAction = "spell-combo";
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
    logCombat(`<strong>${attackerData.name}</strong> prepares <strong>${spell.name}</strong> (${spell.aoeRadius}ft AoE after hit)`, "spell");
  } else if (spell.isAoE) {
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
    const atkBonus = weapon.attackBonus ?? 0;
    const dmgMod = weapon.damageMod ?? 0;
    const atkSign = atkBonus >= 0 ? "+" : "";
    const dmgStr = dmgMod !== 0 ? fmtMod(dmgMod) : "";
    const props = (weapon.properties || []).join(", ");
    const masteryTags = (weapon.mastery || []).map(m => `<span class="mastery-tag">${m}</span>`).join("");
    card.innerHTML = `
      <div class="action-card-left">
        <div class="action-name">${weapon.name} ${masteryTags}</div>
        <div class="action-type">${weapon.type}${props ? " · " + props : ""}</div>
      </div>
      <div class="action-card-right">
        <span class="action-hit">${atkSign}${atkBonus}</span>
        <span class="action-dmg">${weapon.damage}${dmgStr} ${weapon.damageType || ""}</span>
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
  const wb = weapon.attackBonus ?? 0;
  logCombat(`<strong>${attackerData.name}</strong> readies <strong>${weapon.name}</strong> (${wb >= 0 ? "+" : ""}${wb} to hit)`, "info");
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
  const checkFx = getCheckConditionEffects(currentConditions, skill.ability);
  let advStr = "";
  if (checkFx.advantage) advStr = " (Advantage)";
  if (checkFx.disadvantage) advStr = " (Disadvantage)";
  const notation = (checkFx.advantage || checkFx.disadvantage) ? "2d20" : "1d20";
  await rollDice(notation, `${currentCharData.name} ${skill.name}${advStr}`, skill.modifier, null, checkFx);
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
  const saveFx = getSaveConditionEffects(currentConditions, save.name);
  if (saveFx.autoFail) {
    logCombat(`❌ <strong>${currentCharData.name}</strong> <strong>${save.name} Save</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "info");
    await OBR.notification.show(`${currentCharData.name} auto-fails ${save.name} Save!`, "ERROR");
    return;
  }
  let advStr = "";
  if (saveFx.advantage) advStr = " (Advantage)";
  if (saveFx.disadvantage) advStr = " (Disadvantage)";
  const notation = (saveFx.advantage || saveFx.disadvantage) ? "2d20" : "1d20";
  await rollDice(notation, `${currentCharData.name} ${save.name} Save${advStr}`, save.modifier, null, saveFx);
}

saveCancel.addEventListener("click", hideSavePicker);

// ════════════════════════════════════════
// BONUS ACTION PICKER
// ════════════════════════════════════════

function buildBonusGrid() {
  bonusGrid.innerHTML = "";
  const actions = currentCharData?.bonusActions || [];
  if (actions.length === 0) { bonusGrid.innerHTML = '<div style="color:#8899aa;font-size:10px;text-align:center;padding:8px">No bonus actions available</div>'; return; }

  const typeIcons = { attack: "⚔️", spell: "🔮", movement: "💨", defense: "🛡️", support: "🎵", heal: "💚", item: "🧪", damage: "💥", other: "⚡" };
  for (const a of actions) {
    const card = document.createElement("div");
    card.className = "bonus-card";
    const icon = typeIcons[a.type] || "⚡";
    const diceTag = a.dice ? `<span class="bonus-dice">${a.dice}</span>` : "";
    card.innerHTML = `<div class="bonus-name">${icon} ${a.name}${diceTag}</div><div class="bonus-desc">${a.description}</div>`;
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
  updateBackupInfo();
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
  coins.push(`<span class="gp">${currency.gp || 0} gp</span>`);
  if (currency.ep) coins.push(`<span class="ep">${currency.ep} ep</span>`);
  if (currency.sp) coins.push(`<span class="sp">${currency.sp} sp</span>`);
  if (currency.cp) coins.push(`<span class="cp">${currency.cp} cp</span>`);
  coins.push(`<button class="inv-currency-edit-btn" id="inv-currency-edit" title="Edit currency">✏️</button>`);
  invCurrency.innerHTML = coins.join("");

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

    const idx = items.indexOf(item);
    const equipTitle = item.equipped ? "Unequip" : "Equip";
    const equipIcon = item.equipped ? "✓" : "E";

    el.innerHTML = `
      <span class="inv-item-icon">${icon}</span>
      <div class="inv-item-info">
        <div class="inv-item-name">${item.name}${item.isMagic ? " ✦" : ""}</div>
        <div class="inv-item-detail">${detail}</div>
      </div>
      <input type="number" class="inv-item-qty-edit" value="${item.quantity || 1}" min="1" data-idx="${idx}" title="Quantity" />
      ${weightStr}
      <div class="inv-item-actions">
        <button class="inv-item-action equip ${item.equipped ? "active" : ""}" data-idx="${idx}" title="${equipTitle}">${equipIcon}</button>
        <button class="inv-item-action delete" data-idx="${idx}" title="Remove">✕</button>
      </div>
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

// ── Inventory edit handlers (delegated from inv-list) ──
invList?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".inv-item-action");
  if (!btn || !currentCharData || !currentTokenId) return;

  const idx = parseInt(btn.dataset.idx);
  const items = currentCharData.inventory || [];
  if (idx < 0 || idx >= items.length) return;

  if (btn.classList.contains("equip")) {
    // Toggle equipped
    items[idx].equipped = !items[idx].equipped;
    await saveInventory();
    buildInventoryList();
  } else if (btn.classList.contains("delete")) {
    // Remove item
    const name = items[idx].name;
    items.splice(idx, 1);
    await saveInventory();
    buildInventoryList();
    logCombat(`🗑️ <strong>${currentCharData.name}</strong> removed <strong>${name}</strong> from inventory`, "info");
  }
});

invList?.addEventListener("change", async (e) => {
  const input = e.target.closest(".inv-item-qty-edit");
  if (!input || !currentCharData || !currentTokenId) return;

  const idx = parseInt(input.dataset.idx);
  const items = currentCharData.inventory || [];
  if (idx < 0 || idx >= items.length) return;

  const newQty = Math.max(1, parseInt(input.value) || 1);
  items[idx].quantity = newQty;
  await saveInventory();
  buildInventoryList();
});

// Add item
document.getElementById("inv-add-btn")?.addEventListener("click", async () => {
  const nameInput = document.getElementById("inv-add-name");
  const qtyInput = document.getElementById("inv-add-qty");
  const name = nameInput.value.trim();
  if (!name || !currentCharData || !currentTokenId) return;

  const qty = Math.max(1, parseInt(qtyInput.value) || 1);
  const items = currentCharData.inventory || [];
  items.push({
    name,
    type: "Other",
    subType: "",
    equipped: false,
    quantity: qty,
    weight: 0,
    cost: 0,
    costUnit: "gp",
    rarity: "Common",
    description: "",
    notes: "",
    isAttuned: false,
    isMagic: false,
    canEquip: true,
  });
  currentCharData.inventory = items;
  await saveInventory();
  buildInventoryList();
  nameInput.value = "";
  qtyInput.value = "1";
  logCombat(`🎒 <strong>${currentCharData.name}</strong> added <strong>${name}</strong> x${qty} to inventory`, "info");
});

document.getElementById("inv-add-name")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("inv-add-btn")?.click();
});

async function saveInventory() {
  if (!currentTokenId || !currentCharData) return;
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) return;
      meta.character.inventory = currentCharData.inventory;
      meta.character.currency = currentCharData.currency;
      meta.lastUpdated = Date.now();
    }
  });
  currentCharData._lastUpdated = Date.now();
}

// ── Currency edit ──
invCurrency?.addEventListener("click", (e) => {
  const editBtn = e.target.closest("#inv-currency-edit");
  if (!editBtn || !currentCharData) return;

  const currency = currentCharData.currency || {};
  invCurrency.innerHTML = `
    <span class="inv-coin-group"><span class="inv-coin-label">pp</span><input type="number" class="inv-coin-edit" data-coin="pp" value="${currency.pp || 0}" /></span>
    <span class="inv-coin-group"><span class="inv-coin-label">gp</span><input type="number" class="inv-coin-edit" data-coin="gp" value="${currency.gp || 0}" /></span>
    <span class="inv-coin-group"><span class="inv-coin-label">ep</span><input type="number" class="inv-coin-edit" data-coin="ep" value="${currency.ep || 0}" /></span>
    <span class="inv-coin-group"><span class="inv-coin-label">sp</span><input type="number" class="inv-coin-edit" data-coin="sp" value="${currency.sp || 0}" /></span>
    <span class="inv-coin-group"><span class="inv-coin-label">cp</span><input type="number" class="inv-coin-edit" data-coin="cp" value="${currency.cp || 0}" /></span>
    <button class="inv-coin-save">✓ Save</button>
  `;

  invCurrency.querySelector(".inv-coin-save")?.addEventListener("click", async () => {
    const newCurrency = {};
    invCurrency.querySelectorAll(".inv-coin-edit").forEach(input => {
      newCurrency[input.dataset.coin] = Math.max(0, parseInt(input.value) || 0);
    });
    currentCharData.currency = newCurrency;
    await saveInventory();
    buildInventoryList();
    logCombat(`💰 <strong>${currentCharData.name}</strong> updated currency`, "info");
  });
});

// ── Inventory Backup / Restore ──
const INV_BACKUP_PREFIX = "dnd-inv-backup:";

function getBackupKey() {
  if (!currentCharData?.name) return null;
  return INV_BACKUP_PREFIX + currentCharData.name;
}

function updateBackupInfo() {
  const info = document.getElementById("inv-backup-info");
  const loadBtn = document.getElementById("inv-load-btn");
  if (!info) return;
  const key = getBackupKey();
  if (!key) { info.textContent = ""; return; }
  const raw = localStorage.getItem(key);
  if (!raw) {
    info.textContent = "No backup";
    loadBtn?.classList.remove("has-backup");
    return;
  }
  try {
    const backup = JSON.parse(raw);
    const date = new Date(backup.savedAt);
    const timeStr = date.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const itemCount = backup.inventory?.length || 0;
    info.innerHTML = `Last: <span class="time">${timeStr}</span> (${itemCount} items)`;
    loadBtn?.classList.add("has-backup");
  } catch {
    info.textContent = "No backup";
    loadBtn?.classList.remove("has-backup");
  }
}

document.getElementById("inv-save-btn")?.addEventListener("click", () => {
  if (!currentCharData) return;
  const key = getBackupKey();
  if (!key) return;
  const backup = {
    savedAt: Date.now(),
    charName: currentCharData.name,
    inventory: JSON.parse(JSON.stringify(currentCharData.inventory || [])),
    currency: JSON.parse(JSON.stringify(currentCharData.currency || {})),
  };
  localStorage.setItem(key, JSON.stringify(backup));
  updateBackupInfo();
  logCombat(`💾 <strong>${currentCharData.name}</strong> inventory backed up (${backup.inventory.length} items)`, "info");
  OBR.notification.show(`Inventory saved for ${currentCharData.name}!`, "SUCCESS");
});

document.getElementById("inv-load-btn")?.addEventListener("click", async () => {
  if (!currentCharData || !currentTokenId) return;
  const key = getBackupKey();
  if (!key) return;
  const raw = localStorage.getItem(key);
  if (!raw) {
    OBR.notification.show("No backup found for this character", "WARNING");
    return;
  }
  try {
    const backup = JSON.parse(raw);
    const date = new Date(backup.savedAt);
    const timeStr = date.toLocaleDateString("th-TH") + " " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const itemCount = backup.inventory?.length || 0;

    // Merge: keep items from backup, add any NEW items from current that aren't in backup
    const backupNames = new Set(backup.inventory.map(i => i.name));
    const currentOnly = (currentCharData.inventory || []).filter(i => !backupNames.has(i.name));

    if (currentOnly.length > 0) {
      // There are items in current inventory not in backup — merge them
      currentCharData.inventory = [...backup.inventory, ...currentOnly];
      logCombat(`📂 <strong>${currentCharData.name}</strong> loaded backup (${timeStr}) — ${itemCount} items restored + ${currentOnly.length} new items kept`, "info");
    } else {
      currentCharData.inventory = backup.inventory;
      logCombat(`📂 <strong>${currentCharData.name}</strong> loaded backup (${timeStr}) — ${itemCount} items restored`, "info");
    }
    currentCharData.currency = backup.currency;

    await saveInventory();
    buildInventoryList();
    OBR.notification.show(`Inventory restored for ${currentCharData.name}!`, "SUCCESS");
  } catch (err) {
    console.error("Failed to load backup:", err);
    OBR.notification.show("Failed to load backup", "ERROR");
  }
});

invClose?.addEventListener("click", hideInventoryPanel);

// ════════════════════════════════════════
// FEATURES & TRAITS PANEL
// ════════════════════════════════════════

let currentFeatFilter = "all";

function showFeaturesPanel() {
  buildFeaturesList();
  updateFeatBackupUI();
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

    // Dice roll button (for features with dice like Sneak Attack 1d6)
    let diceBtn = "";
    if (feat.dice) {
      diceBtn = `<button class="feat-dice-btn" data-dice="${feat.dice}" data-feat-name="${feat.name}" title="Roll ${feat.dice}">🎲</button>`;
    }

    // Use button — show for any feature with limited uses OR an activation type
    let btnHTML = "";
    if (feat.maxUses !== null) {
      btnHTML = `<button class="feat-use-btn" data-feat-key="${feat.key}" ${feat.remaining <= 0 ? "disabled" : ""}>Use</button>`;
    } else if (feat.activationType) {
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
          ${diceBtn}
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

// Dice roll button on features (e.g. Sneak Attack 1d6)
featList?.addEventListener("click", async (e) => {
  const diceBtn = e.target.closest(".feat-dice-btn");
  if (diceBtn) {
    e.stopPropagation();
    const dice = diceBtn.dataset.dice;
    const featName = diceBtn.dataset.featName;
    if (dice && currentCharData) {
      await rollDice(dice, `${currentCharData.name} ${featName}`, 0);
    }
    return;
  }

  // Use button clicks — delegate from feat-list
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

  // Start turn-based tracking for duration effects + auto-apply conditions
  // Match by prefix: "rage--enter-" matches "rage", etc.
  const durationRules = [
    { match: "rage", duration: 10, condition: "raging" },
  ];
  const rule = durationRules.find(r => key.startsWith(r.match));
  if (rule) {
    await addActiveEffect(currentTokenId, char.name, feat.name, key, rule.duration);
    logCombat(`🔥 <strong>${char.name}</strong> enters <strong>${feat.name}</strong>! (${rule.duration} turns)`, "spell");
  }
  // Auto-apply condition (e.g. Rage → Raging status)
  const autoCondition = rule?.condition;
  if (autoCondition && !currentConditions.includes(autoCondition)) {
    currentConditions.push(autoCondition);
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        item.metadata[COND_METADATA_KEY] = [...currentConditions];
      }
    });
    renderConditionBadges();
    const cond = CONDITIONS[autoCondition];
    logCombat(`${cond?.icon || "📌"} <strong>${cond?.name || autoCondition}</strong> applied to <strong>${char.name}</strong>`, "condition");
  }

  // Rebuild the list to update pips
  buildFeaturesList();
});

// ── Features Backup / Restore ──
const FEAT_BACKUP_PREFIX = "dnd-feat-backup:";

function getAllFeatBackups() {
  const backups = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith(FEAT_BACKUP_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      backups.push(data);
    } catch { /* skip */ }
  }
  backups.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return backups;
}

function updateFeatBackupUI() {
  const select = document.getElementById("feat-backup-select");
  const info = document.getElementById("feat-backup-info");
  if (!select) return;

  const backups = getAllFeatBackups();
  select.innerHTML = "";

  if (backups.length === 0) {
    select.innerHTML = '<option value="">No saves</option>';
    if (info) info.textContent = "";
    return;
  }

  for (const b of backups) {
    const date = new Date(b.savedAt);
    const timeStr = date.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const featCount = b.features?.length || 0;
    const opt = document.createElement("option");
    opt.value = b.charName;
    opt.textContent = `${b.charName} (${featCount} feats, ${timeStr})`;
    select.appendChild(opt);
  }

  // Show info for selected
  updateFeatBackupInfo();
}

function updateFeatBackupInfo() {
  const info = document.getElementById("feat-backup-info");
  const select = document.getElementById("feat-backup-select");
  if (!info || !select) return;
  const name = select.value;
  if (!name) { info.textContent = ""; return; }
  const key = FEAT_BACKUP_PREFIX + name;
  const raw = localStorage.getItem(key);
  if (!raw) { info.textContent = ""; return; }
  try {
    const b = JSON.parse(raw);
    const usable = (b.features || []).filter(f => f.maxUses !== null);
    const depleted = usable.filter(f => f.remaining < f.maxUses);
    info.innerHTML = `${depleted.length}/${usable.length} used`;
  } catch { info.textContent = ""; }
}

document.getElementById("feat-backup-select")?.addEventListener("change", updateFeatBackupInfo);

document.getElementById("feat-save-btn")?.addEventListener("click", () => {
  const char = currentCharData;
  if (!char?.features) return;
  const key = FEAT_BACKUP_PREFIX + char.name;
  const backup = {
    savedAt: Date.now(),
    charName: char.name,
    features: JSON.parse(JSON.stringify(char.features)),
  };
  localStorage.setItem(key, JSON.stringify(backup));
  updateFeatBackupUI();
  logCombat(`💾 <strong>${char.name}</strong> features saved (${char.features.length} feats)`, "info");
  OBR.notification.show(`Features saved for ${char.name}!`, "SUCCESS");
});

document.getElementById("feat-load-btn")?.addEventListener("click", async () => {
  if (!currentCharData || !currentTokenId) return;
  const select = document.getElementById("feat-backup-select");
  const selectedName = select?.value;
  if (!selectedName) {
    OBR.notification.show("No backup selected", "WARNING");
    return;
  }

  const raw = localStorage.getItem(FEAT_BACKUP_PREFIX + selectedName);
  if (!raw) {
    OBR.notification.show("Backup not found", "WARNING");
    return;
  }

  try {
    const backup = JSON.parse(raw);
    const backupFeats = backup.features || [];

    // Apply saved usage data to current features (match by key)
    const charFeats = currentCharData.features || [];
    let restored = 0;
    for (const feat of charFeats) {
      const saved = backupFeats.find(f => f.key === feat.key);
      if (saved && feat.maxUses !== null && saved.maxUses !== null) {
        feat.remaining = saved.remaining;
        feat.usedCount = saved.usedCount;
        restored++;
      }
    }

    // Add features that exist in backup but not current (custom/missing)
    const currentKeys = new Set(charFeats.map(f => f.key));
    const extras = backupFeats.filter(f => !currentKeys.has(f.key));
    if (extras.length > 0) {
      currentCharData.features = [...charFeats, ...extras];
    }

    // Save to OBR
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        const meta = item.metadata[METADATA_KEY];
        if (!meta?.character) return;
        meta.character.features = currentCharData.features;
        meta.lastUpdated = Date.now();
      }
    });
    currentCharData._lastUpdated = Date.now();

    buildFeaturesList();
    const fromLabel = selectedName === currentCharData.name ? "" : ` from <strong>${selectedName}</strong>`;
    logCombat(`📂 <strong>${currentCharData.name}</strong> loaded features${fromLabel} — ${restored} feat(s) restored`, "info");
    OBR.notification.show(`Features loaded! ${restored} feat(s) restored`, "SUCCESS");
  } catch (err) {
    console.error("Failed to load feat backup:", err);
    OBR.notification.show("Failed to load backup", "ERROR");
  }
});

// ════════════════════════════════════════
// TOKEN SAVE / LOAD
// ════════════════════════════════════════
const TOKEN_SAVE_PREFIX = "dnd-token-save:";

function getAllTokenSaves() {
  const saves = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith(TOKEN_SAVE_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      saves.push({ storageKey: key, ...data });
    } catch { /* skip */ }
  }
  saves.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return saves;
}

function showTokenSavePanel() {
  if (!currentCharData) return;
  buildTokenSaveList();
  tokenSavePanel.classList.add("visible");
  hideOtherPickers("token-save");
}

function buildTokenSaveList() {
  const char = currentCharData;
  if (!char) return;

  // Show current token info
  const currentInfo = document.getElementById("tsave-current");
  if (currentInfo) {
    const classStr = char.classes?.map(c => c.name).join("/") || char.race || "";
    const hpStr = `${char.hp.current}/${char.hp.max} HP`;
    const weaponCount = char.weapons?.length || 0;
    const spellCount = char.spells?.length || 0;
    const featCount = char.features?.length || 0;
    const invCount = char.inventory?.length || 0;
    // Defense badges (resistances, immunities, vulnerabilities)
    const defBadges = [];
    for (const r of (char.resistances || [])) {
      defBadges.push(`<span class="def-badge resist">Resist ${r.type}</span>`);
    }
    for (const r of (char.immunities || [])) {
      defBadges.push(`<span class="def-badge immune">Immune ${r.type}</span>`);
    }
    for (const r of (char.vulnerabilities || [])) {
      defBadges.push(`<span class="def-badge vuln">Vuln ${r.type}</span>`);
    }
    const defStr = defBadges.length ? `<div class="def-row">${defBadges.join("")}</div>` : "";

    currentInfo.innerHTML = `
      <strong>${char.name}</strong> — Lv.${char.level} ${classStr}<br>
      ${hpStr} · AC ${char.ac} · ${weaponCount} weapons · ${spellCount} spells · ${featCount} features · ${invCount} items
      ${defStr}
    `;
  }

  // Build saved list
  const list = document.getElementById("tsave-list");
  if (!list) return;
  const saves = getAllTokenSaves();

  if (saves.length === 0) {
    list.innerHTML = '<div style="color:#555;font-size:10px;text-align:center;padding:12px">No saved tokens yet</div>';
    return;
  }

  list.innerHTML = "";
  for (const save of saves) {
    const el = document.createElement("div");
    el.className = "tsave-item";
    const date = new Date(save.savedAt);
    const timeStr = date.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const classStr = save.character?.classes?.map(c => c.name).join("/") || "";
    const hpStr = `${save.character?.hp?.current}/${save.character?.hp?.max}`;

    el.innerHTML = `
      <div class="tsave-item-info">
        <div class="tsave-item-name">${save.character?.name || "Unknown"} — Lv.${save.character?.level || "?"} ${classStr}</div>
        <div class="tsave-item-detail">${hpStr} HP · AC ${save.character?.ac || "?"} · ${timeStr}</div>
      </div>
      <div class="tsave-item-actions">
        <button class="tsave-item-btn load" data-save-key="${save.storageKey}">📂 Load</button>
        <button class="tsave-item-btn delete" data-save-key="${save.storageKey}">✕</button>
      </div>
    `;
    list.appendChild(el);
  }
}

// Save current token
document.getElementById("tsave-save-btn")?.addEventListener("click", () => {
  const char = currentCharData;
  if (!char) return;

  const saveKey = TOKEN_SAVE_PREFIX + char.name + ":" + Date.now();
  const saveData = {
    savedAt: Date.now(),
    character: JSON.parse(JSON.stringify(char)),
  };
  // Remove _lastUpdated from saved copy
  delete saveData.character._lastUpdated;

  localStorage.setItem(saveKey, JSON.stringify(saveData));
  buildTokenSaveList();
  logCombat(`💾 Token <strong>${char.name}</strong> saved!`, "info");
  OBR.notification.show(`Token "${char.name}" saved!`, "SUCCESS");
});

// Load & Delete — delegated
document.getElementById("tsave-list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".tsave-item-btn");
  if (!btn) return;
  const saveKey = btn.dataset.saveKey;
  if (!saveKey) return;

  if (btn.classList.contains("delete")) {
    localStorage.removeItem(saveKey);
    buildTokenSaveList();
    return;
  }

  if (btn.classList.contains("load")) {
    if (!currentTokenId) {
      OBR.notification.show("No token selected", "WARNING");
      return;
    }
    const raw = localStorage.getItem(saveKey);
    if (!raw) { OBR.notification.show("Save not found", "ERROR"); return; }

    try {
      const save = JSON.parse(raw);
      const char = save.character;
      if (!char) throw new Error("No character data");

      // Apply to current token
      await OBR.scene.items.updateItems([currentTokenId], (items) => {
        for (const item of items) {
          item.metadata[METADATA_KEY] = {
            character: char,
            isMonster: char.race === "Monster" || !char.id,
            lastUpdated: Date.now(),
          };
        }
      });

      char._lastUpdated = Date.now();
      currentCharData = char;
      showHotbar(char);
      hideTokenSavePanel();
      logCombat(`📂 Loaded <strong>${char.name}</strong> onto token`, "info");
      OBR.notification.show(`"${char.name}" loaded onto token!`, "SUCCESS");
    } catch (err) {
      console.error("Failed to load token save:", err);
      OBR.notification.show("Failed to load save", "ERROR");
    }
  }
});

document.getElementById("tsave-close")?.addEventListener("click", hideTokenSavePanel);

// ════════════════════════════════════════
// WILD SHAPE
// ════════════════════════════════════════

function showWildShapePanel() {
  if (!currentCharData?.creatures?.length) return;
  buildWildShapeList();
  const wsPanel = document.getElementById("wildshape-panel");
  wsPanel.classList.add("visible");
  hideOtherPickers("wildshape");
}

function buildWildShapeList() {
  const wsList = document.getElementById("ws-list");
  const revertBtn = document.getElementById("ws-revert-btn");
  const char = currentCharData;
  if (!wsList || !char) return;

  wsList.innerHTML = "";

  // Show revert button if currently transformed
  const isTransformed = !!char._wildShapeOriginal;
  revertBtn?.classList.toggle("hidden", !isTransformed);

  for (const creature of char.creatures || []) {
    const card = document.createElement("div");
    card.className = "ws-card";
    if (isTransformed && char._wildShapeForm === creature.name) card.classList.add("active");

    const statLine = creature.stats?.map(s => `<span>${s.name} ${s.value}</span>`).join("") || "";

    let actionsHTML = "";
    if (creature.actions?.length) {
      actionsHTML = '<div class="ws-card-actions">' +
        creature.actions.map(a => {
          const atkStr = a.attackBonus !== null ? ` (+${a.attackBonus})` : "";
          const dmgStr = a.damage ? ` ${a.damage} ${a.damageType || ""}` : "";
          return `<div class="ws-card-action"><strong>${a.name}</strong>${atkStr}${dmgStr}</div>`;
        }).join("") + '</div>';
    }

    let traitsHTML = "";
    if (creature.traits?.length) {
      traitsHTML = creature.traits.map(t =>
        `<div class="ws-card-action" style="color:#8a8;font-style:italic"><strong>${t.name}:</strong> ${t.description.slice(0, 80)}</div>`
      ).join("");
    }

    card.innerHTML = `
      <div class="ws-card-top">
        <span class="ws-card-name">${creature.name}</span>
        <span class="ws-card-size">${creature.size} · ${creature.speedStr || creature.speed + "ft"}</span>
      </div>
      <div class="ws-card-stats">
        <span class="hp">❤️ ${creature.hp}</span>
        <span class="ac">🛡️ AC ${creature.ac}</span>
        ${statLine}
      </div>
      ${actionsHTML}
      ${traitsHTML}
    `;

    card.addEventListener("click", () => wildShapeTransform(creature));
    wsList.appendChild(card);
  }
}

async function wildShapeTransform(creature) {
  const char = currentCharData;
  if (!char || !currentTokenId) return;

  // Save original form if not already transformed
  if (!char._wildShapeOriginal) {
    char._wildShapeOriginal = {
      name: char.name,
      hp: { ...char.hp },
      ac: char.ac,
      speed: char.speed,
      stats: JSON.parse(JSON.stringify(char.stats)),
      weapons: JSON.parse(JSON.stringify(char.weapons || [])),
    };
  }

  // Apply beast form stats
  char._wildShapeForm = creature.name;
  char.hp = { current: creature.hp - (creature.removedHitPoints || 0), max: creature.hp, temp: 0 };
  char.ac = creature.ac;
  char.speed = creature.speed;
  // Replace physical stats (STR, DEX, CON) but keep mental stats (INT, WIS, CHA)
  if (creature.stats?.length === 6) {
    for (let i = 0; i < 3; i++) { // STR, DEX, CON
      char.stats[i] = { ...creature.stats[i] };
    }
  }
  // Replace weapons with beast actions
  char.weapons = (creature.actions || []).map(a => ({
    name: a.name,
    equipped: true,
    type: "Natural Weapon",
    damage: a.damage || "1d4",
    damageType: a.damageType || "Slashing",
    damageMod: 0,
    range: "5",
    properties: [],
    mastery: [],
    attackBonus: a.attackBonus ?? 0,
    attackType: "melee",
  }));

  // Save to OBR
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta) return;
      meta.character = char;
      meta.lastUpdated = Date.now();
    }
  });
  char._lastUpdated = Date.now();

  showHotbar(char);
  buildWildShapeList();
  logCombat(`🐾 <strong>${char._wildShapeOriginal.name}</strong> transforms into <strong>${creature.name}</strong>! (HP: ${char.hp.current}/${char.hp.max}, AC: ${char.ac})`, "spell");
  OBR.notification.show(`Wild Shape: ${creature.name}!`, "SUCCESS");
}

async function wildShapeRevert() {
  const char = currentCharData;
  if (!char?._wildShapeOriginal || !currentTokenId) return;

  const orig = char._wildShapeOriginal;
  const formName = char._wildShapeForm;
  char.hp = { ...orig.hp };
  char.ac = orig.ac;
  char.speed = orig.speed;
  char.stats = JSON.parse(JSON.stringify(orig.stats));
  char.weapons = JSON.parse(JSON.stringify(orig.weapons));
  delete char._wildShapeOriginal;
  delete char._wildShapeForm;

  // Save to OBR
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta) return;
      meta.character = char;
      meta.lastUpdated = Date.now();
    }
  });
  char._lastUpdated = Date.now();

  showHotbar(char);
  buildWildShapeList();
  logCombat(`↩️ <strong>${char.name}</strong> reverts from <strong>${formName}</strong> form!`, "spell");
  OBR.notification.show(`Reverted to ${char.name}!`, "SUCCESS");
}

document.getElementById("ws-revert-btn")?.addEventListener("click", wildShapeRevert);
document.getElementById("ws-close")?.addEventListener("click", hideWildShapePanel);

// ── Rest handlers ──
async function performRest(restType) {
  const char = currentCharData;
  if (!char?.features || !currentTokenId) return;

  const isLong = restType === "long";
  const label = isLong ? "Long Rest" : "Short Rest";
  const matchTypes = isLong
    ? ["Short Rest", "Long Rest", "Day"]  // Long rest resets everything
    : ["Short Rest"];                       // Short rest only resets short rest features

  let resetCount = 0;
  for (const feat of char.features || []) {
    if (feat.maxUses === null || feat.remaining === feat.maxUses) continue;
    if (!feat.resetType || !matchTypes.includes(feat.resetType)) continue;
    feat.remaining = feat.maxUses;
    feat.usedCount = 0;
    resetCount++;
  }

  // Restore spell slots
  let slotsRestored = 0;
  if (char.spellSlots) {
    for (const slot of char.spellSlots) {
      if (slot.remaining === slot.max) continue;
      // Long rest: all slots. Short rest: only pact magic
      if (isLong || slot.isPact) {
        slotsRestored += (slot.max - slot.remaining);
        slot.remaining = slot.max;
        slot.used = 0;
      }
    }
  }

  if (resetCount === 0 && slotsRestored === 0) {
    OBR.notification.show(`${char.name}: Nothing to reset on ${label}`, "INFO");
    return;
  }

  // Save to OBR
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) return;
      for (const feat of meta.character.features || []) {
        if (feat.maxUses === null) continue;
        if (!feat.resetType || !matchTypes.includes(feat.resetType)) continue;
        feat.remaining = feat.maxUses;
        feat.usedCount = 0;
      }
      if (meta.character.spellSlots) {
        for (const slot of meta.character.spellSlots) {
          if (isLong || slot.isPact) { slot.remaining = slot.max; slot.used = 0; }
        }
      }
      meta.lastUpdated = Date.now();
    }
  });
  currentCharData._lastUpdated = Date.now();

  // Remove active effects for this token (e.g. Rage ends on rest)
  const effects = await getActiveEffects();
  const remaining = effects.filter(e => e.tokenId !== currentTokenId);
  if (remaining.length !== effects.length) {
    await setActiveEffects(remaining);
  }

  // Remove combat conditions on long rest
  if (isLong) {
    const keepConditions = ["concentrating"]; // keep concentration if any
    const cleared = currentConditions.filter(c => keepConditions.includes(c));
    if (cleared.length !== currentConditions.length) {
      currentConditions = cleared;
      await OBR.scene.items.updateItems([currentTokenId], (items) => {
        for (const item of items) {
          item.metadata[COND_METADATA_KEY] = [...currentConditions];
        }
      });
      renderConditionBadges();
    }
  }

  buildFeaturesList();
  const icon = isLong ? "🌙" : "⏱️";
  const slotStr = slotsRestored > 0 ? `, ${slotsRestored} spell slot(s)` : "";
  logCombat(`${icon} <strong>${char.name}</strong> takes a <strong>${label}</strong> — ${resetCount} feature(s)${slotStr} restored!`, "info");
  OBR.notification.show(`${char.name}: ${label} — ${resetCount} feature(s)${slotStr} restored!`, "SUCCESS");
}

document.getElementById("feat-short-rest")?.addEventListener("click", () => performRest("short"));
document.getElementById("feat-long-rest")?.addEventListener("click", () => performRest("long"));

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

        // Determine which condition to remove
        let condToRemove = null;

        // Direct condition effect (cond:poisoned → remove "poisoned")
        if (effect.key.startsWith("cond:")) {
          condToRemove = effect.key.slice(5);
        } else {
          // Legacy: feature-linked conditions (e.g. rage → raging)
          const condRules = [{ match: "rage", condition: "raging" }];
          condToRemove = condRules.find(r => effect.key.startsWith(r.match))?.condition || null;
        }

        if (condToRemove) {
          try {
            const items = await OBR.scene.items.getItems([effect.tokenId]);
            const token = items[0];
            if (token) {
              const conds = (token.metadata?.[COND_METADATA_KEY] || []).filter(c => c !== condToRemove);
              await OBR.scene.items.updateItems([effect.tokenId], (upd) => {
                for (const item of upd) item.metadata[COND_METADATA_KEY] = conds;
              });
              const condDef = CONDITIONS[condToRemove];
              logCombat(`${condDef?.icon || "📌"} <strong>${condDef?.name || condToRemove}</strong> removed from <strong>${effect.charName}</strong>`, "condition");
              // Update local if it's our token
              if (effect.tokenId === currentTokenId) { currentConditions = conds; renderConditionBadges(); }
            }
          } catch {}
        }
        continue;
      } else {
        logCombat(`🔥 <strong>${effect.charName}</strong> — <strong>${effect.effectName}</strong>: <strong>${effect.turnsRemaining}</strong>/${effect.totalTurns} turns remaining`, "spell");
      }
    }
    updated.push(effect);
  }

  await setActiveEffects(updated);

  // Refresh condition badges if our token was affected
  if (activeTokenId === currentTokenId) {
    await renderConditionBadges();
  }
}

async function onBonusSelected(action) {
  hideBonusPicker();
  logCombat(`⚡ <strong>${currentCharData.name}</strong> uses bonus action: <strong>${action.name}</strong>`, "info");

  if (action.type === "attack" && action.weapon) {
    // Off-hand weapon attack — enter targeting mode
    selectedWeapon = action.weapon;
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
  } else if (action.dice) {
    // Roll dice for bonus actions with dice (e.g. Hunter's Mark 1d6)
    await rollDice(action.dice, `${currentCharData.name} ${action.name}`, 0);
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
  if (except !== "token-save") tokenSavePanel.classList.remove("visible");
  if (except !== "wildshape") document.getElementById("wildshape-panel")?.classList.remove("visible");
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

    const saveFx = getSaveConditionEffects(conditions, spell.save);

    if (saveFx.autoFail) {
      saveResults.push({ token, char, name, saved: false, roll: 0, total: 0, autoFail: true });
      logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "spell");
      continue;
    }

    const saveMod = getSaveMod(char, spell.save);
    let { roll, total } = rollSave(saveMod);

    // Advantage/disadvantage on save
    if (saveFx.advantage || saveFx.disadvantage) {
      const { roll: roll2, total: total2 } = rollSave(saveMod);
      if (saveFx.advantage) {
        if (total2 > total) { roll = roll2; total = total2; }
        logCombat(`↳ ${name} Save advantage: ${roll} vs ${roll2}`, "info");
      } else {
        if (total2 < total) { roll = roll2; total = total2; }
        logCombat(`↳ ${name} Save disadvantage: ${roll} vs ${roll2}`, "info");
      }
    }

    const saved = total >= dc;
    saveResults.push({ token, char, name, saved, roll, total });

    const saveStr = saved
      ? `<strong class="hit">SAVE</strong> (${roll}${fmtMod(saveMod)}=${total})`
      : `<strong class="miss">FAIL</strong> (${roll}${fmtMod(saveMod)}=${total})`;
    logCombat(`<strong>${name}</strong>: ${spell.save} ${saveStr}`, "spell");
  }

  await broadcastSfx("spell");
  playSpellEffect(spell.damageType);

  const failCount = saveResults.filter((r) => !r.saved).length;
  const saveCount = saveResults.filter((r) => r.saved).length;
  showAoeResults(spell, dc, saveResults);
  // If spell has no damage (e.g. AoE control spell) — just report saves
  if (!spell.damage) {
    showCombatOverlay(`${spell.name}`, `${failCount} failed, ${saveCount} saved`);
    await OBR.notification.show(`${spell.name}: ${failCount} failed, ${saveCount} saved`, "SUCCESS");
    setTimeout(() => resetCombat(), 3000);
    return;
  }

  showCombatOverlay(`${spell.name}`, `${failCount} failed, ${saveCount} saved — rolling damage...`);

  // Auto-roll damage dice
  const dmgNotation = spell.damage;
  const dmgType = spell.damageType || "damage";
  const dieType = parseDieType(dmgNotation) || "d6";

  let diceTotal, individualResults;
  let used3D = false;

  if (diceReady && diceBox) {
    try {
      show3DOverlay(`${caster.name} ${spell.name} Damage`);
      const results = await Promise.race([
        diceBox.roll(dmgNotation, { themeColor: getDiceColor(dmgType) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D AoE damage roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  if (!used3D) {
    const rolled = rollDiceValues(dmgNotation);
    diceTotal = rolled.diceTotal;
    individualResults = rolled.individualResults;
  }

  const fullDamage = Math.max(0, diceTotal);
  const halfDamage = Math.floor(fullDamage / 2);

  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  const dmgLabel = `${caster.name} ${spell.name} Damage`;
  const dmgResult = {
    notation: dmgNotation, diceTotal, modifier: 0, finalTotal: fullDamage,
    natValue: null, charName: caster.name, label: dmgLabel,
    rollId: crypto.randomUUID(), individualResults,
  };

  if (used3D) {
    show3DResult(dmgLabel, dmgResult);
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    showDiceResultDisplay(dmgLabel, dmgResult, dieType);
    await new Promise((r) => setTimeout(r, 6000));
  }

  logCombat(
    `<strong>${caster.name}</strong> ${spell.name} damage: ${dmgNotation} → ${diceStr} = <strong class="damage">${fullDamage}</strong> ${dmgType}`,
    "damage"
  );

  if (used3D) hide3DOverlay();

  // Update AoE results display with damage info
  showAoeResults(spell, dc, saveResults, fullDamage, halfDamage);

  // Apply damage to all targets
  const tokenIdsToUpdate = saveResults.filter((r) => r.char).map((r) => r.token.id);
  await OBR.scene.items.updateItems(tokenIdsToUpdate, (items) => {
    for (const item of items) {
      const r = saveResults.find((r) => r.token.id === item.id);
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
      logCombat(`<strong class="damage">${dmg}</strong> ${dmgType} → <strong>${r.name}</strong>${r.saved ? " (half)" : ""}`, "damage");
    }
  });

  await syncInitiativeHP();
  await broadcastSfx("damage");
  for (const r of saveResults) {
    const dmg = r.saved ? halfDamage : fullDamage;
    if (dmg > 0) await showFloatingDamage(r.token.id, dmg, dmgType, { isSpell: true });
    if (r.char) {
      const meta = r.token.metadata?.[METADATA_KEY];
      if (meta?.character?.hp?.current === 0) {
        addSkullToToken(r.token.id);
      }
    }
  }

  showCombatOverlay(`${spell.name}: ${fullDamage} ${dmgType}!`, `${failCount} failed (full), ${saveCount} saved (half: ${halfDamage})`);
  await OBR.notification.show(`${spell.name}: ${fullDamage} ${dmgType} (${halfDamage} on save)`, "SUCCESS");
  setTimeout(() => resetCombat(), 3000);
}

function showAoeResults(spell, dc, results, fullDmg = null, halfDmg = null) {
  const dmgType = spell.damageType || "";
  const hasDmg = fullDmg !== null;
  aoeTitle.textContent = hasDmg
    ? `${spell.name} — ${fullDmg} ${dmgType} (half: ${halfDmg})`
    : `${spell.name} — DC ${dc} ${spell.save} Save`;
  aoeTargetList.innerHTML = results.map((r) => {
    const saveClass = r.saved ? "saved" : "failed";
    const saveText = r.autoFail ? "AUTO-FAIL" : `${r.roll}${fmtMod(getSaveMod(r.char, spell.save))}=${r.total} ${r.saved ? "SAVE" : "FAIL"}`;
    const dmgText = hasDmg ? ` → ${r.saved ? halfDmg : fullDmg}` : "";
    return `
      <div class="aoe-target ${saveClass}">
        <span class="aoe-name">${r.name}</span>
        <span class="aoe-save-result">${saveText}${dmgText}</span>
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

async function buildCondGrid() {
  condGrid.innerHTML = "";
  // Fetch active effects to show current turn info
  let effects = [];
  try { effects = await getActiveEffects(); } catch {}

  for (const [key, cond] of Object.entries(CONDITIONS)) {
    const card = document.createElement("div");
    card.className = "cond-card";
    card.dataset.condKey = key;
    const isActive = currentConditions.includes(key);
    if (isActive) card.classList.add("active-cond");

    // Check if this condition has an active effect with turns
    const eff = effects.find(e => e.tokenId === currentTokenId && e.key === `cond:${key}`);

    let rightHTML = "";
    if (isActive && eff) {
      rightHTML = `<span class="cond-active-info">${eff.turnsRemaining}/${eff.totalTurns}T</span>`;
    } else if (!isActive) {
      rightHTML = `
        <input type="number" class="cond-turns-input" data-cond-key="${key}" min="0" placeholder="∞" title="Turns (0 = permanent)" />
        <span class="cond-turns-label">turns</span>
      `;
    }

    const tagsHTML = (cond.tags || []).map(tag => {
      const tc = getTagColor(tag);
      return `<span class="cond-tag" style="background:${tc.bg};color:${tc.color};border-color:${tc.border}">${tag}</span>`;
    }).join("");

    card.innerHTML = `
      <span class="cond-icon">${cond.icon}</span>
      <div class="cond-info">
        <div class="cond-name">${cond.name}</div>
        <div class="cond-tags">${tagsHTML}</div>
      </div>
      ${rightHTML}
    `;

    // Prevent click when typing in input
    const input = card.querySelector(".cond-turns-input");
    if (input) input.addEventListener("click", (e) => e.stopPropagation());

    card.addEventListener("click", () => {
      const turnsInput = card.querySelector(".cond-turns-input");
      const turns = turnsInput ? parseInt(turnsInput.value) || 0 : 0;
      toggleCondition(key, turns);
    });
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

async function toggleCondition(key, turns = 0) {
  if (!currentTokenId) return;
  const idx = currentConditions.indexOf(key);
  const removing = idx >= 0;

  if (removing) {
    currentConditions.splice(idx, 1);
    // Remove active effect for this condition
    await removeActiveEffect(currentTokenId, `cond:${key}`);
  } else {
    currentConditions.push(key);
    // Add active effect with turn tracking if turns > 0
    if (turns > 0) {
      const charName = currentCharData?.name || "Token";
      const condName = CONDITIONS[key]?.name || key;
      await addActiveEffect(currentTokenId, charName, condName, `cond:${key}`, turns);
    }
  }

  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      item.metadata[COND_METADATA_KEY] = [...currentConditions];
    }
  });

  const cond = CONDITIONS[key];
  const action = removing ? "removed" : "applied";
  const turnStr = (!removing && turns > 0) ? ` (${turns} turns)` : "";
  logCombat(`${cond.icon} <strong>${cond.name}</strong> ${action} to <strong>${currentCharData?.name || "token"}</strong>${turnStr}`, "condition");

  buildCondGrid();
  renderConditionBadges();
}

async function renderConditionBadges() {
  if (!currentConditions.length) {
    conditionBar.classList.add("hidden");
    return;
  }
  conditionBar.classList.remove("hidden");

  // Fetch active effects to show turn counters
  let effects = [];
  try { effects = await getActiveEffects(); } catch {}

  // Map: condition key → active effect
  const condToEffect = {};
  // Legacy: "raging" condition linked to "rage" feature effect
  const condToPrefix = { raging: "rage" };
  for (const [condKey, prefix] of Object.entries(condToPrefix)) {
    const eff = effects.find(e => e.tokenId === currentTokenId && e.key.startsWith(prefix));
    if (eff) condToEffect[condKey] = eff;
  }
  // Direct condition effects (cond:key)
  for (const key of currentConditions) {
    const eff = effects.find(e => e.tokenId === currentTokenId && e.key === `cond:${key}`);
    if (eff) condToEffect[key] = eff;
  }

  conditionBar.innerHTML = currentConditions.map((key) => {
    const c = CONDITIONS[key];
    if (!c) return "";
    const eff = condToEffect[key];
    const turnStr = eff ? ` <span class="cond-turns">${eff.turnsRemaining}/${eff.totalTurns}</span>` : "";
    return `<span class="cond-badge" data-cond="${key}" style="background:${c.color}22;color:${c.color};border-color:${c.color}">${c.icon} ${c.name}${turnStr}<span class="cond-x">✕</span></span>`;
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

  // Weapons from actions
  const weapons = (m.actions || []).map((a) => ({
    name: a.name || "Attack",
    equipped: true,
    type: a.type || "Simple Melee",
    attackType: a.type?.toLowerCase().includes("ranged") ? "ranged" : "melee",
    damage: a.damage || "1d4",
    damageType: a.damageType || "Slashing",
    damageMod: a.damageMod ?? 0,
    range: a.range || "5",
    properties: a.properties || [],
    mastery: [],
    attackBonus: a.attackBonus ?? 0,
  }));

  const totalLevel = m.cr ? Math.max(1, Math.round(m.cr)) : 1;
  const profBonus = Math.ceil(totalLevel / 4) + 1;

  // Saving throws — proficient saves from JSON or default none
  const saveProfSet = new Set((m.savingThrows || m.saves || []).map(s => s.toUpperCase().slice(0, 3)));
  const savingThrows = statNames.map((name) => {
    const stat = stats.find(s => s.name === name);
    const isProf = saveProfSet.has(name);
    return { name, modifier: (stat?.modifier || 0) + (isProf ? profBonus : 0), proficient: isProf };
  });

  // Spells
  const spells = (m.spells || []).map((sp) => ({
    key: (sp.name || "spell").toLowerCase().replace(/[^a-z0-9]/g, "_"),
    name: sp.name || "Spell",
    level: sp.level ?? 0,
    damage: sp.damage || null,
    damageType: sp.damageType || null,
    save: sp.save || null,
    isAoE: sp.isAoE || false,
    aoeRadius: sp.aoeRadius || 0,
    isAttack: sp.isAttack || false,
    attackBonus: sp.attackBonus ?? null,
    healing: sp.healing || null,
    concentration: sp.concentration || false,
    ritual: sp.ritual || false,
    description: sp.description || "",
    spellDC: sp.dc || (8 + profBonus + Math.max(stats[3].modifier, stats[4].modifier, stats[5].modifier)),
  }));

  // Features / special abilities
  const features = (m.features || m.traits || []).map((f) => ({
    key: (f.name || "trait").toLowerCase().replace(/[^a-z0-9]/g, "-"),
    name: f.name || "Trait",
    source: "class",
    sourceType: m.type || "Monster",
    activationType: f.activationType || null,
    description: (f.description || f.desc || "").slice(0, 200),
    maxUses: f.uses ?? f.maxUses ?? null,
    usedCount: 0,
    remaining: f.uses ?? f.maxUses ?? null,
    resetType: f.resetType || (f.recharge ? "Short Rest" : null),
    isAttack: false,
    saveStat: f.save || null,
    dice: f.dice || null,
  }));

  // Inventory
  const inventory = (m.inventory || m.equipment || []).map((item) => ({
    name: item.name || "Item",
    type: item.type || "Other",
    subType: item.subType || "",
    equipped: item.equipped ?? true,
    quantity: item.quantity ?? 1,
    weight: item.weight ?? 0,
    cost: item.cost ?? 0,
    costUnit: item.costUnit || "gp",
    rarity: item.rarity || "Common",
    description: item.description || "",
    notes: item.notes || "",
    isAttuned: item.isAttuned || false,
    isMagic: item.isMagic || false,
    canEquip: item.canEquip ?? true,
  }));

  // Currency
  const currency = m.currency || { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

  return {
    id: null,
    name: m.name,
    avatarUrl: m.avatarUrl || null,
    race: m.type || "Monster",
    classes: [{ name: m.type || "Monster", level: totalLevel, subclass: m.subtype || null }],
    level: totalLevel,
    hp: { current: hp, max: hp, temp: 0 },
    stats,
    ac: m.ac ?? 10 + dexMod,
    proficiencyBonus: profBonus,
    speed: m.speed ?? 30,
    weapons,
    skills: defaultSkills(stats, profBonus, m.skills || []),
    savingThrows,
    bonusActions: m.bonusActions || [],
    inventory,
    currency,
    spells,
    features,
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

async function renderInitiative(state) {
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

  // Fetch active effects for turn indicators
  let activeEffects = [];
  try { activeEffects = await getActiveEffects(); } catch {}

  initTrack.innerHTML = state.order.map((entry, i) => {
    const isActive = i === state.currentIndex;
    const hpPct = entry.hpMax > 0 ? (entry.hpCurrent / entry.hpMax) * 100 : 100;
    const isDown = entry.hpCurrent <= 0;
    let hpClass = "";
    if (isDown) hpClass = "down";
    else if (hpPct <= 25) hpClass = "critical";
    else if (hpPct <= 50) hpClass = "hurt";

    // Active effects for this token
    const tokenEffects = activeEffects.filter(e => e.tokenId === entry.tokenId);
    const effectsHTML = tokenEffects.map(e =>
      `<span class="init-effect" title="${e.effectName}: ${e.turnsRemaining}/${e.totalTurns} turns">🔥 ${e.turnsRemaining}</span>`
    ).join("");

    return `
      <div class="init-row ${isActive ? "active" : ""} ${isDown ? "dead" : ""}"
           data-token-id="${entry.tokenId}">
        <span class="init-roll-val">${entry.initiative}</span>
        <span class="init-name">${entry.name}${effectsHTML ? ` ${effectsHTML}` : ""}</span>
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

// Roll d20 + initiative modifier
document.getElementById("init-roll-d20").addEventListener("click", () => {
  if (!initPendingToken) return;
  const tokenId = initPendingToken.tokenId;
  OBR.scene.items.getItems([tokenId]).then(items => {
    const token = items[0];
    const char = token?.metadata?.[METADATA_KEY]?.character;
    // Use parsed initiative modifier (includes DEX + feats like Alert, Jack of All Trades)
    const initMod = char?.initiative ?? char?.stats?.find(s => s.name === "DEX")?.modifier ?? 0;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + initMod;
    initAddValue.value = total;
    const modStr = fmtMod(initMod);
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
    combatState = COMBAT.IDLE; // lock immediately to prevent double-fire
    const items = await OBR.scene.items.getItems(selection);
    const center = items.find((i) => i.layer === "CHARACTER");
    if (center) { await castAoeSpell(center); }
    else { combatState = COMBAT.AOE_CASTING; } // restore if no valid target
    return;
  }

  if (combatState === COMBAT.TARGETING && selection?.length > 0) {
    combatState = COMBAT.IDLE; // lock immediately to prevent double-fire on mobile
    const items = await OBR.scene.items.getItems(selection);
    const target = items.find((i) => i.layer === "CHARACTER" && i.id !== attackerTokenId);
    if (target) { await pickTarget(target); }
    else { combatState = COMBAT.TARGETING; } // restore if no valid target
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

  // Check if incapacitated
  if (isIncapacitated(currentConditions)) {
    const condNames = currentConditions.filter(k => CONDITIONS[k]?.incapacitated).map(k => CONDITIONS[k].name).join(", ");
    logCombat(`❌ <strong>${currentCharData.name}</strong> can't act — <strong>${condNames}</strong>!`, "info");
    OBR.notification.show(`${currentCharData.name} is ${condNames} and can't act!`, "WARNING");
    return;
  }

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
  const saveFx = getSaveConditionEffects(conditions, spell.save);

  if (saveFx.autoFail) {
    saved = false; roll = 0; total = 0;
    logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "spell");
  } else {
    const saveMod = getSaveMod(char, spell.save);
    const result = rollSave(saveMod);
    roll = result.roll; total = result.total;

    // Advantage/disadvantage on save from conditions
    if (saveFx.advantage || saveFx.disadvantage) {
      const result2 = rollSave(saveMod);
      if (saveFx.advantage && result2.total > total) { roll = result2.roll; total = result2.total; }
      if (saveFx.disadvantage && result2.total < total) { roll = result2.roll; total = result2.total; }
      const advStr = saveFx.advantage ? "advantage" : "disadvantage";
      logCombat(`↳ Save ${advStr}: ${result.roll} vs ${result2.roll}`, "info");
    }

    saved = total >= dc;
    const saveStr = saved ? `<strong class="hit">SAVE</strong>` : `<strong class="miss">FAIL</strong>`;
    logCombat(`<strong>${name}</strong>: ${spell.save} Save ${roll}${fmtMod(saveMod)}=${total} ${saveStr}`, "spell");
  }

  await broadcastSfx("spell");
  playSpellEffect(spell.damageType);

  const saveLabel = saved ? "SAVED" : "FAILED";

  // If spell has no damage (e.g. Hold Person, Command) — just report save result
  if (!spell.damage) {
    showCombatOverlay(`${spell.name}: ${saveLabel}!`, saved ? `${name} resists the effect` : `${name} is affected!`);
    await OBR.notification.show(`${spell.name}: ${name} ${saveLabel}`, saved ? "WARNING" : "SUCCESS");
    setTimeout(() => resetCombat(), 3000);
    return;
  }

  // Auto-roll damage dice
  const dmgNotation = spell.damage;
  const dmgType = spell.damageType || "damage";
  const dieType = parseDieType(dmgNotation) || "d6";

  let diceTotal, individualResults;
  let used3D = false;

  if (diceReady && diceBox) {
    try {
      show3DOverlay(`${caster.name} ${spell.name} Damage`);
      const results = await Promise.race([
        diceBox.roll(dmgNotation, { themeColor: getDiceColor(dmgType) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D spell damage roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  if (!used3D) {
    const rolled = rollDiceValues(dmgNotation);
    diceTotal = rolled.diceTotal;
    individualResults = rolled.individualResults;
  }

  const fullDamage = Math.max(0, diceTotal);
  const appliedDamage = saved ? Math.floor(fullDamage / 2) : fullDamage;

  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  const dmgLabel = `${caster.name} ${spell.name} Damage`;
  const result = {
    notation: dmgNotation, diceTotal, modifier: 0, finalTotal: fullDamage,
    natValue: null, charName: caster.name, label: dmgLabel,
    rollId: crypto.randomUUID(), individualResults,
  };

  if (used3D) {
    show3DResult(dmgLabel, result);
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    showDiceResultDisplay(dmgLabel, result, dieType);
    await new Promise((r) => setTimeout(r, 6000));
  }

  logCombat(
    `<strong>${caster.name}</strong> ${spell.name} damage: ${dmgNotation} → ${diceStr} = <strong class="damage">${fullDamage}</strong> ${dmgType}`,
    "damage"
  );
  if (saved) {
    logCombat(`↳ ${name} saved — half damage: <strong class="damage">${appliedDamage}</strong>`, "info");
  }

  if (used3D) hide3DOverlay();

  // Apply damage to target
  if (char && appliedDamage > 0) {
    let remaining = appliedDamage;
    let newTemp = char.hp.temp || 0;
    if (newTemp > 0) { const absorbed = Math.min(newTemp, remaining); newTemp -= absorbed; remaining -= absorbed; }
    const newCurrent = Math.max(0, char.hp.current - remaining);
    const isDown = newCurrent === 0;

    await OBR.scene.items.updateItems([targetToken.id], (items) => {
      for (const item of items) {
        const m = item.metadata[METADATA_KEY];
        if (!m?.character) return;
        m.character.hp.current = newCurrent;
        m.character.hp.temp = newTemp;
        m.lastUpdated = Date.now();
      }
    });

    await syncInitiativeHP();
    await broadcastSfx("damage");
    await showFloatingDamage(targetToken.id, appliedDamage, dmgType, { isSpell: true });

    if (isDown) {
      addSkullToToken(targetToken.id);
      tokenDownEffect(targetToken.id);
    } else {
      tokenHitEffect(targetToken.id);
    }

    logCombat(
      `<strong class="damage">${appliedDamage}</strong> ${dmgType} → <strong>${name}</strong>: ` +
      `<strong>${char.hp.current}</strong> → <strong class="${isDown ? "miss" : ""}">${newCurrent}</strong>/${char.hp.max} HP` +
      (saved ? " (half)" : "") + (isDown ? ` — <strong class="miss">DOWN!</strong>` : ""),
      "damage"
    );

    showCombatOverlay(`${spell.name}: ${appliedDamage} ${dmgType}!`,
      isDown ? `${name} falls to 0 HP!` : `${name}: ${newCurrent}/${char.hp.max} HP${saved ? " (saved, half dmg)" : ""}`);
    await OBR.notification.show(`${spell.name}: ${appliedDamage} ${dmgType} → ${name}${saved ? " (saved)" : ""}`, isDown ? "ERROR" : "SUCCESS");
  } else {
    showCombatOverlay(`${spell.name}: ${saveLabel}!`, saved ? `${name} takes no effect` : `${appliedDamage} ${dmgType} damage`);
    await OBR.notification.show(`${spell.name}: ${name} ${saveLabel}`, saved ? "WARNING" : "SUCCESS");
  }

  setTimeout(() => resetCombat(), 3000);
}


// ════════════════════════════════════════
// COMBO SPELL AoE PHASE (e.g. Ice Knife: attack → then AoE explosion)
// ════════════════════════════════════════
async function castComboAoE(centerTokenId) {
  const spell = selectedSpell;
  if (!spell || !spell.aoeDamage) { resetCombat(); return; }

  const caster = attackerData;
  const dc = spell.spellDC || getSpellcastingDC(caster);
  const aoeDmgNotation = spell.aoeDamage;
  const aoeDmgType = spell.aoeDamageType || "damage";
  const aoeRadius = spell.aoeRadius || 5;

  showCombatOverlay(`${spell.name} — Explosion!`, `${aoeRadius}ft ${spell.save} Save DC ${dc}...`);
  logCombat(`💥 <strong>${spell.name}</strong> explodes! ${aoeRadius}ft radius — DC ${dc} ${spell.save} Save`, "spell");

  // Find all tokens in radius (including the original target)
  const allItems = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER");
  const centerToken = allItems.find(i => i.id === centerTokenId);
  if (!centerToken) { resetCombat(); return; }

  const centerPos = centerToken.position;
  const inRadius = tokensInRadius(centerPos, aoeRadius, allItems.filter(i => i.id !== attackerTokenId));

  // Make sure the center target is included
  if (!inRadius.find(t => t.id === centerTokenId)) {
    inRadius.push(centerToken);
  }

  if (inRadius.length === 0) {
    logCombat(`${spell.name} explosion: No targets in ${aoeRadius}ft radius`, "spell");
    resetCombat();
    return;
  }

  // Roll saves for each target
  const saveResults = [];
  for (const token of inRadius) {
    const meta = token.metadata?.[METADATA_KEY];
    const char = meta?.character;
    const name = char?.name || token.name || "Unknown";
    const conditions = token.metadata?.[COND_METADATA_KEY] || [];
    const saveFx = getSaveConditionEffects(conditions, spell.save);

    if (saveFx.autoFail) {
      saveResults.push({ token, char, name, saved: false, roll: 0, total: 0, autoFail: true });
      logCombat(`<strong>${name}</strong>: <strong class="miss">AUTO-FAIL</strong> (condition)`, "spell");
      continue;
    }

    const saveMod = getSaveMod(char, spell.save);
    let { roll, total } = rollSave(saveMod);

    if (saveFx.advantage || saveFx.disadvantage) {
      const { roll: roll2, total: total2 } = rollSave(saveMod);
      if (saveFx.advantage && total2 > total) { roll = roll2; total = total2; }
      if (saveFx.disadvantage && total2 < total) { roll = roll2; total = total2; }
    }

    const saved = total >= dc;
    saveResults.push({ token, char, name, saved, roll, total });

    const saveStr = saved
      ? `<strong class="hit">SAVE</strong> (${roll}${fmtMod(saveMod)}=${total})`
      : `<strong class="miss">FAIL</strong> (${roll}${fmtMod(saveMod)}=${total})`;
    logCombat(`<strong>${name}</strong>: ${spell.save} ${saveStr}`, "spell");
  }

  await broadcastSfx("spell");

  // Auto-roll AoE damage
  const dieType = parseDieType(aoeDmgNotation) || "d6";
  let diceTotal, individualResults;
  let used3D = false;

  if (diceReady && diceBox) {
    try {
      show3DOverlay(`${spell.name} Explosion Damage`);
      const results = await Promise.race([
        diceBox.roll(aoeDmgNotation, { themeColor: getDiceColor(aoeDmgType) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D combo AoE roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  if (!used3D) {
    const rolled = rollDiceValues(aoeDmgNotation);
    diceTotal = rolled.diceTotal;
    individualResults = rolled.individualResults;
  }

  const fullDamage = Math.max(0, diceTotal);
  const halfDamage = Math.floor(fullDamage / 2);

  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  const dmgLabel = `${spell.name} Explosion`;
  const dmgResult = {
    notation: aoeDmgNotation, diceTotal, modifier: 0, finalTotal: fullDamage,
    natValue: null, charName: caster.name, label: dmgLabel,
    rollId: crypto.randomUUID(), individualResults,
  };

  if (used3D) {
    show3DResult(dmgLabel, dmgResult);
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    showDiceResultDisplay(dmgLabel, dmgResult, dieType);
    await new Promise((r) => setTimeout(r, 6000));
  }

  logCombat(`💥 ${spell.name} explosion: ${aoeDmgNotation} → ${diceStr} = <strong class="damage">${fullDamage}</strong> ${aoeDmgType}`, "damage");
  if (used3D) hide3DOverlay();

  // Apply damage to all targets
  const failCount = saveResults.filter(r => !r.saved).length;
  const saveCount = saveResults.filter(r => r.saved).length;

  const tokenIdsToUpdate = saveResults.filter(r => r.char).map(r => r.token.id);
  await OBR.scene.items.updateItems(tokenIdsToUpdate, (items) => {
    for (const item of items) {
      const r = saveResults.find(r => r.token.id === item.id);
      if (!r || !r.char) continue;
      const meta = item.metadata[METADATA_KEY];
      if (!meta?.character) continue;
      const dmg = r.saved ? 0 : fullDamage;
      let remaining = dmg;
      let temp = meta.character.hp.temp || 0;
      if (temp > 0) { const absorbed = Math.min(temp, remaining); temp -= absorbed; remaining -= absorbed; }
      meta.character.hp.current = Math.max(0, meta.character.hp.current - remaining);
      meta.character.hp.temp = temp;
      meta.lastUpdated = Date.now();
      logCombat(`${r.saved ? `<strong>${r.name}</strong> saved — no damage` : `<strong class="damage">${dmg}</strong> ${aoeDmgType} → <strong>${r.name}</strong>`}`, "damage");
    }
  });

  await syncInitiativeHP();
  await broadcastSfx("damage");
  for (const r of saveResults) {
    const dmg = r.saved ? 0 : fullDamage;
    if (dmg > 0) await showFloatingDamage(r.token.id, dmg, aoeDmgType, { isSpell: true });
    if (r.char) {
      const updatedItems = await OBR.scene.items.getItems([r.token.id]);
      const updatedMeta = updatedItems[0]?.metadata?.[METADATA_KEY];
      if (updatedMeta?.character?.hp?.current === 0) {
        addSkullToToken(r.token.id);
      }
    }
  }

  showCombatOverlay(`${spell.name} Explosion: ${fullDamage} ${aoeDmgType}!`,
    `${failCount} failed (full dmg), ${saveCount} saved (no dmg)`);
  await OBR.notification.show(`${spell.name} explosion: ${fullDamage} ${aoeDmgType}`, "SUCCESS");
  setTimeout(() => resetCombat(), 3000);
}

async function rollAttackD20(label, atkBonus, targetAC, targetName) {
  // ── Determine advantage/disadvantage from conditions ──
  const attackerConds = currentConditions || [];
  const targetToken = targetTokenId ? (await OBR.scene.items.getItems([targetTokenId]))[0] : null;
  const targetConds = targetToken?.metadata?.[COND_METADATA_KEY] || [];
  const weaponType = selectedWeapon?.attackType || "melee";

  const atkFx = getAttackerConditionEffects(attackerConds);
  const tgtFx = getTargetConditionEffects(targetConds, weaponType);

  // Combine: advantage from any source, disadvantage from any source
  let hasAdvantage = atkFx.advantage || tgtFx.advantage;
  let hasDisadvantage = atkFx.disadvantage || tgtFx.disadvantage;
  // They cancel out
  if (hasAdvantage && hasDisadvantage) { hasAdvantage = false; hasDisadvantage = false; }

  const rollMode = hasAdvantage ? "advantage" : hasDisadvantage ? "disadvantage" : "normal";

  // Log condition effects
  if (hasAdvantage) logCombat(`✅ Rolling with <strong class="hit">ADVANTAGE</strong>`, "info");
  if (hasDisadvantage) logCombat(`❌ Rolling with <strong class="miss">DISADVANTAGE</strong>`, "info");

  // ── Roll d20(s) ──
  let roll1, roll2;
  let used3D = false;

  if (diceReady && diceBox) {
    try {
      show3DOverlay(label);
      const notation = rollMode !== "normal" ? "2d20" : "1d20";
      const results = await Promise.race([
        diceBox.roll(notation, { themeColor: "#ff66aa" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      roll1 = results[0]?.value || 1;
      roll2 = results[1]?.value || null;
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D attack roll failed, using canvas:", err.message);
      hide3DOverlay();
    }
  }

  if (!used3D) {
    roll1 = rollDiceValues("1d20").diceTotal;
    if (rollMode !== "normal") roll2 = rollDiceValues("1d20").diceTotal;
  }

  // Pick the right d20 result
  let diceTotal;
  if (rollMode === "advantage") {
    diceTotal = Math.max(roll1, roll2);
    logCombat(`🎲 Rolls: <strong>${roll1}</strong> and <strong>${roll2}</strong> → takes <strong>${diceTotal}</strong> (advantage)`, "info");
  } else if (rollMode === "disadvantage") {
    diceTotal = Math.min(roll1, roll2);
    logCombat(`🎲 Rolls: <strong>${roll1}</strong> and <strong>${roll2}</strong> → takes <strong>${diceTotal}</strong> (disadvantage)`, "info");
  } else {
    diceTotal = roll1;
  }

  const natValue = diceTotal;
  const finalTotal = diceTotal + atkBonus;

  const result = {
    notation: rollMode !== "normal" ? "2d20" : "1d20", diceTotal, modifier: atkBonus, finalTotal, natValue,
    charName: attackerData?.name || "", label, rollId: crypto.randomUUID(),
  };

  // SFX
  if (natValue === 20) setTimeout(() => playSfx("crit"), 150);
  else if (natValue === 1) setTimeout(() => playSfx("miss"), 150);

  if (used3D) {
    show3DResult(label, result);
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    showDiceResultDisplay(label, result, "d20");
    await new Promise((r) => setTimeout(r, 8000));
  }

  // Broadcast
  const modStr = fmtMod(atkBonus);
  const notifText = `${attackerData?.name || ""} attacks ${targetName}: ${diceTotal}${modStr} = ${finalTotal} vs AC ${targetAC}`;
  OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO").catch(() => {});
  OBR.broadcast.sendMessage(SFX_CHANNEL, { sound: natValue === 20 ? "crit" : natValue === 1 ? "miss" : "dice-hit" }).catch(() => {});

  // Log attack roll
  const hitStr = natValue === 20 ? "NAT 20!" : natValue === 1 ? "NAT 1" : `${finalTotal} vs AC ${targetAC}`;
  logCombat(`<strong>${attackerData.name}</strong> rolls to hit: ${diceTotal}${modStr} = <strong>${finalTotal}</strong> (${hitStr})`, "info");

  if (used3D) hide3DOverlay();

  // ── Determine outcome ──
  // Paralyzed target: melee hits are auto-crits
  const forceCrit = tgtFx.autoCrit && natValue !== 1;
  const isCrit = natValue === 20 || forceCrit;
  const isNat1 = natValue === 1;
  const isHit = isCrit || (!isNat1 && finalTotal >= targetAC);

  if (forceCrit && isHit) logCombat(`⚡ <strong>AUTO-CRIT</strong> — target is Paralyzed!`, "crit");

  if (isHit) {
    resolveAttackRoll({ finalTotal, natValue: isCrit ? 20 : natValue });
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
      // Combo spell: AoE still triggers after graze
      if (combatAction === "spell-combo" && selectedSpell?.aoeDamage) {
        setTimeout(async () => { await castComboAoE(targetTokenId); }, 1500);
      } else {
        setTimeout(() => resetCombat(), 2500);
      }
      return;
    }

    logCombat(`<strong>${attackerData.name}</strong> → ${targetName}: <strong class="miss">MISS!</strong>`, "miss");
    showCombatOverlay(`MISS!`, `${attackerData.name}'s attack misses.`);
    playMissEffect();
    await broadcastSfx("miss");
    if (targetTokenId) tokenMissEffect(targetTokenId);
    await OBR.notification.show(`${attackerData.name} missed ${targetName}!`, "WARNING");

    // Combo spell: AoE still triggers on miss (e.g. Ice Knife explodes regardless)
    if (combatAction === "spell-combo" && selectedSpell?.aoeDamage) {
      setTimeout(async () => {
        await castComboAoE(targetTokenId);
      }, 1500);
    } else {
      setTimeout(() => resetCombat(), 2000);
    }
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

  // Show damage roll panel — player clicks 🎲 to roll
  const hitLabel = isCrit ? `CRIT! → ${targetName}` : `HIT! → ${targetName}`;
  showDamageRollPanel(hitLabel, isCrit);
}

// ── Damage Roll Panel (player clicks to roll) ──
const damageRollPanel = document.getElementById("damage-roll-panel");
const damageRollTitle = document.getElementById("damage-roll-title");
const damageRollInfo = document.getElementById("damage-roll-info");
const damageRollBtn = document.getElementById("damage-roll-btn");
const smiteRow = document.getElementById("smite-row");
const smiteToggle = document.getElementById("smite-toggle");
const smiteSlotSelect = document.getElementById("smite-slot-select");
const sneakRow = document.getElementById("sneak-row");
const sneakToggle = document.getElementById("sneak-toggle");
let pendingDamageCrit = false;
let smiteActive = false;
let sneakActive = false;

smiteToggle.addEventListener("click", () => {
  smiteActive = !smiteActive;
  smiteToggle.classList.toggle("active", smiteActive);
  smiteSlotSelect.style.display = smiteActive ? "inline-block" : "none";
  updateDamageRollBtnText();
});

smiteSlotSelect.addEventListener("change", () => updateDamageRollBtnText());

sneakToggle.addEventListener("click", () => {
  sneakActive = !sneakActive;
  sneakToggle.classList.toggle("active", sneakActive);
  updateDamageRollBtnText();
});

function getSmiteDice() {
  if (!smiteActive) return null;
  const slotLevel = parseInt(smiteSlotSelect.value) || 1;
  // Divine Smite: 2d8 at Lv1, +1d8 per level above 1
  const numDice = 1 + slotLevel;
  return { dice: `${numDice}d8`, slotLevel, type: "Radiant" };
}

function getSneakDice() {
  if (!sneakActive) return null;
  const source = attackerData || currentCharData;
  const sa = source?.sneakAttack;
  if (!sa) return null;
  return { dice: sa.dice, type: "same" }; // "same" = uses weapon's damage type
}

function updateDamageRollBtnText() {
  if (!selectedWeapon?.damage) return;
  const baseDice = selectedWeapon.damage;
  const mod = selectedWeapon.damageMod || 0;
  const modStr = mod !== 0 ? fmtMod(mod) : "";
  let notation = baseDice;
  if (pendingDamageCrit) {
    notation = baseDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
  }

  // Collect bonus dice labels
  const bonusParts = [];
  const smite = getSmiteDice();
  if (smite) {
    let smiteDice = smite.dice;
    if (pendingDamageCrit) smiteDice = smiteDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
    bonusParts.push({ dice: smiteDice, label: "⚡Smite", type: "Radiant" });
  }
  const sneak = getSneakDice();
  if (sneak) {
    let sneakDice = sneak.dice;
    if (pendingDamageCrit) sneakDice = sneakDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
    bonusParts.push({ dice: sneakDice, label: "🗡Sneak", type: selectedWeapon.damageType || "" });
  }

  if (bonusParts.length > 0) {
    const bonusDiceStr = bonusParts.map(b => b.dice).join("+");
    const bonusInfoStr = bonusParts.map(b => `${b.label} ${b.dice} ${b.type}`).join(" + ");
    damageRollBtn.textContent = `🎲 Roll ${notation}+${bonusDiceStr}${modStr}`;
    damageRollInfo.textContent = `${selectedWeapon.name}: ${notation}${modStr} ${selectedWeapon.damageType || ""} + ${bonusInfoStr}${pendingDamageCrit ? " (CRIT)" : ""}`;
  } else {
    const dmgType = selectedWeapon.damageType || "";
    damageRollBtn.textContent = `🎲 Roll ${notation}${modStr}`;
    damageRollInfo.textContent = `${selectedWeapon.name}: ${notation}${modStr} ${dmgType}${pendingDamageCrit ? " (CRIT x2 dice)" : ""}`;
  }
}

function showDamageRollPanel(title, isCrit) {
  pendingDamageCrit = isCrit;
  smiteActive = false;
  sneakActive = false;
  smiteToggle.classList.remove("active");
  sneakToggle.classList.remove("active");
  smiteSlotSelect.style.display = "none";
  damageRollTitle.textContent = title || "Roll Damage";

  const source = attackerData || currentCharData;

  // ── Divine Smite: melee + has spell + available slots ──
  const hasSmite = source?.spells?.some(s => s.name?.toLowerCase().includes("smite") && s.name?.toLowerCase().includes("divine") && (s.prepared || s.alwaysPrepared));
  const isMelee = (combatAction === "attack" || combatAction === "spell-combo") && (selectedWeapon?.attackType === "melee" || !selectedWeapon?.attackType);
  const availableSlots = (source?.spellSlots || []).filter(s => s.remaining > 0);

  if (hasSmite && isMelee && availableSlots.length > 0) {
    smiteRow.classList.remove("hidden");
    smiteSlotSelect.innerHTML = availableSlots.map(s =>
      `<option value="${s.level}">Lv.${s.level} (${s.remaining}/${s.max})</option>`
    ).join("");
  } else {
    smiteRow.classList.add("hidden");
  }

  // ── Sneak Attack: Rogue + finesse/ranged weapon ──
  const sa = source?.sneakAttack;
  const isFinesse = selectedWeapon?.properties?.some(p => p.toLowerCase().includes("finesse"));
  const isRanged = selectedWeapon?.attackType === "ranged";
  const canSneak = sa && (combatAction === "attack") && (isFinesse || isRanged);

  if (canSneak) {
    sneakRow.classList.remove("hidden");
    sneakToggle.textContent = `🗡️ Sneak Attack (${sa.dice})`;
    // Auto-enable sneak attack (player can toggle off if they don't want it)
    sneakActive = true;
    sneakToggle.classList.add("active");
  } else {
    sneakRow.classList.add("hidden");
  }

  // Update button text (handles smite + sneak dice display)
  updateDamageRollBtnText();

  damageRollPanel.classList.add("visible");
}

function hideDamageRollPanel() { damageRollPanel.classList.remove("visible"); }

damageRollBtn.addEventListener("click", async () => {
  const smite = getSmiteDice();
  const sneak = getSneakDice();
  hideDamageRollPanel();
  if (!selectedWeapon || !selectedWeapon.damage) {
    selectedWeapon = selectedWeapon || { name: "Attack", damage: "1d4", damageMod: 0, damageType: "damage", attackType: "melee", properties: [], mastery: [] };
    if (!selectedWeapon.damage) selectedWeapon.damage = "1d4";
  }

  // If smite active, consume spell slot and add smite dice
  const smiteChar = attackerData || currentCharData;
  const smiteTokenId = attackerTokenId || currentTokenId;
  if (smite && smiteChar?.spellSlots) {
    const slot = smiteChar.spellSlots.find(s => s.level === smite.slotLevel && s.remaining > 0);
    if (slot) {
      slot.remaining--;
      slot.used++;
      await OBR.scene.items.updateItems([smiteTokenId], (items) => {
        for (const item of items) {
          const meta = item.metadata[METADATA_KEY];
          if (!meta?.character?.spellSlots) return;
          const s = meta.character.spellSlots.find(sl => sl.level === smite.slotLevel);
          if (s) { s.remaining = slot.remaining; s.used = slot.used; }
          meta.lastUpdated = Date.now();
        }
      });
      logCombat(`⚡ <strong>Divine Smite</strong> (Lv.${smite.slotLevel} slot) — +${smite.dice} Radiant (${slot.remaining}/${slot.max} slots left)`, "spell");
    }
  }

  // Log sneak attack
  if (sneak) {
    logCombat(`🗡️ <strong>Sneak Attack</strong> — +${sneak.dice} ${selectedWeapon.damageType || ""}`, "hit");
  }

  const targetName = targetData?.name || "Target";
  await rollDamageDice(pendingDamageCrit, targetName, smite, sneak);
});

document.getElementById("damage-roll-cancel").addEventListener("click", () => {
  hideDamageRollPanel();
  resetCombat();
});

async function rollDamageDice(isCrit, targetName, smite = null, sneak = null) {
  const weapon = selectedWeapon;
  const baseDice = weapon.damage || "1d4";
  const damageMod = weapon.damageMod || 0;
  const damageType = weapon.damageType || "damage";
  const hasDice = /\d+d\d+/.test(baseDice);

  // Determine die type from weapon damage (e.g., "1d8" → "d8")
  const dieType = parseDieType(baseDice) || "d6";

  // For crit: double the dice (e.g., 1d8 → 2d8, 2d6 → 4d6)
  let notation = baseDice;
  if (isCrit && hasDice) {
    notation = baseDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
  }

  // Add Divine Smite dice
  if (smite) {
    let smiteDice = smite.dice;
    if (isCrit) smiteDice = smiteDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
    notation = hasDice ? `${notation}+${smiteDice}` : smiteDice;
  }

  // Add Sneak Attack dice
  if (sneak) {
    let sneakDice = sneak.dice;
    if (isCrit) sneakDice = sneakDice.replace(/(\d+)d(\d+)/g, (_, n, d) => `${parseInt(n) * 2}d${d}`);
    notation = hasDice || smite ? `${notation}+${sneakDice}` : sneakDice;
  }

  let diceTotal, individualResults;
  let used3D = false;

  // Flat damage (e.g. Unarmed Strike "1") — no dice to roll
  if (!hasDice) {
    diceTotal = parseInt(baseDice) || 1;
    individualResults = [diceTotal];
    if (isCrit) diceTotal *= 2;  // Crit doubles flat damage too
  } else {
    // Try 3D dice-box first
    const rollColor = getDiceColor(damageType);
    if (diceReady && diceBox) {
      try {
        show3DOverlay(`${attackerData.name} ${weapon.name} ${isCrit ? "CRIT " : ""}Damage`);

        const results = await Promise.race([
          diceBox.roll(notation, { themeColor: rollColor }),
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
  }

  // Add condition-based melee damage bonus (e.g. Rage +2)
  let condDmgBonus = 0;
  if (weapon.attackType === "melee" || !weapon.attackType) {
    const attackerConds = currentConditions || [];
    condDmgBonus = getMeleeDamageBonus(attackerConds);
    if (condDmgBonus > 0) logCombat(`🔥 <strong>Rage</strong> adds <strong>+${condDmgBonus}</strong> melee damage`, "info");
  }

  const totalDamage = Math.max(0, diceTotal + damageMod + condDmgBonus);
  const label = `${attackerData.name} ${weapon.name} ${isCrit ? "CRIT " : ""}Damage`;
  const effectiveMod = damageMod + condDmgBonus;
  const modStr = effectiveMod !== 0 ? fmtMod(effectiveMod) : "";

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
  let damage = Math.max(0, finalTotal);
  const targetName = targetData?.name || "Target";

  if (!targetData || !targetTokenId) {
    logCombat(`Dealt <strong>${damage}</strong> damage to ${targetName} (no linked data to update)`, "damage");
    await OBR.notification.show(`${attackerData.name} deals ${damage} damage to ${targetName}!`, "SUCCESS");
    resetCombat();
    return;
  }

  // Check target's resistances / immunities / vulnerabilities
  const dmgType = (selectedWeapon?.damageType || selectedSpell?.damageType || "").toLowerCase();
  if (dmgType && targetData) {
    const matchDef = (list, type) => (list || []).some(e =>
      e.type.toLowerCase() === type || e.type.toLowerCase().includes(type)
    );
    if (matchDef(targetData.immunities, dmgType)) {
      logCombat(`🛡️ <strong>${targetName}</strong> is <strong>IMMUNE</strong> to ${dmgType} — damage negated!`, "info");
      damage = 0;
    } else if (matchDef(targetData.resistances, dmgType)) {
      const reduced = Math.floor(damage / 2);
      logCombat(`🛡️ <strong>${targetName}</strong> has <strong>Resistance</strong> to ${dmgType} — ${damage} → ${reduced}`, "info");
      damage = reduced;
    } else if (matchDef(targetData.vulnerabilities, dmgType)) {
      const doubled = damage * 2;
      logCombat(`💥 <strong>${targetName}</strong> is <strong>Vulnerable</strong> to ${dmgType} — ${damage} → ${doubled}`, "info");
      damage = doubled;
    }
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

  // ── Combo spell: trigger AoE phase after attack damage ──
  if (combatAction === "spell-combo" && selectedSpell?.aoeDamage) {
    setTimeout(async () => {
      await castComboAoE(targetTokenId);
    }, 2000);
  } else {
    setTimeout(() => resetCombat(), 3200);
  }
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
          logCombat(`⚔️ <strong>Topple</strong>: ${targetName} CON Save ${saveResult.roll}${fmtMod(conMod)}=${saveResult.total} vs DC ${dc} — <strong class="hit">SAVED</strong>`, "info");
        } else {
          logCombat(`⚔️ <strong>Topple</strong>: ${targetName} CON Save ${saveResult.roll}${fmtMod(conMod)}=${saveResult.total} vs DC ${dc} — <strong class="miss">PRONE!</strong>`, "hit");
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
      themeColor: "#ff66aa",
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
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` − ${Math.abs(modifier)}` : "";
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
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` − ${Math.abs(modifier)}` : "";
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

async function rollDice(notation, label, modifier = 0, rollId = null, condFx = null) {
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
        diceBox.roll(notation, { themeColor: "#ff66aa" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      diceTotal = results.reduce((sum, r) => sum + r.value, 0);
      individualResults = results.map(r => r.value);
      used3D = true;
      playSfx("dice-hit");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[dice] 3D roll failed, using canvas fallback:", err.message);
      hide3DOverlay();
    }
  }

  // Handle advantage/disadvantage for 2d20 rolls
  if (condFx && (condFx.advantage || condFx.disadvantage) && individualResults.length >= 2) {
    const r1 = individualResults[0], r2 = individualResults[1];
    if (condFx.advantage) {
      diceTotal = Math.max(r1, r2);
      logCombat(`🎲 Rolls: <strong>${r1}</strong> and <strong>${r2}</strong> → takes <strong>${diceTotal}</strong> (advantage)`, "info");
    } else {
      diceTotal = Math.min(r1, r2);
      logCombat(`🎲 Rolls: <strong>${r1}</strong> and <strong>${r2}</strong> → takes <strong>${diceTotal}</strong> (disadvantage)`, "info");
    }
  }

  const finalTotal = diceTotal + modifier;
  const isSingleD20Check = notation === "1d20" || (condFx && notation === "2d20");
  const natValue = isSingleD20Check ? diceTotal : null;

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

  const modStr = modifier !== 0 ? fmtMod(modifier) : "";
  const notifText = charName
    ? `${charName} rolled ${notation}${modStr}: ${finalTotal}${natValue === 20 ? " (NAT 20!)" : natValue === 1 ? " (NAT 1)" : ""}`
    : `Rolled ${notation}${modStr}: ${finalTotal}`;
  OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO").catch(() => {});

  // Log to combat log for all players
  const diceStr = individualResults.length > 1 ? `[${individualResults.join(", ")}]` : `${diceTotal}`;
  const logModStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` − ${Math.abs(modifier)}` : "";
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

  // Show Wild Shape button if character has creatures (Druid)
  const wsBtn = document.querySelector('.hotbar-btn.wildshape-btn');
  if (wsBtn) {
    const hasCreatures = char.creatures && char.creatures.length > 0;
    wsBtn.style.display = hasCreatures ? "" : "none";
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
function hideTokenSavePanel() { tokenSavePanel.classList.remove("visible"); }
function hideWildShapePanel() { document.getElementById("wildshape-panel").classList.remove("visible"); }
function hideAll() { hideHotbar(); hideError(); linkPanel.classList.add("hidden"); hideSpellPicker(); hideConditionPicker(); hideActionPicker(); hideSkillPicker(); hideSavePicker(); hideBonusPicker(); hideAoeResults(); hideDamageRollPanel(); hideInventoryPanel(); hideFeaturesPanel(); hideTokenSavePanel(); hideWildShapePanel(); currentTokenId = null; }

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

    if (action === "token-save") {
      if (tokenSavePanel.classList.contains("visible")) hideTokenSavePanel();
      else showTokenSavePanel();
      return;
    }

    if (action === "wildshape") {
      const wsPanel = document.getElementById("wildshape-panel");
      if (wsPanel.classList.contains("visible")) hideWildShapePanel();
      else showWildShapePanel();
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
