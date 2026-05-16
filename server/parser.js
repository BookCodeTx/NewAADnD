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

function parseBonusActions(d, classes, weapons) {
  const actions = [];
  const classNames = classes.map((c) => c.name.toLowerCase());

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
    }
  }

  // Class-specific bonus actions
  if (classNames.includes("rogue")) {
    actions.push(
      { key: "cunning-dash", name: "Cunning Action: Dash", description: "Double movement this turn", type: "movement" },
      { key: "cunning-disengage", name: "Cunning Action: Disengage", description: "Movement doesn't provoke attacks of opportunity", type: "movement" },
      { key: "cunning-hide", name: "Cunning Action: Hide", description: "Roll Stealth to hide", type: "skill", skill: "stealth" },
    );
  }
  if (classNames.includes("monk")) {
    actions.push(
      { key: "flurry-of-blows", name: "Flurry of Blows", description: "Two unarmed strikes (1 ki)", type: "attack" },
      { key: "patient-defense", name: "Patient Defense", description: "Dodge action (1 ki)", type: "defense" },
      { key: "step-of-the-wind", name: "Step of the Wind", description: "Disengage or Dash + jump x2 (1 ki)", type: "movement" },
    );
  }
  if (classNames.includes("ranger")) {
    actions.push(
      { key: "hunters-mark", name: "Hunter's Mark", description: "Mark target: +1d6 damage from your attacks (concentration)", type: "spell" },
      { key: "two-weapon-fighting", name: "Two-Weapon Fighting", description: "Off-hand attack with light weapon", type: "attack" },
    );
  }
  if (classNames.includes("paladin")) {
    actions.push({ key: "divine-favor", name: "Divine Favor", description: "Weapon attacks deal +1d4 radiant (concentration)", type: "spell" });
  }
  if (classNames.includes("bard")) {
    actions.push({ key: "bardic-inspiration", name: "Bardic Inspiration", description: "Grant ally a Bardic Inspiration die", type: "support" });
  }
  if (classNames.includes("cleric")) {
    actions.push({ key: "healing-word", name: "Healing Word", description: "Heal ally 1d4+spell mod (60ft)", type: "spell" });
  }
  if (classNames.includes("sorcerer")) {
    actions.push({ key: "quickened-spell", name: "Quickened Spell", description: "Cast 1-action spell as bonus action (2 sorcery points)", type: "spell" });
  }
  if (classNames.includes("warlock")) {
    actions.push({ key: "hex", name: "Hex", description: "Curse target: +1d6 necrotic from your attacks (concentration)", type: "spell" });
  }

  // Universal bonus actions
  actions.push(
    { key: "potion", name: "Drink Potion", description: "Quaff a potion (bonus action with feat)", type: "item" },
    { key: "second-wind", name: "Second Wind (Fighter)", description: "Heal 1d10+level (1/short rest)", type: "heal", healDice: "1d10" },
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

  // Always add Unarmed Strike
  weapons.push({
    name: "Unarmed Strike",
    equipped: true,
    type: "Simple Melee",
    attackType: "melee",
    damage: "1",
    damageType: "Bludgeoning",
    damageMod: strMod,
    abilityMod: strMod,
    attackBonus: strMod + profBonus,
    range: 5,
    longRange: 5,
    properties: [],
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
    // Strip HTML tags for clean text
    const description = snippet.replace(/<[^>]*>/g, "").trim();

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

      const snippet = def.snippet || def.description || "";
      const description = snippet.replace(/<[^>]*>/g, "").trim();
      if (!description) continue; // Skip empty features

      features.push({
        key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: def.name,
        source: "class",
        sourceType: cls.definition?.name || cls.subclassDefinition?.name || "Class",
        activationType: null,
        description: description.slice(0, 200),
        maxUses: null,
        usedCount: 0,
        remaining: null,
        resetType: null,
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

    const snippet = def.snippet || def.description || "";
    const description = snippet.replace(/<[^>]*>/g, "").trim();
    if (!description) continue;

    features.push({
      key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: def.name,
      source: "race",
      sourceType: d.race?.fullName || "Race",
      activationType: null,
      description: description.slice(0, 200),
      maxUses: null,
      usedCount: 0,
      remaining: null,
      resetType: null,
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

    const snippet = def.snippet || def.description || "";
    const description = snippet.replace(/<[^>]*>/g, "").trim();
    if (!description) continue;

    features.push({
      key: def.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: def.name,
      source: "feat",
      sourceType: "Feat",
      activationType: null,
      description: description.slice(0, 200),
      maxUses: null,
      usedCount: 0,
      remaining: null,
      resetType: null,
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
  const allSpellSources = [
    ...(d.classSpells || []),
    ...(d.spells?.race || []),
    ...(d.spells?.feat || []),
    ...(d.spells?.item || []),
    ...(d.spells?.class || []),
  ];

  for (const source of allSpellSources) {
    // classSpells has .spells array; race/feat/item spells are direct arrays
    const spells = source.spells || (Array.isArray(source) ? source : [source]);
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

      // Parse damage
      let damage = null;
      let damageType = null;
      let isHealing = false;

      // Check modifiers for damage dice
      const modifiers = def.modifiers || [];
      for (const mod of modifiers) {
        if (mod.type === "damage" && mod.die) {
          const die = mod.die;
          if (die.diceString) {
            damage = die.diceString;
            damageType = mod.subType || mod.friendlySubtypeName || null;
          }
        }
        if (mod.type === "bonus" && mod.subType === "hit-points") {
          isHealing = true;
          if (mod.die?.diceString) damage = mod.die.diceString;
        }
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

      const parsed = {
        key: spellKey,
        name: def.name,
        level,
        school,
        damage: damage || null,
        damageType: damageType || null,
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
        prepared: spell.prepared ?? spell.alwaysPrepared ?? true,
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
