const ABILITY_NAMES = [
  "STR", "DEX", "CON", "INT", "WIS", "CHA"
];

// categoryId: 1=Simple, 2=Martial; attackType: 1=Melee, 2=Ranged
const CATEGORY_NAMES = { 1: "Simple", 2: "Martial" };
const ATTACK_TYPE_NAMES = { 1: "Melee", 2: "Ranged" };

export function parseCharacter(raw) {
  // Support both v5 (raw.data) and SCDS v1 (raw.data or raw directly)
  const d = raw.data || raw;

  const stats = parseStats(d);
  const hp = parseHP(d, getConMod(stats));
  const classes = parseClasses(d);
  const profBonus = getProficiencyBonus(classes);
  const weapons = parseWeapons(d, stats, profBonus);
  const skills = parseSkills(d, stats, profBonus);
  const bonusActions = parseBonusActions(d, classes, weapons);
  const inventory = parseInventory(d);
  const spells = parseSpells(d, stats, profBonus);
  const features = parseFeatures(d, stats, profBonus, classes);

  // Currency
  const currencies = d.currencies || {};
  const currency = {
    cp: currencies.cp || 0,
    sp: currencies.sp || 0,
    ep: currencies.ep || 0,
    gp: currencies.gp || 0,
    pp: currencies.pp || 0,
  };

  // Spell slots
  const spellSlots = parseSpellSlots(d);

  return {
    id: d.id,
    name: d.name,
    avatarUrl: d.decorations?.avatarUrl || null,
    race: d.race?.fullName || "Unknown",
    classes,
    level: classes.reduce((sum, c) => sum + c.level, 0),
    hp,
    stats,
    ac: parseAC(d, stats),
    proficiencyBonus: profBonus,
    speed: parseSpeed(d),
    weapons,
    skills,
    savingThrows: parseSavingThrows(d, stats, profBonus),
    bonusActions,
    inventory,
    currency,
    spells,
    features,
    spellSlots,
    creatures: parseCreatures(d),
    ...parseDefenses(d),
    initiative: parseInitiative(d, stats, profBonus, classes),
    sneakAttack: parseSneakAttack(d, classes),
  };
}

const SKILL_MAP = {
  acrobatics: { name: "Acrobatics", ability: "DEX" },
  "animal-handling": { name: "Animal Handling", ability: "WIS" },
  arcana: { name: "Arcana", ability: "INT" },
  athletics: { name: "Athletics", ability: "STR" },
  deception: { name: "Deception", ability: "CHA" },
  history: { name: "History", ability: "INT" },
  insight: { name: "Insight", ability: "WIS" },
  intimidation: { name: "Intimidation", ability: "CHA" },
  investigation: { name: "Investigation", ability: "INT" },
  medicine: { name: "Medicine", ability: "WIS" },
  nature: { name: "Nature", ability: "INT" },
  perception: { name: "Perception", ability: "WIS" },
  performance: { name: "Performance", ability: "CHA" },
  persuasion: { name: "Persuasion", ability: "CHA" },
  religion: { name: "Religion", ability: "INT" },
  "sleight-of-hand": { name: "Sleight of Hand", ability: "DEX" },
  stealth: { name: "Stealth", ability: "DEX" },
  survival: { name: "Survival", ability: "WIS" },
};

function parseSkills(d, stats, profBonus) {
  const proficient = new Set();
  const expertise = new Set();

  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  for (const mod of allMods) {
    if (!mod.subType || !(mod.subType in SKILL_MAP)) continue;
    if (mod.type === "proficiency") proficient.add(mod.subType);
    else if (mod.type === "expertise") expertise.add(mod.subType);
  }

  return Object.entries(SKILL_MAP).map(([key, info]) => {
    const abilityMod = stats.find((s) => s.name === info.ability)?.modifier || 0;
    const isProf = proficient.has(key);
    const isExp = expertise.has(key);
    let modifier = abilityMod;
    if (isExp) modifier += profBonus * 2;
    else if (isProf) modifier += profBonus;
    return {
      key,
      name: info.name,
      ability: info.ability,
      modifier,
      proficient: isProf,
      expertise: isExp,
    };
  });
}

function parseSavingThrows(d, stats, profBonus) {
  // Gather saving throw proficiencies from modifiers
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  const proficient = new Set();
  const bonuses = {};

  for (const mod of allMods) {
    // Proficiency: subType like "strength-saving-throws"
    if (mod.type === "proficiency" && mod.subType?.endsWith("-saving-throws")) {
      const ability = mod.subType.replace("-saving-throws", "").toUpperCase().slice(0, 3);
      // Map full name to abbreviation
      const nameMap = { STR: "STR", DEX: "DEX", CON: "CON", INT: "INT", WIS: "WIS", CHA: "CHA",
                        STRENGTH: "STR", DEXTERITY: "DEX", CONSTITUTION: "CON",
                        INTELLIGENCE: "INT", WISDOM: "WIS", CHARISMA: "CHA" };
      const key = nameMap[ability] || ability;
      if (ABILITY_NAMES.includes(key)) proficient.add(key);
    }
    // Bonus to saving throws (e.g. Ring of Protection, Paladin Aura)
    if (mod.type === "bonus" && mod.value) {
      if (mod.subType === "saving-throws") {
        // Global bonus to all saves
        for (const ab of ABILITY_NAMES) {
          bonuses[ab] = (bonuses[ab] || 0) + mod.value;
        }
      }
    }
  }

  return ABILITY_NAMES.map((name) => {
    const stat = stats.find((s) => s.name === name);
    const abilityMod = stat?.modifier || 0;
    const isProf = proficient.has(name);
    const bonus = bonuses[name] || 0;
    const modifier = abilityMod + (isProf ? profBonus : 0) + bonus;
    return { name, modifier, proficient: isProf };
  });
}

// D&D Beyond activation types
const ACTIVATION_BONUS_ACTION = 3;  // activationType=3 means Bonus Action

function parseBonusActions(d, classes, weapons) {
  const actions = [];
  const seenKeys = new Set();

  // Off-hand attack if dual wielding (light weapon equipped that's not the primary)
  const equippedWeapons = weapons.filter((w) => w.equipped);
  if (equippedWeapons.length > 1) {
    const offhand = equippedWeapons.find((w) => w.properties?.includes("Light")) || equippedWeapons[1];
    if (offhand) {
      actions.push({
        key: "offhand-attack",
        name: `Off-Hand: ${offhand.name}`,
        description: `Bonus attack with ${offhand.name} (no ability mod to damage)`,
        type: "attack",
        weapon: offhand,
      });
      seenKeys.add("offhand-attack");
    }
  }

  // Parse bonus actions from d.actions (class, race, feat, item, background)
  const actionSources = ["class", "race", "feat", "item", "background"];
  for (const src of actionSources) {
    const srcActions = d.actions?.[src] || [];
    for (const a of srcActions) {
      const activationType = a.activation?.activationType;
      if (activationType !== ACTIVATION_BONUS_ACTION) continue;

      const key = a.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `action-${a.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Clean HTML from description/snippet
      const rawDesc = a.snippet || a.description || "";
      const description = rawDesc.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim().substring(0, 200);

      // Determine action type
      let type = "other";
      if (a.attackSubtype) type = "attack";
      else if (a.dice) type = "spell";
      else if (a.displayAsAttack) type = "spell";

      // Build dice string if available
      let dice = null;
      if (a.dice) {
        dice = a.dice.diceString || (a.dice.diceCount && a.dice.diceValue ? `${a.dice.diceCount}d${a.dice.diceValue}` : null);
      }

      // Limited use info
      let usesText = "";
      if (a.limitedUse) {
        const maxUses = a.limitedUse.maxUses || 0;
        const used = a.limitedUse.numberUsed || 0;
        const resetNames = { 1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Dusk" };
        const resetType = resetNames[a.limitedUse.resetType] || "";
        usesText = ` (${maxUses - used}/${maxUses}${resetType ? " per " + resetType : ""})`;
      }

      actions.push({
        key,
        name: a.name + (usesText ? usesText : ""),
        description,
        type,
        dice,
        damageTypeId: a.damageTypeId,
      });
    }
  }

  // Parse bonus action spells from classSpells
  for (const cs of (d.classSpells || [])) {
    for (const s of (cs.spells || [])) {
      const def = s.definition;
      if (!def || def.activation?.activationType !== ACTIVATION_BONUS_ACTION) continue;

      const key = def.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `spell-${def.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const rawDesc = def.snippet || def.description || "";
      const description = rawDesc.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim().substring(0, 200);

      actions.push({
        key,
        name: def.name,
        description,
        type: "spell",
      });
    }
  }

  // Universal bonus actions
  actions.push(
    { key: "potion", name: "Drink Potion", description: "Quaff a potion as a bonus action", type: "item" },
  );

  return actions;
}

// Map subType strings like "dexterity-score" → stat ID 2
const SUBTYPE_TO_STAT_ID = {
  "strength-score": 1,
  "dexterity-score": 2,
  "constitution-score": 3,
  "intelligence-score": 4,
  "wisdom-score": 5,
  "charisma-score": 6,
};

function parseStats(d) {
  const base = {};
  for (const stat of d.stats) {
    base[stat.id] = stat.value || 10;
  }

  // Gather bonuses from ALL modifier sources (race, class, feat, item, background, condition)
  const bonuses = {};
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  for (const mod of allMods) {
    if (mod.type !== "bonus" || !mod.value) continue;
    // Try entityId first (maps directly to stat ID 1-6)
    let statId = mod.entityId;
    // If no entityId, try parsing subType (e.g. "dexterity-score" → 2)
    if (!statId && mod.subType) {
      statId = SUBTYPE_TO_STAT_ID[mod.subType];
    }
    if (statId >= 1 && statId <= 6) {
      bonuses[statId] = (bonuses[statId] || 0) + mod.value;
    }
  }

  // Also add bonusStats (manual bonuses set on character sheet)
  for (const bs of d.bonusStats || []) {
    if (bs.value) {
      bonuses[bs.id] = (bonuses[bs.id] || 0) + bs.value;
    }
  }

  const overrides = {};
  for (const ov of d.overrideStats || []) {
    if (ov.value !== null && ov.value !== undefined) {
      overrides[ov.id] = ov.value;
    }
  }

  const result = [];
  for (let i = 0; i < 6; i++) {
    const statId = i + 1;
    const total = overrides[statId] ?? (base[statId] + (bonuses[statId] || 0));
    const mod = Math.floor((total - 10) / 2);
    result.push({
      name: ABILITY_NAMES[i],
      value: total,
      modifier: mod,
    });
  }

  return result;
}

function getConMod(stats) {
  const con = stats.find((s) => s.name === "CON");
  return con ? con.modifier : 0;
}

function parseHP(d, conMod) {
  const base = d.baseHitPoints || 0;
  const bonus = d.bonusHitPoints || 0;
  const removed = d.removedHitPoints || 0;
  const temp = d.temporaryHitPoints || 0;

  const classHP = base;
  const conHP = conMod * getTotalLevel(d);
  const max = classHP + conHP + bonus;

  return {
    current: max - removed,
    max,
    temp,
  };
}

function getTotalLevel(d) {
  return (d.classes || []).reduce((sum, c) => sum + (c.level || 0), 0);
}

function parseClasses(d) {
  return (d.classes || []).map((c) => ({
    name: c.definition?.name || "Unknown",
    level: c.level || 1,
    subclass: c.subclassDefinition?.name || null,
  }));
}

// armorTypeId: 1=Light, 2=Medium, 3=Heavy, 4=Shield
function parseAC(d, stats) {
  const dexMod = stats.find((s) => s.name === "DEX")?.modifier || 0;
  const baseAC = 10 + dexMod;

  let armorAC = null;
  let shieldBonus = 0;

  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!item.equipped || !def || !def.armorClass) continue;

    const armorType = def.armorTypeId || 0;
    const typeStr = (def.type || "").toLowerCase();

    if (armorType === 4 || typeStr.includes("shield")) {
      shieldBonus += def.armorClass;
      continue;
    }

    if (armorType === 3 || typeStr.includes("heavy")) {
      armorAC = def.armorClass;
    } else if (armorType === 2 || typeStr.includes("medium")) {
      armorAC = def.armorClass + Math.min(dexMod, 2);
    } else {
      // Light armor (armorTypeId=1) or unknown → add full DEX
      armorAC = def.armorClass + dexMod;
    }
  }

  // Gather ALL AC bonuses from modifier sources:
  // d.modifiers.item  → magic armor/shield bonuses (+1 chain mail, Ring of Protection, etc.)
  // d.modifiers.class → Fighting Style: Defense (+1 AC while wearing armor)
  // d.modifiers.feat  → feat-based AC bonuses
  // d.modifiers.race  → racial AC bonuses
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  let modifierBonus = 0;
  for (const mod of allMods) {
    if (mod.type === "bonus" && mod.subType === "armor-class" && mod.value) {
      modifierBonus += mod.value;
    }
  }

  return (armorAC ?? baseAC) + shieldBonus + modifierBonus;
}

function parseSpeed(d) {
  const walking = d.race?.weightSpeeds?.normal?.walk || 30;
  return walking;
}

function parseDefenses(d) {
  const resistances = [];
  const immunities = [];
  const vulnerabilities = [];

  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  for (const mod of allMods) {
    const dmgType = (mod.friendlySubtypeName || mod.subType || "").replace(/-/g, " ");
    if (!dmgType) continue;
    const restriction = mod.restriction || null;
    const entry = { type: dmgType, restriction };

    if (mod.type === "resistance") resistances.push(entry);
    else if (mod.type === "immunity") immunities.push(entry);
    else if (mod.type === "vulnerability") vulnerabilities.push(entry);
  }

  return { resistances, immunities, vulnerabilities };
}

function parseSneakAttack(d, classes) {
  const rogueClass = classes.find(c => c.name === "Rogue");
  if (!rogueClass) return null;
  const rogueLevel = rogueClass.level || 0;
  if (rogueLevel < 1) return null;
  const numDice = Math.ceil(rogueLevel / 2);
  return { dice: `${numDice}d6`, numDice, type: "same" }; // "same" = same damage type as weapon
}

function parseInitiative(d, stats, profBonus, classes) {
  const dexMod = stats.find(s => s.name === "DEX")?.modifier || 0;
  let bonus = 0;

  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
  ];

  for (const mod of allMods) {
    const sub = (mod.subType || "").toLowerCase();
    if (sub === "initiative" && mod.type === "bonus" && mod.value) {
      bonus += mod.value; // e.g. Alert feat: +5
    }
    if (sub === "initiative" && mod.type === "half-proficiency") {
      bonus += Math.floor(profBonus / 2); // Jack of All Trades
    }
  }

  return dexMod + bonus;
}

const MASTERY_PROPERTIES = ["Nick", "Vex", "Slow", "Graze", "Cleave", "Topple", "Push", "Sap"];

function parseWeapons(d, stats, profBonus) {
  const weapons = [];
  const strMod = stats.find((s) => s.name === "STR")?.modifier || 0;
  const dexMod = stats.find((s) => s.name === "DEX")?.modifier || 0;

  // Gather global attack/damage bonuses from modifiers
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];
  let globalAtkBonus = 0;
  let globalDmgBonus = 0;
  for (const mod of allMods) {
    if (mod.type === "bonus" && mod.value) {
      if (mod.subType === "weapon-attacks") globalAtkBonus += mod.value;
      if (mod.subType === "weapon-damage") globalDmgBonus += mod.value;
    }
  }

  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!def) continue;

    const isWeapon = def.filterType === "Weapon" || def.type === "Weapon" || def.damage;
    if (!isWeapon) continue;

    const damage = def.damage;
    const props = (def.properties || []).map((p) => p.name);
    const isFinesse = props.includes("Finesse");
    const isRanged = (def.attackType === 2) || def.type?.includes("Ranged");
    const abilityMod = isRanged ? dexMod : isFinesse ? Math.max(strMod, dexMod) : strMod;
    const attackBonus = abilityMod + profBonus + globalAtkBonus;
    const damageMod = abilityMod + globalDmgBonus;

    // Separate regular properties and weapon mastery
    const regularProps = props.filter((p) => !MASTERY_PROPERTIES.includes(p));
    const mastery = props.filter((p) => MASTERY_PROPERTIES.includes(p));

    // Damage type from def.damageType (string) or def.damage.damageType or def.damage.type.name
    const damageType = def.damageType
      || damage?.damageType
      || damage?.type?.name
      || "Unknown";

    const catName = CATEGORY_NAMES[def.categoryId] || "";
    const atkName = ATTACK_TYPE_NAMES[def.attackType] || "Melee";
    const weaponType = catName ? `${catName} ${atkName}` : `${def.type} ${atkName}`;

    // Deduplicate: skip if same weapon name already added (prefer equipped)
    const existing = weapons.find(w => w.name === def.name);
    if (existing) {
      // If new one is equipped and old one isn't, replace it
      if ((item.equipped || false) && !existing.equipped) {
        Object.assign(existing, {
          equipped: true, type: weaponType, attackType: isRanged ? "ranged" : "melee",
          damage: damage ? damage.diceString : "1", damageType, damageMod, abilityMod,
          attackBonus, range: def.range || 5, longRange: def.longRange || def.range || 5,
          properties: regularProps, mastery,
        });
      }
      continue;
    }

    weapons.push({
      name: def.name,
      equipped: item.equipped || false,
      type: weaponType,
      attackType: isRanged ? "ranged" : "melee",
      damage: damage ? damage.diceString : "1",
      damageType,
      damageMod,
      abilityMod,
      attackBonus,
      range: def.range || 5,
      longRange: def.longRange || def.range || 5,
      properties: regularProps,
      mastery,
    });
  }

  // ── Unarmed Strike (scales with class features) ──
  let unarmedDie = "1";        // default: 1 + STR (no die)
  let unarmedAbility = strMod;
  let unarmedExtraProps = [];

  // Monk: Martial Arts die scales with level, can use DEX
  const monkClass = (d.classes || []).find(c => c.definition?.name === "Monk");
  if (monkClass) {
    const lvl = monkClass.level || 1;
    if (lvl >= 17)     unarmedDie = "1d12";
    else if (lvl >= 11) unarmedDie = "1d10";
    else if (lvl >= 5)  unarmedDie = "1d8";
    else                unarmedDie = "1d6";
    // Martial Arts: use DEX if higher than STR
    unarmedAbility = Math.max(strMod, dexMod);
    unarmedExtraProps.push("Martial Arts");
  }

  // Fighter (Unarmed Fighting Style): 1d6 (or 1d8 with free hands)
  const hasFightingStyle = allMods.some(m =>
    (m.friendlySubtypeName || "").toLowerCase().includes("unarmed fighting") ||
    (m.subType || "").toLowerCase().includes("unarmed-strike-damage-dice")
  );
  if (hasFightingStyle && unarmedDie === "1") {
    unarmedDie = "1d6";
    unarmedExtraProps.push("Unarmed Fighting");
  }

  // Check modifiers for any unarmed damage dice override from API
  for (const mod of allMods) {
    const sub = (mod.subType || "").toLowerCase();
    if ((sub.includes("unarmed") && sub.includes("damage") && sub.includes("dice")) ||
        sub === "unarmed-strike-damage-dice") {
      if (mod.dice?.diceString) {
        unarmedDie = mod.dice.diceString;
      } else if (mod.value && mod.value > 1) {
        unarmedDie = `1d${mod.value}`;
      }
    }
  }

  // Tavern Brawler feat: 1d4 if still flat 1
  const hasTavernBrawler = allMods.some(m =>
    (m.friendlySubtypeName || "").toLowerCase().includes("tavern brawler")
  );
  if (hasTavernBrawler && unarmedDie === "1") {
    unarmedDie = "1d4";
    unarmedExtraProps.push("Tavern Brawler");
  }

  weapons.push({
    name: "Unarmed Strike",
    equipped: true,
    type: "Simple Melee",
    attackType: "melee",
    damage: unarmedDie,
    damageType: "Bludgeoning",
    damageMod: unarmedAbility + globalDmgBonus,
    abilityMod: unarmedAbility,
    attackBonus: unarmedAbility + profBonus + globalAtkBonus,
    range: 5,
    longRange: 5,
    properties: unarmedExtraProps,
    mastery: [],
  });

  return weapons;
}

function parseInventory(d) {
  const items = [];
  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!def) continue;

    const filterType = def.filterType || def.type || "Other";
    const subType = def.subType || def.type || "";
    const notes = [];

    // Build notes from properties
    if (def.armorClass) notes.push(`AC ${def.armorClass}`);
    if (def.damage?.diceString) notes.push(`${def.damage.diceString} ${def.damageType || ""}`);
    if (def.range && def.range > 5) notes.push(`Range ${def.range}${def.longRange ? `/${def.longRange}` : ""}`);
    if (def.properties) {
      for (const p of def.properties) {
        if (p.name) notes.push(p.name);
      }
    }
    if (def.stealthCheck === 1) notes.push("Stealth ⊘");

    items.push({
      name: def.name,
      type: filterType,
      subType,
      equipped: item.equipped || false,
      quantity: item.quantity || 1,
      weight: def.weight || 0,
      cost: def.cost?.quantity || 0,
      costUnit: def.cost?.unit || "gp",
      rarity: def.rarity || "Common",
      description: def.description || def.snippet || "",
      notes: notes.join(", "),
      isAttuned: item.isAttuned || false,
      isMagic: def.magic || false,
      canEquip: def.canEquip || false,
    });
  }
  return items;
}

// ═══════════════════════════════════════════
// FEATURES & TRAITS PARSER
// ═══════════════════════════════════════════

const RESET_TYPE_NAMES = { 1: "Short Rest", 2: "Long Rest", 3: "Day", 4: "Charges" };
const ACTIVATION_NAMES = { 1: "Action", 3: "Bonus Action", 4: "Reaction", 6: "1 Minute", 7: "1 Hour" };

function cleanDescription(snippet, maxUses = null, profBonus = 0) {
  return snippet
    .replace(/<[^>]*>/g, "")
    .replace(/\{\{limitedUse\}\}/gi, maxUses !== null ? String(maxUses) : "?")
    .replace(/\{\{proficiency#?unsigned\}\}/gi, String(profBonus))
    .replace(/\{\{scalevalue\}\}/gi, "")
    .replace(/\{\{modifier:[\w:]+\}\}/gi, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseFeatures(d, stats, profBonus, classes) {
  const features = [];
  const seen = new Set();

  // ── 1. Actions (class, race, feat) — these are the activatable features ──
  const allActions = [
    ...(d.actions?.class || []),
    ...(d.actions?.race || []),
    ...(d.actions?.feat || []),
  ];

  for (const a of allActions) {
    if (!a.name || seen.has(a.name)) continue;
    seen.add(a.name);

    // Calculate effective max uses
    let maxUses = null;
    let usedCount = 0;
    let resetType = null;

    if (a.limitedUse) {
      maxUses = a.limitedUse.maxUses || 0;
      usedCount = a.limitedUse.numberUsed || 0;

      // Add ability modifier to max uses if specified
      if (a.limitedUse.statModifierUsesId) {
        const statId = a.limitedUse.statModifierUsesId;
        const statMod = stats[statId - 1]?.modifier || 0;
        maxUses += Math.max(1, statMod); // minimum 1
      }
      // Add proficiency bonus if specified
      if (a.limitedUse.useProficiencyBonus) {
        maxUses += profBonus;
      }

      resetType = RESET_TYPE_NAMES[a.limitedUse.resetType] || null;
    }

    const activationType = ACTIVATION_NAMES[a.activation?.activationType] || null;
    const snippet = a.snippet || a.description || "";
    const description = cleanDescription(snippet, maxUses, profBonus);

    features.push({
      key: a.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: a.name,
      source: "action",
      sourceType: a.componentTypeId ? "class" : "other",
      activationType,
      description: description.slice(0, 200),
      maxUses,
      usedCount,
      remaining: maxUses !== null ? Math.max(0, maxUses - usedCount) : null,
      resetType,
      // Combat info
      isAttack: a.displayAsAttack || false,
      damageType: a.damageTypeId ? null : null, // could map IDs but skip for now
      saveStat: a.saveStatId ? (["", "STR", "DEX", "CON", "INT", "WIS", "CHA"][a.saveStatId] || null) : null,
      dice: a.dice?.diceString || null,
    });
  }

  // ── 2. Class Features (passive traits, no action required) ──
  for (const cls of d.classes || []) {
    const classFeatures = [
      ...(cls.classFeatures || []),
      ...(cls.subclassDefinition?.classFeatures || []),
    ];

    for (const cf of classFeatures) {
      const def = cf.definition || cf;
      if (!def.name || seen.has(def.name)) continue;

      // Skip features that are too high level for the character
      if (def.requiredLevel && def.requiredLevel > (cls.level || 0)) continue;

      seen.add(def.name);

      // Check for limited uses
      const lu = cf.limitedUse || def.limitedUse || null;
      let maxUses = null, usedCount = 0, resetType = null;
      if (lu) {
        maxUses = lu.maxUses || 0;
        usedCount = lu.numberUsed || 0;
        if (lu.statModifierUsesId) {
          const statMod = stats[lu.statModifierUsesId - 1]?.modifier || 0;
          maxUses += Math.max(1, statMod);
        }
        if (lu.useProficiencyBonus) maxUses += profBonus;
        resetType = RESET_TYPE_NAMES[lu.resetType] || null;
      }

      const snippet = def.snippet || def.description || "";
      const description = cleanDescription(snippet, maxUses, profBonus);
      if (!description) continue; // Skip empty features

      features.push({
        key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: def.name,
        source: "class",
        sourceType: cls.definition?.name || cls.subclassDefinition?.name || "Class",
        activationType: null,
        description: description.slice(0, 200),
        maxUses,
        usedCount,
        remaining: maxUses !== null ? Math.max(0, maxUses - usedCount) : null,
        resetType,
        isAttack: false,
        saveStat: null,
        dice: null,
      });
    }
  }

  // ── 3. Racial Traits ──
  for (const trait of d.race?.racialTraits || []) {
    const def = trait.definition || trait;
    if (!def.name || seen.has(def.name)) continue;
    seen.add(def.name);

    // Check for limited uses
    const lu = trait.limitedUse || def.limitedUse || null;
    let maxUses = null, usedCount = 0, resetType = null;
    if (lu) {
      maxUses = lu.maxUses || 0;
      usedCount = lu.numberUsed || 0;
      if (lu.statModifierUsesId) {
        const statMod = stats[lu.statModifierUsesId - 1]?.modifier || 0;
        maxUses += Math.max(1, statMod);
      }
      if (lu.useProficiencyBonus) maxUses += profBonus;
      resetType = RESET_TYPE_NAMES[lu.resetType] || null;
    }

    const snippet = def.snippet || def.description || "";
    const description = cleanDescription(snippet, maxUses, profBonus);
    if (!description) continue;

    features.push({
      key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: def.name,
      source: "race",
      sourceType: d.race?.fullName || "Race",
      activationType: null,
      description: description.slice(0, 200),
      maxUses,
      usedCount,
      remaining: maxUses !== null ? Math.max(0, maxUses - usedCount) : null,
      resetType,
      isAttack: false,
      saveStat: null,
      dice: null,
    });
  }

  // ── 4. Feats ──
  for (const feat of d.feats || []) {
    const def = feat.definition || feat;
    if (!def.name || seen.has(def.name)) continue;
    seen.add(def.name);

    // Check for limited uses
    const lu = feat.limitedUse || def.limitedUse || null;
    let maxUses = null, usedCount = 0, resetType = null;
    if (lu) {
      maxUses = lu.maxUses || 0;
      usedCount = lu.numberUsed || 0;
      if (lu.statModifierUsesId) {
        const statMod = stats[lu.statModifierUsesId - 1]?.modifier || 0;
        maxUses += Math.max(1, statMod);
      }
      if (lu.useProficiencyBonus) maxUses += profBonus;
      resetType = RESET_TYPE_NAMES[lu.resetType] || null;
    }

    const snippet = def.snippet || def.description || "";
    const description = cleanDescription(snippet, maxUses, profBonus);
    if (!description) continue;

    features.push({
      key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: def.name,
      source: "feat",
      sourceType: "Feat",
      activationType: null,
      description: description.slice(0, 200),
      maxUses,
      usedCount,
      remaining: maxUses !== null ? Math.max(0, maxUses - usedCount) : null,
      resetType,
      isAttack: false,
      saveStat: null,
      dice: null,
    });
  }

  return features;
}

function getProficiencyBonus(classes) {
  const level = classes.reduce((sum, c) => sum + c.level, 0);
  return Math.ceil(level / 4) + 1;
}

// ═══════════════════════════════════════════
// SPELL PARSER — D&D Beyond → combat spells
// ═══════════════════════════════════════════

const DAMAGE_TYPE_COLORS = {
  Fire: "#ff4400", Cold: "#88ccff", Lightning: "#ffee44", Thunder: "#4488ff",
  Acid: "#66cc33", Poison: "#44aa44", Necrotic: "#664488", Radiant: "#ffdd44",
  Psychic: "#dd44dd", Force: "#aa88ff", Bludgeoning: "#888888",
  Piercing: "#888888", Slashing: "#888888",
};

const SAVE_ABILITY_MAP = {
  1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA",
};

// D&D Beyond activation types: 1=Action, 3=Bonus Action, 5=Reaction, 6=Minutes, etc.
const ACTIVATION_ACTION = 1;
const ACTIVATION_BONUS = 3;

function parseSpells(d, stats, profBonus) {
  const spellList = [];
  const seen = new Set();

  // Determine spellcasting ability
  const intMod = stats.find(s => s.name === "INT")?.modifier || 0;
  const wisMod = stats.find(s => s.name === "WIS")?.modifier || 0;
  const chaMod = stats.find(s => s.name === "CHA")?.modifier || 0;
  const castMod = Math.max(intMod, wisMod, chaMod);
  const spellDC = 8 + profBonus + castMod;
  const spellAttackBonus = profBonus + castMod;

  // Gather spells from classSpells, race spells, feat spells, etc.
  // Feature-granted spells (from d.spells.*) are always available
  const classSpellSources = (d.classSpells || []).map(src => ({ ...src, _featureGranted: false }));
  const featureSpells = [
    ...(d.spells?.race || []).map(s => ({ _single: s, _featureGranted: true })),
    ...(d.spells?.feat || []).map(s => ({ _single: s, _featureGranted: true })),
    ...(d.spells?.item || []).map(s => ({ _single: s, _featureGranted: true })),
    ...(d.spells?.class || []).map(s => ({ _single: s, _featureGranted: true })),
  ];
  const allSpellSources = [...classSpellSources, ...featureSpells];

  for (const source of allSpellSources) {
    const isFeatureGranted = source._featureGranted || false;
    // classSpells has .spells array; feature spells are single objects
    const spells = source._single ? [source._single] : (source.spells || (Array.isArray(source) ? source : [source]));
    for (const spell of spells) {
      const def = spell.definition || spell;
      if (!def || !def.name) continue;

      // Skip duplicates
      const spellKey = def.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (seen.has(spellKey)) continue;
      seen.add(spellKey);

      const level = def.level ?? 0;
      const school = def.school || "";
      const range = def.range || {};
      const rangeValue = range.rangeValue || range.range || 0;
      const activation = def.activation || {};
      const activationType = activation.activationType || ACTIVATION_ACTION;
      const concentration = def.concentration || false;
      const ritual = def.ritual || false;
      const duration = def.duration || {};
      const components = def.components || [];

      // Parse damage — separate attack damage from AoE/save damage for combo spells
      let damage = null;
      let damageType = null;
      let aoeDamage = null;
      let aoeDamageType = null;
      let isHealing = false;
      const damageEntries = []; // { dice, type }

      // Check modifiers for damage dice
      const modifiers = def.modifiers || [];
      for (const mod of modifiers) {
        if (mod.type === "damage" && mod.die) {
          const die = mod.die;
          if (die.diceString) {
            damageEntries.push({ dice: die.diceString, type: mod.subType || mod.friendlySubtypeName || null });
          }
        }
        if (mod.type === "bonus" && mod.subType === "hit-points") {
          isHealing = true;
          if (mod.die?.diceString) damage = mod.die.diceString;
        }
      }

      // For combo spells (attack + save, e.g. Ice Knife):
      // First damage entry = attack damage, second = AoE/save damage
      const hasAttack = def.attackType === 1 || def.attackType === 2;
      const hasSave = !!def.saveDcAbilityId || def.requiresSavingThrow;

      if (hasAttack && hasSave && damageEntries.length >= 2 && !damage) {
        // Combo spell: separate attack damage from AoE damage
        damage = damageEntries[0].dice;
        damageType = damageEntries[0].type;
        aoeDamage = damageEntries.slice(1).map(e => e.dice).join("+");
        aoeDamageType = damageEntries[1].type;
      } else if (damageEntries.length > 0 && !damage) {
        // Normal: combine or deduplicate
        const unique = [...new Set(damageEntries.map(e => e.dice))];
        damage = unique.join("+");
        damageType = damageEntries[0].type;
      }

      // Fallback: check atHigherLevels for damage scaling hint
      if (!damage && def.atHigherLevels?.scaleType === "characterlevel") {
        const scales = def.atHigherLevels?.higherLevelDefinitions || [];
        // Try to get base damage from cantrip scale
        if (scales.length > 0) {
          const firstScale = scales[0];
          if (firstScale.dice) damage = firstScale.dice.diceString;
          if (firstScale.damageType) damageType = firstScale.damageType;
        }
      }

      // Parse save type
      let saveType = null;
      if (def.saveDcAbilityId) {
        saveType = SAVE_ABILITY_MAP[def.saveDcAbilityId] || null;
      }
      // Also check requiresSavingThrow
      if (!saveType && def.requiresSavingThrow) {
        // Try to find save ability from modifiers
        for (const mod of modifiers) {
          if (mod.type === "damage" && mod.atHigherLevels?.scaleType) {
            // common pattern — the save type is at spell definition level
          }
        }
      }

      // Determine AoE
      let isAoE = false;
      let aoeRadius = 0;
      const aoeType = range.aoeType || null;
      const aoeSize = range.aoeSize || range.aoeValue || 0;
      if (aoeType && aoeSize > 0) {
        isAoE = true;
        aoeRadius = aoeSize;
      }

      // Determine if it's an attack spell (spell attack roll)
      const isAttack = def.attackType === 1 || def.attackType === 2; // 1=Melee spell, 2=Ranged spell

      // Build description
      const descParts = [];
      if (isAoE) descParts.push(`${aoeSize}ft ${aoeType || "radius"}`);
      else if (rangeValue > 0) descParts.push(`${rangeValue}ft`);
      else descParts.push("Touch");
      if (concentration) descParts.push("Conc.");
      if (ritual) descParts.push("Ritual");
      if (isHealing) descParts.push("Healing");

      // Determine color
      const color = DAMAGE_TYPE_COLORS[damageType] || "#aa88ff";

      // For healing spells, store healing dice separately
      const healing = isHealing ? (damage || null) : null;

      const parsed = {
        key: spellKey,
        name: def.name,
        level,
        school,
        damage: isHealing ? null : (damage || null),
        damageType: damageType || null,
        aoeDamage: aoeDamage || null,
        aoeDamageType: aoeDamageType || null,
        healing,
        healingMod: isHealing ? castMod : 0,
        save: saveType,
        isAoE,
        aoeRadius,
        aoeType: aoeType || null,
        isAttack,
        attackBonus: isAttack ? spellAttackBonus : null,
        range: rangeValue,
        isHealing,
        concentration,
        ritual,
        color,
        description: descParts.join(", "),
        activationType,
        prepared: spell.prepared || spell.alwaysPrepared || isFeatureGranted || false,
        spellDC,
      };

      spellList.push(parsed);
    }
  }

  // Sort: cantrips first, then by level, then alphabetical
  spellList.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });

  return spellList;
}

function parseSpellSlots(d) {
  const slots = [];

  // Try classSpells first
  for (const cs of d.classSpells || []) {
    const slotArr = cs.spellSlots || [];
    for (const slot of slotArr) {
      if (!slot || slot.level === 0 || !slot.available) continue;
      const existing = slots.find(s => s.level === slot.level);
      if (existing) {
        existing.max += slot.available;
        existing.used += (slot.used || 0);
      } else {
        slots.push({
          level: slot.level,
          max: slot.available,
          used: slot.used || 0,
          remaining: slot.available - (slot.used || 0),
        });
      }
    }
  }

  // If no slots found, calculate from spellRules.levelSpellSlots
  if (slots.length === 0) {
    for (const cls of d.classes || []) {
      const rules = cls.definition?.spellRules;
      if (!rules?.levelSpellSlots) continue;
      const lvl = cls.level || 1;
      const divisor = rules.multiClassSpellSlotDivisor || 1;
      // For half-casters (Paladin, Ranger), use their own table
      const slotRow = rules.levelSpellSlots[lvl];
      if (!slotRow) continue;
      for (let i = 0; i < slotRow.length; i++) {
        const max = slotRow[i];
        if (max <= 0) continue;
        const level = i + 1;
        const existing = slots.find(s => s.level === level);
        if (existing) {
          existing.max = Math.max(existing.max, max);
        } else {
          slots.push({ level, max, used: 0, remaining: max });
        }
      }
    }
    // Apply used counts from d.spellSlots if available
    for (const slot of d.spellSlots || []) {
      if (!slot || slot.level === 0) continue;
      const existing = slots.find(s => s.level === slot.level);
      if (existing && slot.used) {
        existing.used = slot.used;
        existing.remaining = existing.max - existing.used;
      }
    }
  }

  // Pact magic slots (Warlock)
  if (d.pactMagic) {
    const pactSlots = d.pactMagic.spellSlots || [];
    for (const slot of pactSlots) {
      if (!slot || slot.level === 0 || !slot.available) continue;
      const existing = slots.find(s => s.level === slot.level);
      if (existing) {
        existing.max += slot.available;
        existing.used += (slot.used || 0);
        existing.remaining = existing.max - existing.used;
        existing.isPact = true;
      } else {
        slots.push({
          level: slot.level,
          max: slot.available,
          used: slot.used || 0,
          remaining: slot.available - (slot.used || 0),
          isPact: true,
        });
      }
    }
    // Fallback: calculate from pactMagic.level + rules
    if (!pactSlots.some(s => s.available > 0) && d.pactMagic.level) {
      // Warlock pact slots: 1 slot at lv1, 2 at lv2+, level = max warlock spell level
      const warlockClass = d.classes?.find(c => c.definition?.name === "Warlock");
      if (warlockClass) {
        const wlvl = warlockClass.level;
        const pactMax = wlvl >= 2 ? 2 : 1;
        const pactLevel = Math.min(Math.ceil(wlvl / 2), 5);
        if (pactMax > 0) {
          slots.push({ level: pactLevel, max: pactMax, used: 0, remaining: pactMax, isPact: true });
        }
      }
    }
  }

  slots.sort((a, b) => a.level - b.level);
  return slots.filter(s => s.max > 0);
}

function parseCreatures(d) {
  const creatures = d.creatures || [];
  if (creatures.length === 0) return [];

  const SIZE_NAMES = { 1: "Tiny", 2: "Small", 3: "Medium", 4: "Medium", 5: "Large", 6: "Huge", 7: "Gargantuan" };
  const MOVE_NAMES = { 1: "Walk", 2: "Burrow", 3: "Climb", 4: "Fly", 5: "Swim" };
  const STAT_NAMES = ["", "STR", "DEX", "CON", "INT", "WIS", "CHA"];

  return creatures.map(c => {
    const def = c.definition;
    if (!def) return null;

    // Stats
    const stats = (def.stats || []).map(s => {
      const name = STAT_NAMES[s.statId] || "?";
      const value = s.value || 10;
      return { name, value, modifier: Math.floor((value - 10) / 2) };
    });

    // Movements
    const movements = (def.movements || []).map(m => ({
      type: MOVE_NAMES[m.movementId] || "Walk",
      speed: m.speed || 30,
    }));
    const mainSpeed = movements.find(m => m.type === "Walk")?.speed || movements[0]?.speed || 30;
    const speedStr = movements.map(m => m.type === "Walk" ? `${m.speed}ft` : `${m.type} ${m.speed}ft`).join(", ");

    // Parse actions from HTML description
    const actions = parseCreatureActions(def.actionsDescription || "");
    const bonusActions = parseCreatureActions(def.bonusActionsDescription || "");
    const traits = parseCreatureTraits(def.specialTraitsDescription || "");

    return {
      id: c.id,
      definitionId: def.id,
      name: c.name || def.name,
      isActive: c.isActive || false,
      removedHitPoints: c.removedHitPoints || 0,
      size: SIZE_NAMES[def.sizeId] || "Medium",
      ac: def.armorClass || 10,
      hp: def.averageHitPoints || 10,
      hitDice: def.hitPointDice?.diceString || null,
      speed: mainSpeed,
      speedStr,
      stats,
      actions,
      bonusActions,
      traits,
      avatarUrl: def.avatarUrl || null,
      groupId: c.groupId,
    };
  }).filter(Boolean);
}

function parseCreatureActions(html) {
  if (!html) return [];
  const actions = [];
  // Match pattern: <strong>Name.</strong> description with attack/damage info
  const regex = /<strong>([^<]+)\.<\/strong>\s*([^<]*(?:<[^>]*>[^<]*)*)/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1].trim();
    let desc = match[2].replace(/<[^>]*>/g, "").trim();
    if (desc.length > 200) desc = desc.slice(0, 200) + "...";

    // Try to extract attack bonus and damage
    const atkMatch = desc.match(/([+-]\d+)\s*to hit/i);
    const dmgMatch = desc.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+)\s+damage/i);

    actions.push({
      name,
      description: desc,
      attackBonus: atkMatch ? parseInt(atkMatch[1]) : null,
      damage: dmgMatch ? dmgMatch[1].replace(/\s/g, "") : null,
      damageType: dmgMatch ? dmgMatch[2] : null,
    });
  }
  return actions;
}

function parseCreatureTraits(html) {
  if (!html) return [];
  const traits = [];
  const regex = /<strong>([^<]+)\.<\/strong>\s*([^<]*(?:<[^>]*>[^<]*)*)/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let desc = match[2].replace(/<[^>]*>/g, "").trim();
    if (desc.length > 200) desc = desc.slice(0, 200) + "...";
    traits.push({ name: match[1].trim(), description: desc });
  }
  return traits;
}
